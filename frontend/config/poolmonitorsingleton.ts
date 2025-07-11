// poolmonitorsingleton.ts
import { PoolMonitor } from '@/config/poolmonitor';
import { PoolOptions } from 'mysql2/promise';

let monitor: PoolMonitor | null = null;
const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 100, // Lower limit if 100 is excessive for your DB
  queueLimit: 0, // unlimited queue size
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
  connectTimeout: 30000 // 10 seconds by default.
};

export function getPoolMonitorInstance(): PoolMonitor {
  if (!monitor) {
    monitor = new PoolMonitor(sqlConfig);
  }
  return monitor;
}
