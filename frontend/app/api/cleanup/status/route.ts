/**
 * Cleanup Status API
 *
 * Provides endpoints to:
 * - Get cleanup status
 * - Start/stop periodic cleanup
 * - Run global cleanup across all schemas
 */

import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { runGlobalCleanup, startPeriodicCleanup, stopPeriodicCleanup, getCleanupStatus } from '@/config/startupcleanup';

export const runtime = 'nodejs';

/**
 * GET - Get cleanup status
 */
export async function GET(): Promise<NextResponse> {
  try {
    const status = getCleanupStatus();
    return new NextResponse(JSON.stringify({ status }), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('[Cleanup Status API] GET error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

/**
 * POST - Perform cleanup action
 *
 * Body: {
 *   action: 'runGlobal' | 'startPeriodic' | 'stopPeriodic'
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'runGlobal': {
        const result = await runGlobalCleanup();
        return new NextResponse(JSON.stringify({ result }), {
          status: HTTPResponses.OK
        });
      }

      case 'startPeriodic': {
        startPeriodicCleanup();
        return new NextResponse(JSON.stringify({ message: 'Periodic cleanup started' }), {
          status: HTTPResponses.OK
        });
      }

      case 'stopPeriodic': {
        stopPeriodicCleanup();
        return new NextResponse(JSON.stringify({ message: 'Periodic cleanup stopped' }), {
          status: HTTPResponses.OK
        });
      }

      default:
        return new NextResponse(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: HTTPResponses.BAD_REQUEST
        });
    }
  } catch (error: any) {
    ailogger.error('[Cleanup Status API] POST error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}
