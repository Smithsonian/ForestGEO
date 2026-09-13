import { describe, expect, it } from 'vitest';
import { isMissingTableError } from '@/lib/errorhelpers';

const UPLOAD_SESSIONS_TABLE = 'upload_sessions';
const MISSING_UPLOAD_SESSIONS_MESSAGE = "Table 'forestgeo_testing.upload_sessions' doesn't exist";
const MISSING_ATTRIBUTES_MESSAGE = "Table 'forestgeo_testing.attributes' doesn't exist";

function mysqlError(code: string, message: string): Error & { code: string; sqlMessage: string } {
  return Object.assign(new Error(message), { code, sqlMessage: message });
}

describe('isMissingTableError', () => {
  it('matches ER_NO_SUCH_TABLE for the named table', () => {
    const error = mysqlError('ER_NO_SUCH_TABLE', MISSING_UPLOAD_SESSIONS_MESSAGE);
    expect(isMissingTableError(error, UPLOAD_SESSIONS_TABLE), `error: ${error.message}`).toBe(true);
  });

  it('does not swallow a missing table other than the one named, so unrelated schema drift still propagates', () => {
    const error = mysqlError('ER_NO_SUCH_TABLE', MISSING_ATTRIBUTES_MESSAGE);
    expect(isMissingTableError(error, UPLOAD_SESSIONS_TABLE), `error: ${error.message}`).toBe(false);
  });

  it('matches any missing table when no table name is given', () => {
    expect(isMissingTableError(mysqlError('ER_NO_SUCH_TABLE', MISSING_ATTRIBUTES_MESSAGE))).toBe(true);
  });

  it('recognises the message form when a driver wrapper dropped the error code', () => {
    expect(isMissingTableError(new Error(MISSING_UPLOAD_SESSIONS_MESSAGE), UPLOAD_SESSIONS_TABLE)).toBe(true);
  });

  it('rejects errors that merely mention the table, and non-error values', () => {
    const lockWait = mysqlError('ER_LOCK_WAIT_TIMEOUT', `Lock wait timeout exceeded on ${UPLOAD_SESSIONS_TABLE}`);
    expect(isMissingTableError(lockWait, UPLOAD_SESSIONS_TABLE)).toBe(false);
    expect(isMissingTableError(null, UPLOAD_SESSIONS_TABLE)).toBe(false);
    expect(isMissingTableError(MISSING_UPLOAD_SESSIONS_MESSAGE, UPLOAD_SESSIONS_TABLE)).toBe(false);
  });
});
