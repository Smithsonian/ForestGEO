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
const TRANSACTION_ID = 'tx-574';
const SUBMITTED_ROW = { quadratName: 'Q01' };

function mysqlError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function connectionManagerWithRollback(rollbackTransaction = vi.fn(async () => undefined)) {
  return { connection: { rollbackTransaction } as unknown as ConnectionManager, rollbackTransaction };
}

async function readResponse(response: Response) {
  const text = await response.text();
  console.log('[handleError answered]', response.status, text);
  return { status: response.status, text, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleError', () => {
  it('answers 500 with the fixed message and logs the database error', async () => {
    const failure = mysqlError(SECRET_DATABASE_MESSAGE, 'ER_BAD_FIELD_ERROR');
    const { connection } = connectionManagerWithRollback();

    const { status, text, body } = await readResponse(await handleError(failure, connection, SUBMITTED_ROW));

    expect(status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ message: INTERNAL_SERVER_ERROR_MESSAGE, row: SUBMITTED_ROW });
    expect(text).not.toContain('secret_column_574');
    expect(ailogger.error).toHaveBeenCalledWith('SQL Error:', failure);
  });

  it('answers 409 with a message about the duplicate, without the key or schema name', async () => {
    const failure = mysqlError(DUPLICATE_DATABASE_MESSAGE, 'ER_DUP_ENTRY');
    const { connection } = connectionManagerWithRollback();

    const { status, text, body } = await readResponse(await handleError(failure, connection, SUBMITTED_ROW));

    expect(status).toBe(HTTPResponses.CONFLICT);
    expect(body).toEqual({ message: DUPLICATE_ENTRY_MESSAGE, row: SUBMITTED_ROW });
    expect(text).not.toContain('forestgeo_secretsite');
    expect(ailogger.error).toHaveBeenCalledWith('SQL Error:', failure);
  });

  it('rolls back the named transaction and still hides the error when the rollback itself fails', async () => {
    const rollbackFailure = new Error('rollback failed on forestgeo_secretsite');
    const { connection, rollbackTransaction } = connectionManagerWithRollback(vi.fn(async () => Promise.reject(rollbackFailure)));

    const { status, text } = await readResponse(
      await handleError(mysqlError(SECRET_DATABASE_MESSAGE, 'ER_BAD_FIELD_ERROR'), connection, SUBMITTED_ROW, TRANSACTION_ID)
    );

    expect(rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(text).not.toContain('forestgeo_secretsite');
    expect(ailogger.error).toHaveBeenCalledWith('Failed to rollback transaction:', rollbackFailure);
  });
});
