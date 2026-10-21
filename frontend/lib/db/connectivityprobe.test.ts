import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, type Connection } from 'mysql2';
import ailogger from '@/ailogger';
import { HEALTH_DB_PROBE_TIMEOUT_MS, HEALTH_DEEP_CACHE_MS, probeDatabaseConnectivity, resetDatabaseConnectivityCacheForTests } from './connectivityprobe';

vi.mock('mysql2', () => ({ createConnection: vi.fn() }));

const PROBE_QUERY = 'SELECT 1';
const FAKE_HOST_TEXT = 'db.fake-host.example';

type QueryCallback = (error: Error | null) => void;

/** Stand-in for mysql2's callback Connection: the test fires connect/error and answers the query. */
class FakeProbeConnection extends EventEmitter {
  readonly query = vi.fn<(sql: string, callback: QueryCallback) => void>();
  readonly end = vi.fn();
  readonly stream = { destroy: vi.fn() };

  answerQuery(error: Error | null = null) {
    const [, callback] = this.query.mock.calls[0];
    callback(error);
  }
}

function useFakeConnection(): FakeProbeConnection {
  const fake = new FakeProbeConnection();
  vi.mocked(createConnection).mockImplementationOnce(() => fake as unknown as Connection);
  return fake;
}

/** Lets the probe continue past its awaited race (fake timers: flushes microtasks without moving the clock). */
async function settleMicrotasks() {
  await vi.advanceTimersByTimeAsync(0);
}

// Nonzero so the probe's start and its settlement are different instants, and below HEALTH_DB_PROBE_TIMEOUT_MS so
// the deadline never fires. The cache must count HEALTH_DEEP_CACHE_MS from settlement.
const SLOW_PROBE_DURATION_MS = 2000;

type SlowProbeSettlement = {
  outcomeName: string;
  expectedStatus: 'pass' | 'fail';
  settle: (connection: FakeProbeConnection) => Promise<void>;
  defectIfReprobedEarly: string;
};

const SLOW_PROBE_SETTLEMENTS: SlowProbeSettlement[] = [
  {
    outcomeName: 'pass',
    expectedStatus: 'pass',
    settle: async connection => {
      connection.emit('connect');
      await settleMicrotasks();
      connection.answerQuery();
    },
    defectIfReprobedEarly: 'only failures are cached, or the TTL is measured from the probe start instead of its settlement'
  },
  {
    outcomeName: 'fail',
    expectedStatus: 'fail',
    settle: async connection => {
      connection.emit('error', new Error('connect ECONNREFUSED'));
    },
    defectIfReprobedEarly:
      'only passes are cached (no flood protection during an outage), or the TTL is measured from the probe start instead of its settlement'
  }
];

