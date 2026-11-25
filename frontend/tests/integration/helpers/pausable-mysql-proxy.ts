import net from 'node:net';

/**
 * Minimal TCP proxy for MySQL deadline tests (#563, R7). client→server bytes always flow; server→client bytes flow
 * unless that connection is paused, in which case they are DROPPED (a withheld reply). Either side closing destroys
 * the other, so a client end reaches the server as EOF even while paused. Stateless on the server: if the runner
 * dies, the sockets close and the server rolls back.
 */
export interface PausableMysqlProxy {
  readonly port: number;
  /** Stop forwarding server→client bytes for one connection (keyed by the client's local port). */
  pauseResponses(clientPort: number): void;
  /** Same, for every currently open connection except these; returns the client ports it paused. */
  pauseResponsesExcept(clientPorts: readonly number[]): number[];
  /** Destroy both sockets of one connection (a reset as the client sees it). */
  sever(clientPort: number): void;
  /** True once the client side ended or closed (mysql2 destroy() half-closes, which counts). */
  isClientClosed(clientPort: number): boolean;
  /** Destroy every socket and close the listener. */
  close(): Promise<void>;
}

interface ProxiedConnection {
  client: net.Socket;
  upstream: net.Socket;
  responsesPaused: boolean;
  clientClosed: boolean;
}

const LOOPBACK_HOST = '127.0.0.1';
const EPHEMERAL_PORT = 0;

export function startPausableMysqlProxy(target: { host: string; port: number }): Promise<PausableMysqlProxy> {
  const connections = new Map<number, ProxiedConnection>();

  const server = net.createServer(client => {
    const clientPort = client.remotePort;
    if (clientPort === undefined) {
      client.destroy();
      return;
    }
    const upstream = net.connect(target.port, target.host);
    const proxied: ProxiedConnection = { client, upstream, responsesPaused: false, clientClosed: false };
    connections.set(clientPort, proxied);

    client.on('data', chunk => upstream.write(chunk));
    upstream.on('data', chunk => {
      if (!proxied.responsesPaused) client.write(chunk);
    });
    const onClientGone = () => {
      proxied.clientClosed = true;
      upstream.destroy();
    };
    client.on('end', onClientGone);
    client.on('close', onClientGone);
    client.on('error', onClientGone);
    upstream.on('close', () => client.destroy());
    upstream.on('error', () => client.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(EPHEMERAL_PORT, LOOPBACK_HOST, () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        pauseResponses(clientPort) {
          const proxied = connections.get(clientPort);
          if (!proxied) throw new Error(`No proxied connection for client port ${clientPort}`);
          proxied.responsesPaused = true;
        },
        pauseResponsesExcept(clientPorts) {
          const paused: number[] = [];
          for (const [clientPort, proxied] of connections) {
            if (proxied.clientClosed || clientPorts.includes(clientPort)) continue;
            proxied.responsesPaused = true;
            paused.push(clientPort);
          }
          return paused;
        },
        sever(clientPort) {
          const proxied = connections.get(clientPort);
          if (!proxied) return;
          proxied.client.destroy();
          proxied.upstream.destroy();
        },
        isClientClosed(clientPort) {
          return connections.get(clientPort)?.clientClosed ?? false;
        },
        close() {
          for (const proxied of connections.values()) {
            proxied.client.destroy();
            proxied.upstream.destroy();
          }
          return new Promise<void>(resolveClose => server.close(() => resolveClose()));
        }
      });
    });
  });
}
