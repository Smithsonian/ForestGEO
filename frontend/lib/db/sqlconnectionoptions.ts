import type { ConnectionOptions } from 'mysql2';

const LOCAL_SQL_HOSTS = ['127.0.0.1', 'localhost'];
const SQL_CONNECT_TIMEOUT_MS = 30000;

/**
 * Connection settings shared by the app pool and the deep health probe, read from AZURE_SQL_* when called.
 * Pool-only settings (waitForConnections, connectionLimit, queueLimit, idleTimeout) stay in the pool singleton.
 */
export function buildSqlConnectionOptions(): ConnectionOptions {
  const sqlHost = process.env.AZURE_SQL_SERVER;
  const isLocalSqlHost = sqlHost !== undefined && LOCAL_SQL_HOSTS.includes(sqlHost);
  return {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    host: sqlHost,
    port: parseInt(process.env.AZURE_SQL_PORT!),
    // NOTE: No default database is set intentionally - the system uses fully-qualified
    // table names (schema.table) for multi-schema support. The ConnectionManager
    // dynamically sets database context via USE statement before each query to work
    // around a mysql2 library quirk where FQN alone isn't recognized without context.
    // See: https://stackoverflow.com/questions/57598136
    keepAliveInitialDelay: 0,
    enableKeepAlive: true,
    connectTimeout: SQL_CONNECT_TIMEOUT_MS,
    // Azure requires TLS; local MySQL does not. Passing an SSL config for a local
    // IP makes modern Node reject the IP as a TLS ServerName before connecting.
    ...(!isLocalSqlHost && { ssl: { rejectUnauthorized: false } }),
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z'
  };
}
