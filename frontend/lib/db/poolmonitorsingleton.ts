// poolmonitorsingleton.ts
import { PoolMonitor } from '@/lib/db/poolmonitor';
import { PoolOptions } from 'mysql2/promise';
import { buildSqlConnectionOptions } from '@/lib/db/sqlconnectionoptions';

let monitor: PoolMonitor | null = null;
const sqlConfig: PoolOptions = {
  ...buildSqlConnectionOptions(),
  waitForConnections: true,
  connectionLimit: 15, // Reduced for production stability
  queueLimit: 25, // Increased queue to handle burst requests
  idleTimeout: 300000 // 5 minutes idle timeout
};

export function getPoolMonitorInstance(): PoolMonitor {
  if (!monitor) {
    monitor = new PoolMonitor(sqlConfig);
  }
  return monitor;
}
