import { describe, expect, it } from 'vitest';
import {
  TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE,
  TRANSACTION_NOT_ACTIVE_CODE,
  TRANSACTION_REAPED_CODE,
  TransactionCommitOutcomeUnknownError,
  TransactionNotActiveError,
  TransactionReapedError
} from './transactionerrors';
import { findRetryClassifierSubstrings } from '@/tests/setup/retry-classifier-substrings';

const TRANSACTION_ID = 'tx-563-errors';
const COMMIT_DEADLINE_MS = 30_000;
const DEADLINE_AT = 1_700_000_000_000;
const REAPED_AT = DEADLINE_AT + 1_234;
const TRANSPORT_LOSS_MESSAGE = 'Connection lost: The server closed the connection.';

function transportLossError(): Error {
  return Object.assign(new Error(TRANSPORT_LOSS_MESSAGE), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true, sqlMessage: undefined });
}

describe('transaction error classes (#563, spec §5.1)', () => {
  it('TransactionCommitOutcomeUnknownError carries its trigger, deadline and cause, and its message never embeds the cause', () => {
    const cause = transportLossError();
    const error = new TransactionCommitOutcomeUnknownError(TRANSACTION_ID, 'connection_lost', COMMIT_DEADLINE_MS, { cause });
    console.log('[errors] commit-outcome-unknown:', { name: error.name, code: error.code, message: error.message });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionCommitOutcomeUnknownError');
    expect(error.code).toBe(TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE);
    expect(error.transactionId).toBe(TRANSACTION_ID);
    expect(error.trigger).toBe('connection_lost');
    expect(error.deadlineMs).toBe(COMMIT_DEADLINE_MS);
    expect(error.cause, 'the transport error must be reachable through .cause, unchanged').toBe(cause);
    expect(error.message).not.toContain(TRANSPORT_LOSS_MESSAGE);
  });

  it('TransactionCommitOutcomeUnknownError without a cause (deadline trigger) has no cause property value', () => {
    const error = new TransactionCommitOutcomeUnknownError(TRANSACTION_ID, 'deadline_exceeded', COMMIT_DEADLINE_MS);
    expect(error.trigger).toBe('deadline_exceeded');
    expect(error.cause).toBeUndefined();
  });

  it('TransactionReapedError carries the deadline and reap time', () => {
    const error = new TransactionReapedError(TRANSACTION_ID, DEADLINE_AT, REAPED_AT);
    console.log('[errors] reaped:', { name: error.name, code: error.code, message: error.message });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionReapedError');
    expect(error.code).toBe(TRANSACTION_REAPED_CODE);
    expect(error.transactionId).toBe(TRANSACTION_ID);
    expect(error.deadlineAt).toBe(DEADLINE_AT);
    expect(error.reapedAt).toBe(REAPED_AT);
  });

  it('TransactionNotActiveError says the call committed nothing', () => {
    const error = new TransactionNotActiveError(TRANSACTION_ID);
    console.log('[errors] not-active:', { name: error.name, code: error.code, message: error.message });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionNotActiveError');
    expect(error.code).toBe(TRANSACTION_NOT_ACTIVE_CODE);
    expect(error.transactionId).toBe(TRANSACTION_ID);
    expect(error.message).toMatch(/committed nothing/);
  });

  it.each([
    [
      'TransactionCommitOutcomeUnknownError',
      () => new TransactionCommitOutcomeUnknownError(TRANSACTION_ID, 'connection_lost', COMMIT_DEADLINE_MS, { cause: transportLossError() })
    ],
    ['TransactionReapedError', () => new TransactionReapedError(TRANSACTION_ID, DEADLINE_AT, REAPED_AT)],
    ['TransactionNotActiveError', () => new TransactionNotActiveError(TRANSACTION_ID)]
  ])('%s message contains no retry-classifier substring', (_label, build) => {
    const message = build().message;
    const matches = findRetryClassifierSubstrings(message);
    console.log(`[errors] ${_label} message="${message}" classifierMatches=${JSON.stringify(matches)}`);
    expect(matches, `message would be classified as retryable or as an upload-session conflict: "${message}"`).toEqual([]);
  });
});
