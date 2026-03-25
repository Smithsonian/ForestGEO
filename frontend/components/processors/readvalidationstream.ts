/**
 * Client-side NDJSON stream reader for validation endpoints.
 *
 * Consumes a streaming response from streamWithHeartbeats(), ignores heartbeat
 * lines, and returns the final result payload (or throws on error).
 */

import type { StreamMessage } from './streamingvalidation';

/**
 * Reads a streaming NDJSON response, discards heartbeats, and returns the
 * result data.  Throws if the stream contains an error message or if the
 * response body is missing.
 */
export async function readValidationStream<T>(response: Response, signal?: AbortSignal): Promise<T> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null — streaming not supported');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        const abortError = new DOMException('The operation was aborted.', 'AbortError');
        throw abortError;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) chunk in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let message: StreamMessage<T>;
        try {
          message = JSON.parse(trimmed);
        } catch {
          continue; // skip malformed lines
        }

        switch (message.type) {
          case 'heartbeat':
            // Silently consume — these only exist to keep the connection alive
            break;
          case 'result':
            return message.data;
          case 'error':
            throw new Error(message.message);
        }
      }
    }

    // If we reach here the stream ended without a result or error line
    throw new Error('Validation stream ended without a result');
  } finally {
    reader.releaseLock();
  }
}
