import { beforeEach, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';
import { streamWithHeartbeats, type StreamMessage } from './streamingvalidation';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

const SECRET_DATABASE_MESSAGE = "Table 'forestgeo_secretsite.measurementssummary' doesn't exist";
const HEARTBEAT_INTERVAL_LONGER_THAN_THE_TEST_MS = 60_000;

async function readStreamLines(stream: ReadableStream<Uint8Array>): Promise<StreamMessage<unknown>[]> {
  const text = await new Response(stream).text();
  console.log('[stream body]', text);
  return text
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('streamWithHeartbeats', () => {
  it('sends the fixed error message for a failed operation and logs the database error', async () => {
    const failure = new Error(SECRET_DATABASE_MESSAGE);

    const lines = await readStreamLines(
      streamWithHeartbeats(async () => {
        throw failure;
      }, HEARTBEAT_INTERVAL_LONGER_THAN_THE_TEST_MS)
    );

    expect(lines).toEqual([{ type: 'error', success: false, message: INTERNAL_SERVER_ERROR_MESSAGE }]);
    expect(ailogger.error).toHaveBeenCalledWith('Streamed validation operation failed:', failure);
  });
});
