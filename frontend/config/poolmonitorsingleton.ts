// poolmonitorsingleton.ts
import { PoolMonitor } from '@/config/poolmonitor';
import { PoolOptions } from 'mysql2/promise';

let monitor: PoolMonitor | null = null;
const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  // NOTE: No default database is set intentionally - the system uses fully-qualified
  // table names (schema.table) for multi-schema support. The ConnectionManager
  // dynamically sets database context via USE statement before each query to work
  // around a mysql2 library quirk where FQN alone isn't recognized without context.
  // See: https://stackoverflow.com/questions/57598136
  waitForConnections: true,
  connectionLimit: 15, // Reduced for production stability
  queueLimit: 25, // Increased queue to handle burst requests
  keepAliveInitialDelay: 0,
  enableKeepAlive: true,
  connectTimeout: 30000, // Increased to 30 seconds for deployed environment
  idleTimeout: 300000, // 5 minutes idle timeout
  // Azure SQL specific optimizations
  ssl: {
    rejectUnauthorized: false // Required for Azure SQL
  },
  // Additional production-specific settings
  charset: 'utf8mb4_0900_ai_ci',
  timezone: 'Z' // Use UTC timezone
};

export function getPoolMonitorInstance(): PoolMonitor {
  if (!monitor) {
    monitor = new PoolMonitor(sqlConfig);
  }
  return monitor;
}
