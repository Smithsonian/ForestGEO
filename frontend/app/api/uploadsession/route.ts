/**
 * Upload Session API
 *
 * Provides endpoints for:
 * - Creating upload sessions
 * - Sending heartbeats
 * - Querying session status
 * - Running cleanup operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import {
  createUploadSession,
  getSession,
  updateSessionState,
  updateSessionProgress,
  sendHeartbeat,
  runSessionCleanup,
  ensureUploadSessionsTable,
  UploadSessionState,
  generateUploadSessionIdempotencyKey,
  UploadSessionOwnershipError
} from '@/config/uploadsessiontracker';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ConnectionManager from '@/config/connectionmanager';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { auth } from '@/auth';
import { getSessionUserId, getSessionUserIds, requireAdmin, requireSession } from '@/lib/auth-helpers';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import type { Session } from 'next-auth';

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function getAuthenticatedUserId(session: Session): string | NextResponse {
  const userId = getSessionUserId(session);
  if (!userId) {
    return new NextResponse(JSON.stringify({ error: 'Authenticated session has no user identifier' }), { status: HTTPResponses.UNAUTHORIZED });
  }
  return userId;
}

async function requireOwnedUploadSession(schema: string, sessionId: string, session: Session, contextLabel: string) {
  const uploadSession = await getSession(schema, sessionId);
  if (!uploadSession) {
    return new NextResponse(JSON.stringify({ error: `Upload session ${sessionId} was not found for ${contextLabel}` }), { status: HTTPResponses.NOT_FOUND });
  }

  const allowedUserIds = new Set(getSessionUserIds(session));
  if (!allowedUserIds.has(uploadSession.userId)) {
    return new NextResponse(JSON.stringify({ error: 'Upload session does not belong to the authenticated user' }), { status: HTTPResponses.FORBIDDEN });
  }

  return uploadSession;
}

/**
 * POST - Create a new upload session
 *
 * Body: {
 *   schema: string,
 *   plotId: number,
 *   censusId: number,
 *   userId: string, // ignored server-side; authenticated session identity is used
 *   fileId: string,
 *   totalChunks: number,
 *   fileHash?: string  // Optional, for idempotency
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    const authError = requireSession(session);
    if (authError) return authError;
    const userId = getAuthenticatedUserId(session!);
    if (typeof userId !== 'string') return userId;

    const body = await request.json();
    const { schema } = body;

    if (!schema) {
      return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // SQL Injection Prevention: Validate schema against whitelist
    if (!isValidSchema(schema)) {
      ailogger.error(`[UploadSession API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // `navigator.sendBeacon()` can only POST, so accept unload state updates here.
    if (body.action === 'updateState' && body.sessionId && body.state) {
      const ownership = await requireOwnedUploadSession(schema, body.sessionId, session!, 'beacon state update');
      if (ownership instanceof NextResponse) return ownership;
      await updateSessionState(schema, body.sessionId, body.state as UploadSessionState, body.errorMessage);
      return new NextResponse(JSON.stringify({ success: true }), {
        status: HTTPResponses.OK
      });
    }

    const { plotId, censusId, fileId, totalChunks, fileHash, mode } = body;
    const parsedPlotId = parsePositiveInteger(plotId);
    const parsedCensusId = parsePositiveInteger(censusId);

    if (!parsedPlotId || !parsedCensusId || !fileId) {
      return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    const connectionManager = ConnectionManager.getInstance();
    await assertCanEditMeasurementScope(connectionManager, session!, {
      schema,
      plotID: parsedPlotId,
      censusID: parsedCensusId
    });

    // Ensure table exists
    await ensureUploadSessionsTable(schema);

    // Generate idempotency key if file hash provided
    const idempotencyKey = fileHash ? generateUploadSessionIdempotencyKey(schema, parsedPlotId, parsedCensusId, fileHash, mode) : undefined;

    const uploadSession = await connectionManager.withTransaction(async transactionID => {
      const scopeLockAcquired = await connectionManager.acquireApplicationLock(
        buildMeasurementScopeLockName(schema, parsedPlotId, parsedCensusId),
        transactionID,
        MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
      );

      if (!scopeLockAcquired) {
        throw new UploadSessionOwnershipError(
          `Another measurement operation is in progress for Plot ${parsedPlotId}, Census ${parsedCensusId}. Please retry after it completes.`
        );
      }

      return createUploadSession(schema, parsedPlotId, parsedCensusId, userId, fileId, totalChunks || 0, idempotencyKey, mode);
    });

    return new NextResponse(JSON.stringify({ session: uploadSession }), {
      status: HTTPResponses.CREATED
    });
  } catch (error: any) {
    ailogger.error('[UploadSession API] POST error:', error);

    // Check for concurrent upload error
    if (error instanceof UploadSessionOwnershipError || error.message?.includes('Another upload is in progress')) {
      return new NextResponse(JSON.stringify({ error: error.message }), {
        status: HTTPResponses.CONFLICT
      });
    }

    if (error instanceof ScopeAccessError) {
      return new NextResponse(JSON.stringify({ error: error.message }), {
        status: HTTPResponses.FORBIDDEN
      });
    }

    return new NextResponse(JSON.stringify({ error: error.message || 'Failed to create session' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

/**
 * GET - Get session status or run cleanup
 *
 * Query params:
 *   - schema: string (required)
 *   - sessionId: string (optional - get specific session)
 *   - action: 'cleanup' (optional - run cleanup instead of getting session)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const schema = searchParams.get('schema');
    const sessionId = searchParams.get('sessionId');
    const action = searchParams.get('action');

    if (!schema) {
      return new NextResponse(JSON.stringify({ error: 'Schema is required' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // SQL Injection Prevention: Validate schema against whitelist
    if (!isValidSchema(schema)) {
      ailogger.error(`[UploadSession API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // Run cleanup action
    if (action === 'cleanup') {
      const authError = requireAdmin(await auth());
      if (authError) return authError;
      const result = await runSessionCleanup(schema);
      return new NextResponse(JSON.stringify({ cleanup: result }), {
        status: HTTPResponses.OK
      });
    }

    // Get specific session
    if (sessionId) {
      const session = await auth();
      const authError = requireSession(session);
      if (authError) return authError;
      const ownership = await requireOwnedUploadSession(schema, sessionId, session!, 'session lookup');
      if (ownership instanceof NextResponse) return ownership;
      return new NextResponse(JSON.stringify({ session: ownership }), {
        status: HTTPResponses.OK
      });
    }

    return new NextResponse(JSON.stringify({ error: 'sessionId or action required' }), {
      status: HTTPResponses.BAD_REQUEST
    });
  } catch (error: any) {
    ailogger.error('[UploadSession API] GET error:', error);
    return new NextResponse(JSON.stringify({ error: error.message || 'Failed to get session' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

/**
 * PATCH - Update session (heartbeat, state, progress)
 *
 * Body: {
 *   schema: string,
 *   sessionId: string,
 *   action: 'heartbeat' | 'updateState' | 'updateProgress',
 *   state?: UploadSessionState,
 *   errorMessage?: string,
 *   uploadedChunks?: number,
 *   processedBatches?: number,
 *   totalBatches?: number
 * }
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    const authError = requireSession(session);
    if (authError) return authError;

    const body = await request.json();
    const { schema, sessionId, action, state, errorMessage, uploadedChunks, processedBatches, totalBatches } = body;

    if (!schema || !sessionId || !action) {
      return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // SQL Injection Prevention: Validate schema against whitelist
    if (!isValidSchema(schema)) {
      ailogger.error(`[UploadSession API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    const ownership = await requireOwnedUploadSession(schema, sessionId, session!, `upload session ${action}`);
    if (ownership instanceof NextResponse) return ownership;

    switch (action) {
      case 'heartbeat': {
        const success = await sendHeartbeat(schema, sessionId);
        return new NextResponse(JSON.stringify({ success }), {
          status: success ? HTTPResponses.OK : HTTPResponses.NOT_FOUND
        });
      }

      case 'updateState': {
        if (!state) {
          return new NextResponse(JSON.stringify({ error: 'State is required for updateState action' }), {
            status: HTTPResponses.BAD_REQUEST
          });
        }
        await updateSessionState(schema, sessionId, state as UploadSessionState, errorMessage);
        return new NextResponse(JSON.stringify({ success: true }), {
          status: HTTPResponses.OK
        });
      }

      case 'updateProgress': {
        await updateSessionProgress(schema, sessionId, {
          uploadedChunks,
          processedBatches,
          totalBatches,
          state: state as UploadSessionState | undefined
        });
        return new NextResponse(JSON.stringify({ success: true }), {
          status: HTTPResponses.OK
        });
      }

      default:
        return new NextResponse(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: HTTPResponses.BAD_REQUEST
        });
    }
  } catch (error: any) {
    ailogger.error('[UploadSession API] PATCH error:', error);
    return new NextResponse(JSON.stringify({ error: error.message || 'Failed to update session' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

/**
 * DELETE - Cancel/abandon a session
 *
 * Query params:
 *   - schema: string
 *   - sessionId: string
 *   - cleanup: 'true' (optional - also cleanup orphaned data)
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    const authError = requireSession(session);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const schema = searchParams.get('schema');
    const sessionId = searchParams.get('sessionId');
    const cleanup = searchParams.get('cleanup') === 'true';

    if (!schema || !sessionId) {
      return new NextResponse(JSON.stringify({ error: 'Schema and sessionId are required' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // SQL Injection Prevention: Validate schema against whitelist
    if (!isValidSchema(schema)) {
      ailogger.error(`[UploadSession API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    const ownership = await requireOwnedUploadSession(schema, sessionId, session!, 'session cancellation');
    if (ownership instanceof NextResponse) return ownership;

    // Mark session as abandoned
    await updateSessionState(schema, sessionId, UploadSessionState.ABANDONED, 'Session cancelled by user');

    // Optionally trigger immediate cleanup
    if (cleanup) {
      const uploadSession = await getSession(schema, sessionId);
      if (uploadSession) {
        const { cleanupOrphanedData } = await import('@/config/uploadsessiontracker');
        await cleanupOrphanedData(schema, uploadSession);
      }
    }

    return new NextResponse(JSON.stringify({ success: true }), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('[UploadSession API] DELETE error:', error);
    return new NextResponse(JSON.stringify({ error: error.message || 'Failed to cancel session' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}
