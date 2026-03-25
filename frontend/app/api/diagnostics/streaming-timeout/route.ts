import { NextResponse } from 'next/server';
import ailogger from '@/ailogger';
import { STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { isAllowedStreamingDiagnosticHost, normalizeStreamingDiagnosticHost } from './helpers';

export const runtime = 'nodejs';

// Temporary diagnostic route for validating long-lived streamed requests on
// non-production hosts without exercising the validation SQL path itself.
export const maxDuration = 960;

const DEFAULT_DURATION_SECONDS = 12 * 60;
const DEFAULT_HEARTBEAT_SECONDS = 30;
const MAX_DURATION_SECONDS = 15 * 60;
const MAX_HEARTBEAT_SECONDS = 60;
const MIN_HEARTBEAT_SECONDS = 1;

interface DiagnosticResult {
  actualDurationSeconds: number;
  completedAt: string;
  heartbeatSeconds: number;
  host: string;
  requestedDurationSeconds: number;
  startedAt: string;
}

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function createStreamingDiagnosticStream(durationSeconds: number, heartbeatSeconds: number, host: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const durationMs = durationSeconds * 1000;
  const heartbeatMs = heartbeatSeconds * 1000;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (completionTimer) clearTimeout(completionTimer);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        const elapsed = Math.round((Date.now() - startedAtMs) / 1000);
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'heartbeat', elapsed }) + '\n'));
      }, heartbeatMs);

      completionTimer = setTimeout(() => {
        if (closed) return;

        const actualDurationSeconds = Math.round((Date.now() - startedAtMs) / 1000);
        const payload = {
          type: 'result',
          success: true,
          data: {
            actualDurationSeconds,
            completedAt: new Date().toISOString(),
            heartbeatSeconds,
            host,
            requestedDurationSeconds: durationSeconds,
            startedAt
          } satisfies DiagnosticResult
        };

        controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
        close();
      }, durationMs);
    },
    cancel() {
      closed = true;
      cleanup();
      ailogger.info('[StreamingDiagnostic] Client cancelled diagnostic stream');
    }
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = normalizeStreamingDiagnosticHost(forwardedHost || request.headers.get('host') || url.host);
    const rawDurationSeconds = url.searchParams.get('durationSeconds');
    const rawHeartbeatSeconds = url.searchParams.get('heartbeatSeconds');

    if (!isAllowedStreamingDiagnosticHost(host)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const parsedDurationSeconds = parseInteger(rawDurationSeconds);
    const parsedHeartbeatSeconds = parseInteger(rawHeartbeatSeconds);

    if (rawDurationSeconds !== null && parsedDurationSeconds === null) {
      return NextResponse.json({ error: `durationSeconds must be an integer between 0 and ${MAX_DURATION_SECONDS}` }, { status: 400 });
    }

    if (rawHeartbeatSeconds !== null && parsedHeartbeatSeconds === null) {
      return NextResponse.json({ error: `heartbeatSeconds must be an integer between ${MIN_HEARTBEAT_SECONDS} and ${MAX_HEARTBEAT_SECONDS}` }, { status: 400 });
    }

    const durationSeconds = parsedDurationSeconds ?? DEFAULT_DURATION_SECONDS;
    const heartbeatSeconds = parsedHeartbeatSeconds ?? DEFAULT_HEARTBEAT_SECONDS;

    if (durationSeconds < 0 || durationSeconds > MAX_DURATION_SECONDS) {
      return NextResponse.json({ error: `durationSeconds must be an integer between 0 and ${MAX_DURATION_SECONDS}` }, { status: 400 });
    }

    if (heartbeatSeconds < MIN_HEARTBEAT_SECONDS || heartbeatSeconds > MAX_HEARTBEAT_SECONDS) {
      return NextResponse.json({ error: `heartbeatSeconds must be an integer between ${MIN_HEARTBEAT_SECONDS} and ${MAX_HEARTBEAT_SECONDS}` }, { status: 400 });
    }

    ailogger.info(`[StreamingDiagnostic] Starting ${durationSeconds}s diagnostic for host ${host}`);

    return new Response(createStreamingDiagnosticStream(durationSeconds, heartbeatSeconds, host), {
      headers: STREAMING_RESPONSE_HEADERS
    });
  } catch (error: any) {
    ailogger.error('[StreamingDiagnostic] Failed to start diagnostic stream:', error.message);
    return NextResponse.json({ error: error.message, success: false }, { status: 500 });
  }
}