describe('probeDatabaseConnectivity — orchestration (mysql2 mocked, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDatabaseConnectivityCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pass: runs exactly SELECT 1 with no driver options, sends COM_QUIT then destroys the socket, and clears its deadline', async () => {
    const fake = useFakeConnection();
    const pending = probeDatabaseConnectivity();
    expect(vi.getTimerCount(), 'positive control: the probe deadline is pending').toBe(1);

    fake.emit('connect');
    await settleMicrotasks();
    fake.answerQuery();
    const outcome = await pending;

    console.log(
      `[probe pass] outcome=${JSON.stringify(outcome)} queryArgs=${fake.query.mock.calls[0].length} end=${fake.end.mock.calls.length} destroy=${fake.stream.destroy.mock.calls.length} timers=${vi.getTimerCount()}`
    );
    expect(outcome).toMatchObject({ status: 'pass' });
    expect(fake.query.mock.calls[0][0]).toBe(PROBE_QUERY);
    expect(fake.query.mock.calls[0], 'no options object, so no mysql2 query timeout').toHaveLength(2);
    expect(fake.end).toHaveBeenCalledTimes(1);
    expect(fake.stream.destroy).toHaveBeenCalledTimes(1);
    expect(fake.end.mock.invocationCallOrder[0]).toBeLessThan(fake.stream.destroy.mock.invocationCallOrder[0]);
    expect(vi.getTimerCount(), 'the deadline must be cleared').toBe(0);
  });

  it('connect never completes: timeout at the deadline, socket destroyed without COM_QUIT, and the teardown error is not logged', async () => {
    const fake = useFakeConnection();
    const pending = probeDatabaseConnectivity();

    await vi.advanceTimersByTimeAsync(HEALTH_DB_PROBE_TIMEOUT_MS);
    const outcome = await pending;
    const logCallsAtOutcome = vi.mocked(ailogger.error).mock.calls.length;
    fake.emit('error', Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' }));

    console.log(
      `[probe connect timeout] outcome=${JSON.stringify(outcome)} destroy=${fake.stream.destroy.mock.calls.length} end=${fake.end.mock.calls.length} logs=${JSON.stringify(vi.mocked(ailogger.error).mock.calls)}`
    );
    expect(outcome).toMatchObject({ status: 'fail', reason: 'timeout' });
    expect(fake.stream.destroy).toHaveBeenCalledTimes(1);
    expect(fake.end).not.toHaveBeenCalled();
    expect(logCallsAtOutcome, 'one log for the failed probe').toBe(1);
    expect(vi.mocked(ailogger.error).mock.calls.length, 'the post-teardown error must not be logged').toBe(logCallsAtOutcome);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('connect error: unreachable, logged once with step connect, socket destroyed, deadline cleared', async () => {
    const fake = useFakeConnection();
    const connectError = new Error(`connect ECONNREFUSED ${FAKE_HOST_TEXT}:3306`);
    const pending = probeDatabaseConnectivity();

    fake.emit('error', connectError);
    const outcome = await pending;

    const logCalls = vi.mocked(ailogger.error).mock.calls;
    console.log(`[probe connect error] outcome=${JSON.stringify(outcome)} logs=${JSON.stringify(logCalls)}`);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0][1]).toBe(connectError);
    expect(logCalls[0][2]).toMatchObject({ step: 'connect' });
    expect(fake.stream.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('query error naming a host: unreachable, the host is in the log but not in the outcome, and a later error event does not throw', async () => {
    const fake = useFakeConnection();
    const queryError = new Error(`Access denied for ${FAKE_HOST_TEXT}`);
    const pending = probeDatabaseConnectivity();

    fake.emit('connect');
    await settleMicrotasks();
    fake.answerQuery(queryError);
    const outcome = await pending;

    console.log(
      `[probe query error] outcome=${JSON.stringify(outcome)} logs=${JSON.stringify(vi.mocked(ailogger.error).mock.calls.map(call => [call[0], String(call[1]), call[2]]))}`
    );
    expect(outcome).toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(JSON.stringify(outcome)).not.toContain(FAKE_HOST_TEXT);
    expect(vi.mocked(ailogger.error).mock.calls[0][1]).toBe(queryError);
    expect(vi.mocked(ailogger.error).mock.calls[0][2]).toMatchObject({ step: 'query' });
    // mysql2 emits error after this teardown; with no listener left this emit would throw.
    expect(() => fake.emit('error', new Error('Connection lost'))).not.toThrow();
  });

  it('createConnection throws: unreachable and logged, nothing to destroy', async () => {
    const optionError = new Error('Unknown charset');
    vi.mocked(createConnection).mockImplementationOnce(() => {
      throw optionError;
    });

    const outcome = await probeDatabaseConnectivity();

    console.log(`[probe createConnection throws] outcome=${JSON.stringify(outcome)} logs=${vi.mocked(ailogger.error).mock.calls.length}`);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(vi.mocked(ailogger.error).mock.calls[0][1]).toBe(optionError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('teardown throws while handling a connect error: still resolves unreachable, logs the unexpected failure, and a new probe runs after HEALTH_DEEP_CACHE_MS', async () => {
    const brokenTeardown = useFakeConnection();
    const teardownError = new Error('stream.destroy blew up');
    brokenTeardown.stream.destroy.mockImplementation(() => {
      throw teardownError;
    });
    const pending = probeDatabaseConnectivity();

    brokenTeardown.emit('error', new Error('connect ECONNREFUSED'));
    const outcome = await pending.then(
      settled => settled,
      rejection => ({ rejectedWith: String(rejection) })
    );
    console.log(
      `[probe unexpected throw] outcome=${JSON.stringify(outcome)} logs=${JSON.stringify(vi.mocked(ailogger.error).mock.calls.map(call => [call[0], String(call[1])]))}`
    );
    expect(outcome, 'the probe must never reject').toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(vi.mocked(ailogger.error).mock.calls.some(call => call[1] === teardownError)).toBe(true);

    const createConnectionCallsAfterFailure = vi.mocked(createConnection).mock.calls.length;
    await vi.advanceTimersByTimeAsync(HEALTH_DEEP_CACHE_MS);
    const replacement = useFakeConnection();
    const replacementPending = probeDatabaseConnectivity();
    console.log(`[probe unexpected throw] createConnection calls ${createConnectionCallsAfterFailure} -> ${vi.mocked(createConnection).mock.calls.length}`);
    expect(vi.mocked(createConnection), 'the failure must be cached for HEALTH_DEEP_CACHE_MS only, then a new probe connects').toHaveBeenCalledTimes(
      createConnectionCallsAfterFailure + 1
    );
    replacement.emit('connect');
    await settleMicrotasks();
    replacement.answerQuery();
    expect(await replacementPending).toMatchObject({ status: 'pass' });
  });

  it('single flight: two calls before settlement share one connection and one outcome', async () => {
    const fake = useFakeConnection();
    const first = probeDatabaseConnectivity();
    const second = probeDatabaseConnectivity();

    fake.emit('connect');
    await settleMicrotasks();
    fake.answerQuery();

    console.log(`[probe single flight] createConnection calls=${vi.mocked(createConnection).mock.calls.length} samePromise=${first === second}`);
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(1);
    expect(await second).toEqual(await first);
  });

  it.each(SLOW_PROBE_SETTLEMENTS)(
    'a slow $outcomeName is reused until settlement + HEALTH_DEEP_CACHE_MS - 1 ms and replaced at settlement + HEALTH_DEEP_CACHE_MS',
    async ({ expectedStatus, settle, defectIfReprobedEarly }) => {
      const slowProbe = useFakeConnection();
      const startedAt = Date.now();
      const firstPending = probeDatabaseConnectivity();
      await vi.advanceTimersByTimeAsync(SLOW_PROBE_DURATION_MS);
      await settle(slowProbe);
      const firstOutcome = await firstPending;
      const settledAt = Date.now();
      console.log(`[probe cache ${expectedStatus}] startedAt=${startedAt} settledAt=${settledAt} first=${JSON.stringify(firstOutcome)}`);
      expect(firstOutcome, 'positive control: the first probe settled with the expected status').toMatchObject({ status: expectedStatus });
      expect(settledAt - startedAt, 'positive control: settlement is SLOW_PROBE_DURATION_MS after the start, so the two TTL anchors differ').toBe(
        SLOW_PROBE_DURATION_MS
      );

      await vi.advanceTimersByTimeAsync(HEALTH_DEEP_CACHE_MS - 1);
      const callsJustBeforeExpiry = vi.mocked(createConnection).mock.calls.length;
      const reusedPending = probeDatabaseConnectivity();
      const callsAfterReuseRequest = vi.mocked(createConnection).mock.calls.length;
      const reused = await reusedPending;
      console.log(
        `[probe cache ${expectedStatus}] at settlement+${Date.now() - settledAt} ms (start+${Date.now() - startedAt} ms): createConnection calls ${callsJustBeforeExpiry} -> ${callsAfterReuseRequest} reused=${JSON.stringify(reused)}`
      );
      expect(callsAfterReuseRequest, `still cached at settlement + TTL - 1 ms; a new connection here means ${defectIfReprobedEarly}`).toBe(1);
      expect(reused).toEqual(firstOutcome);

      await vi.advanceTimersByTimeAsync(1);
      const replacement = useFakeConnection();
      const replacementPending = probeDatabaseConnectivity();
      const callsAtExpiry = vi.mocked(createConnection).mock.calls.length;
      console.log(`[probe cache ${expectedStatus}] at settlement+${Date.now() - settledAt} ms: createConnection calls=${callsAtExpiry}`);
      expect(
        callsAtExpiry,
        'at settlement + TTL the cached outcome has expired, so a new probe connects (catches a TTL that is too long or never expires)'
      ).toBe(2);
      replacement.emit('error', new Error('connect ECONNREFUSED'));
      expect(await replacementPending).toMatchObject({ status: 'fail', reason: 'unreachable' });
    }
  );

  it('after a timeout, the cache expires at HEALTH_DEEP_CACHE_MS and a new connection can pass', async () => {
    useFakeConnection();
    const timedOut = probeDatabaseConnectivity();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_PROBE_TIMEOUT_MS);
    expect(await timedOut).toMatchObject({ status: 'fail', reason: 'timeout' });

    await vi.advanceTimersByTimeAsync(HEALTH_DEEP_CACHE_MS);
    const healthy = useFakeConnection();
    const recovered = probeDatabaseConnectivity();
    healthy.emit('connect');
    await settleMicrotasks();
    healthy.answerQuery();

    const outcome = await recovered;
    console.log(`[probe recovery] outcome=${JSON.stringify(outcome)} createConnection calls=${vi.mocked(createConnection).mock.calls.length}`);
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ status: 'pass' });
  });
});
