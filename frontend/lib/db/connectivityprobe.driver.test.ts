// @vitest-environment node
import net, { type Server as NetServer, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pass-through: the real mysql2, with createConnection wrapped so the test can read the connection the probe
// opened. A vi.fn made with an implementation falls back to it under mockReset (@vitest/spy 3.2.4).
// The 'close' event is watched from the moment the connection exists: Socket.closed turns true when the destroy
// completes, before net emits 'close' (the handle's close callback), and mysql2 clears its connect timer in that event.
const socketCloseEvents = vi.hoisted(() => new WeakMap<object, Promise<void>>());

vi.mock('mysql2', async importOriginal => {
  const actual = await importOriginal<typeof import('mysql2')>();
  const createWatchedConnection = (...args: Parameters<typeof actual.createConnection>) => {
    const connection = actual.createConnection(...args);
    const { stream } = connection as unknown as { stream: import('node:net').Socket };
    socketCloseEvents.set(stream, new Promise<void>(resolve => stream.once('close', () => resolve())));
    return connection;
  };
  return { ...actual, createConnection: vi.fn(createWatchedConnection) };
});

import { createConnection, createServer } from 'mysql2';
import { HEALTH_DB_PROBE_TIMEOUT_MS, probeDatabaseConnectivity, resetDatabaseConnectivityCacheForTests } from './connectivityprobe';
import { buildSqlConnectionOptions } from './sqlconnectionoptions';

const LOOPBACK_HOST = '127.0.0.1';
const PROBE_USER = 'probe_user';
const FAKE_HOST_TEXT = 'db.fake-host.example';
const FIXTURE_CONTROL_SETTLE_MS = 200;
// First two bytes of a greeting packet header: enough for mysql2 to clear its connect timer.
const PARTIAL_GREETING = Buffer.from([0x4a, 0x00]);
const SELECT_ONE_COLUMN = {
  catalog: 'def',
  schema: '',
  table: '',
  orgTable: '',
  name: '1',
  orgName: '',
  characterSet: 63,
  columnLength: 1,
  columnType: 8,
  flags: 0,
  decimals: 0
};
const SERVER_HANDSHAKE = { protocolVersion: 10, serverVersion: '8.0.0-fake', connectionId: 1, statusFlags: 2, characterSet: 8, capabilityFlags: 0xffffff };
const MYSQL_ER_UNKNOWN_ERROR = 1105;

type ProtocolMode = 'answer' | 'error' | 'drop' | 'silent';

/** The untyped parts of mysql2's connection this file reads (its socket and connect timer). */
interface ProbeConnectionInternals {
  stream: Socket;
  connectTimeout: ReturnType<typeof setTimeout> | null;
}

interface ProtocolServerConnection extends EventEmitter {
  stream: Socket;
  sequenceId: number;
  serverHandshake(args: typeof SERVER_HANDSHAKE): void;
  writeTextResult(rows: unknown[], columns: unknown[]): void;
  writeError(args: { message: string; code: number }): void;
}

interface Fixture {
  server: NetServer;
  serverSockets: Socket[];
  events: string[];
}

const fixtures: Fixture[] = [];

function protocolFixture(mode: ProtocolMode): Fixture {
  const fixture: Fixture = { server: undefined as unknown as NetServer, serverSockets: [], events: [] };
  const mysqlServer = createServer(rawConnection => {
    const connection = rawConnection as unknown as ProtocolServerConnection;
    fixture.serverSockets.push(connection.stream);
    connection.on('error', (error: NodeJS.ErrnoException) => fixture.events.push(`error:${error.code}`));
    connection.on('quit', () => {
      fixture.events.push('quit');
      connection.stream.end();
    });
    connection.serverHandshake(SERVER_HANDSHAKE);
    connection.on('query', () => {
      // mysql2's server command loop doesn't reset the sequence id ("got packets out of order" is fixture noise).
      connection.sequenceId = 1;
      if (mode === 'answer') connection.writeTextResult([{ 1: 1 }], [SELECT_ONE_COLUMN]);
      else if (mode === 'error') connection.writeError({ message: `Access denied for ${FAKE_HOST_TEXT}`, code: MYSQL_ER_UNKNOWN_ERROR });
      else if (mode === 'drop') connection.stream.destroy();
    });
  });
  fixture.server = (mysqlServer as unknown as { _server: NetServer })._server;
  return fixture;
}

/** A wedged server or proxy: accepts, optionally sends a partial greeting, and never closes its side. */
function stalledFixture(initialBytes: Buffer | null): Fixture {
  const fixture: Fixture = { server: undefined as unknown as NetServer, serverSockets: [], events: [] };
  fixture.server = net.createServer({ allowHalfOpen: true }, socket => {
    fixture.serverSockets.push(socket);
    socket.on('error', () => fixture.events.push('server-socket-error'));
    if (initialBytes) socket.write(initialBytes);
  });
  return fixture;
}

async function pointProbeAt(fixture: Fixture): Promise<number> {
  fixtures.push(fixture);
  await new Promise<void>(resolve => fixture.server.listen(0, LOOPBACK_HOST, () => resolve()));
  const port = (fixture.server.address() as net.AddressInfo).port;
  vi.stubEnv('AZURE_SQL_SERVER', LOOPBACK_HOST);
  vi.stubEnv('AZURE_SQL_PORT', String(port));
  vi.stubEnv('AZURE_SQL_USER', PROBE_USER);
  vi.stubEnv('AZURE_SQL_PASSWORD', '');
  const resolvedHost = buildSqlConnectionOptions().host;
  if (resolvedHost !== LOOPBACK_HOST) {
    throw new Error(`REFUSING TO RUN: the probe would connect to '${resolvedHost}', not ${LOOPBACK_HOST}.`);
  }
  return port;
}

function probeConnection(): ProbeConnectionInternals {
  const lastResult = vi.mocked(createConnection).mock.results.at(-1);
  if (!lastResult || lastResult.type !== 'return') throw new Error('[driver test] the probe did not open a connection');
  return lastResult.value as unknown as ProbeConnectionInternals;
}

/** mysql2 clears its connect timer in the socket's async close handler, so wait for the close event before checking it. */
function waitForSocketClose(socket: Socket): Promise<void> {
  const closeEvent = socketCloseEvents.get(socket);
  if (!closeEvent) throw new Error('[driver test] the socket was not opened through the watched createConnection');
  return closeEvent;
}

function describeConnection(connection: ProbeConnectionInternals): string {
  return `destroyed=${connection.stream.destroyed} readyState=${connection.stream.readyState} connectTimer=${connection.connectTimeout === null ? 'cleared' : 'armed'}`;
}

describe('probeDatabaseConnectivity — driver (real mysql2, real timers, local fixtures)', () => {
  beforeEach(() => {
    resetDatabaseConnectivityCacheForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const fixture of fixtures.splice(0)) {
      for (const socket of fixture.serverSockets) socket.destroy();
      await new Promise<void>(resolve => fixture.server.close(() => resolve()));
    }
  });

  it('fixture control: mysql2 destroy() against a stalled server leaves the client socket open', async () => {
    const stalled = stalledFixture(PARTIAL_GREETING);
    const port = await pointProbeAt(stalled);
    const actual = await vi.importActual<typeof import('mysql2')>('mysql2');
    const control = actual.createConnection({ host: LOOPBACK_HOST, port, user: PROBE_USER }) as unknown as ProbeConnectionInternals &
      EventEmitter & { destroy(): void };
    control.on('error', () => undefined);
    await new Promise(resolve => setTimeout(resolve, FIXTURE_CONTROL_SETTLE_MS));
    control.destroy();
    await new Promise(resolve => setTimeout(resolve, FIXTURE_CONTROL_SETTLE_MS));

    console.log(`[fixture control] after mysql2 destroy(): ${describeConnection(control)}`);
    expect(control.stream.destroyed, 'the stalled fixture must hold its side open, so only a socket destroy closes it').toBe(false);
    control.stream.destroy();
  });

  it('success: pass, socket destroyed at once, connect timer cleared after close', async () => {
    const fixture = protocolFixture('answer');
    await pointProbeAt(fixture);

    const outcome = await probeDatabaseConnectivity();
    const connection = probeConnection();
    expect(connection.stream.destroyed).toBe(true);
    await waitForSocketClose(connection.stream);

    console.log(
      `[driver success] outcome=${JSON.stringify(outcome)} ${describeConnection(connection)} serverEvents=${JSON.stringify(fixture.events)} (COM_QUIT is best effort: logged, not asserted)`
    );
    expect(outcome).toMatchObject({ status: 'pass' });
    expect(connection.connectTimeout).toBeNull();
  });

  it('server error: unreachable, socket destroyed, and the late PROTOCOL_CONNECTION_LOST is handled', async () => {
    await pointProbeAt(protocolFixture('error'));

    const outcome = await probeDatabaseConnectivity();
    const connection = probeConnection();
    expect(connection.stream.destroyed).toBe(true);
    await waitForSocketClose(connection.stream);

    console.log(`[driver server error] outcome=${JSON.stringify(outcome)} ${describeConnection(connection)}`);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(JSON.stringify(outcome)).not.toContain(FAKE_HOST_TEXT);
    // An unhandled 'error' after teardown would make Vitest report an unhandled error and fail the run.
  });

  it('transport error (server drops the socket on SELECT 1): unreachable, socket destroyed', async () => {
    await pointProbeAt(protocolFixture('drop'));

    const outcome = await probeDatabaseConnectivity();
    const connection = probeConnection();
    await waitForSocketClose(connection.stream);

    console.log(`[driver transport error] outcome=${JSON.stringify(outcome)} ${describeConnection(connection)}`);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'unreachable' });
    expect(connection.stream.destroyed).toBe(true);
  });

  it('deadline during the query: timeout after HEALTH_DB_PROBE_TIMEOUT_MS, socket destroyed', async () => {
    await pointProbeAt(protocolFixture('silent'));

    const outcome = await probeDatabaseConnectivity();
    const connection = probeConnection();
    expect(connection.stream.destroyed).toBe(true);
    await waitForSocketClose(connection.stream);

    console.log(`[driver query deadline] outcome=${JSON.stringify(outcome)} ${describeConnection(connection)}`);
    expect(outcome).toMatchObject({ status: 'fail', reason: 'timeout' });
    expect(connection.connectTimeout).toBeNull();
  });

  it.each([
    ['a silent server', null, 'armed'],
    ['a partial greeting', PARTIAL_GREETING, 'cleared']
  ] as const)(
    'stalled handshake from %s: timeout, socket destroyed though the server holds its side, then a new probe passes',
    async (_label, initialBytes, connectTimerMidway) => {
      const stalled = stalledFixture(initialBytes);
      await pointProbeAt(stalled);

      const pending = probeDatabaseConnectivity();
      const connection = probeConnection();
      await new Promise(resolve => setTimeout(resolve, HEALTH_DB_PROBE_TIMEOUT_MS / 2));
      const midway = describeConnection(connection);
      expect(connection.stream.destroyed, 'positive control: the stalled socket is still open halfway to the deadline').toBe(false);
      expect(connection.connectTimeout === null ? 'cleared' : 'armed').toBe(connectTimerMidway);

      const outcome = await pending;
      expect(connection.stream.destroyed).toBe(true);
      await waitForSocketClose(connection.stream);
      console.log(
        `[driver stalled ${_label}] midway: ${midway}; outcome=${JSON.stringify(outcome)}; after: ${describeConnection(connection)} openServerSockets=${stalled.serverSockets.filter(socket => !socket.destroyed).length}`
      );
      expect(outcome).toMatchObject({ status: 'fail', reason: 'timeout' });
      expect(connection.connectTimeout).toBeNull();

      resetDatabaseConnectivityCacheForTests();
      await pointProbeAt(protocolFixture('answer'));
      const next = await probeDatabaseConnectivity();
      console.log(`[driver stalled ${_label}] next probe=${JSON.stringify(next)}`);
      expect(next).toMatchObject({ status: 'pass' });
    }
  );
});
