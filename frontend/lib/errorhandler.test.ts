import { beforeEach, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';
import { DUPLICATE_ENTRY_MESSAGE, handleError } from './errorhandler';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

const SECRET_DATABASE_MESSAGE = "Unknown column 'secret_column_574' in 'forestgeo_secretsite.quadrats'";
const DUPLICATE_DATABASE_MESSAGE = "Duplicate entry 'Q01' for key 'forestgeo_secretsite.quadrats.QuadratName'";
const SUBMITTED_ROW = { quadratName: 'Q01' };

function mysqlError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const UNUSED_CONNECTION = {} as ConnectionManager;

async function readResponse(response: Response) {
  const text = await response.text();
  console.log('[handleError answered]', response.status, text);
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleError', () => {
  it('answers 500 with the fixed message and logs the database error', async () => {
    const failure = mysqlError(SECRET_DATABASE_MESSAGE, 'ER_BAD_FIELD_ERROR');
    const { status, body } = await readResponse(await handleError(failure, UNUSED_CONNECTION, SUBMITTED_ROW));

    expect(status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ message: INTERNAL_SERVER_ERROR_MESSAGE, row: SUBMITTED_ROW });
    expect(ailogger.error).toHaveBeenCalledWith('SQL Error:', failure);
  });

  it('answers 409 with a message about the duplicate, without the key or schema name', async () => {
    const failure = mysqlError(DUPLICATE_DATABASE_MESSAGE, 'ER_DUP_ENTRY');
    const { status, body } = await readResponse(await handleError(failure, UNUSED_CONNECTION, SUBMITTED_ROW));

    expect(status).toBe(HTTPResponses.CONFLICT);
    expect(body).toEqual({ message: DUPLICATE_ENTRY_MESSAGE, row: SUBMITTED_ROW });
    expect(ailogger.error).toHaveBeenCalledWith('SQL Error:', failure);
  });
});
