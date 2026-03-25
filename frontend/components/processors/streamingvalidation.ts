/**
 * Server-side streaming wrapper for long-running validation operations.
 *
 * Sends periodic NDJSON heartbeat lines to keep Azure App Service's load
 * balancer (which kills idle connections at ~230 s) from dropping the request.
 */

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface HeartbeatMessage {
  type: 'heartbeat';
  elapsed: number;
}

export interface ResultMessage<T> {
  type: 'result';
  success: true;
  data: T;
}

export interface ErrorMessage {
  type: 'error';
  success: false;
  message: string;
}

export type StreamMessage<T> = HeartbeatMessage | ResultMessage<T> | ErrorMessage;

/**
 * Wraps a long-running async operation in a ReadableStream that emits NDJSON
 * heartbeat lines at a fixed interval, followed by a single result or error
 * line when the operation resolves/rejects.
 */
export function streamWithHeartbeats<T>(operation: () => Promise<T>, heartbeatIntervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const startTime = Date.now();

      const heartbeatTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const heartbeat: HeartbeatMessage = { type: 'heartbeat', elapsed };
        controller.enqueue(encoder.encode(JSON.stringify(heartbeat) + '\n'));
      }, heartbeatIntervalMs);

      operation()
        .then(data => {
          const result: ResultMessage<T> = { type: 'result', success: true, data };
          controller.enqueue(encoder.encode(JSON.stringify(result) + '\n'));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const error: ErrorMessage = { type: 'error', success: false, message };
          controller.enqueue(encoder.encode(JSON.stringify(error) + '\n'));
        })
        .finally(() => {
          clearInterval(heartbeatTimer);
          controller.close();
        });
    }
  });
}

/** Standard response headers for streaming validation endpoints. */
export const STREAMING_RESPONSE_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no'
} as const;
