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
  generateIdempotencyKey
} from '@/config/uploadsessiontracker';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';

/**
 * POST - Create a new upload session
 *
 * Body: {
 *   schema: string,
 *   plotId: number,
 *   censusId: number,
 *   userId: string,
 *   fileId: string,
 *   totalChunks: number,
 *   fileHash?: string  // Optional, for idempotency
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { schema, plotId, censusId, userId, fileId, totalChunks, fileHash } = body;

    if (!schema || !plotId || !censusId || !userId || !fileId) {
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

    // Ensure table exists
    await ensureUploadSessionsTable(schema);

    // Generate idempotency key if file hash provided
    const idempotencyKey = fileHash ? generateIdempotencyKey(schema, plotId, censusId, fileHash) : undefined;

    const session = await createUploadSession(schema, plotId, censusId, userId, fileId, totalChunks || 0, idempotencyKey);

    return new NextResponse(JSON.stringify({ session }), {
      status: HTTPResponses.CREATED
    });
  } catch (error: any) {
    ailogger.error('[UploadSession API] POST error:', error);

    // Check for concurrent upload error
    if (error.message?.includes('Another upload is in progress')) {
      return new NextResponse(JSON.stringify({ error: error.message }), {
        status: HTTPResponses.CONFLICT
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
      const result = await runSessionCleanup(schema);
      return new NextResponse(JSON.stringify({ cleanup: result }), {
        status: HTTPResponses.OK
      });
    }

    // Get specific session
    if (sessionId) {
      const session = await getSession(schema, sessionId);
      if (!session) {
        return new NextResponse(JSON.stringify({ error: 'Session not found' }), {
          status: HTTPResponses.NOT_FOUND
        });
      }
      return new NextResponse(JSON.stringify({ session }), {
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

    // Mark session as abandoned
    await updateSessionState(schema, sessionId, UploadSessionState.ABANDONED, 'Session cancelled by user');

    // Optionally trigger immediate cleanup
    if (cleanup) {
      const session = await getSession(schema, sessionId);
      if (session) {
        const { cleanupOrphanedData } = await import('@/config/uploadsessiontracker');
        await cleanupOrphanedData(schema, session);
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
