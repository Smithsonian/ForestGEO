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
  connectionLimit: 15, // Reduced for production stability
  queueLimit: 25, // Increased queue to handle burst requests
  keepAliveInitialDelay: 0,
  enableKeepAlive: true,
  connectTimeout: 30000, // Increased to 30 seconds for deployed environment
  acquireTimeout: 60000, // 1 minute timeout for acquiring connections
  timeout: 300000, // 5 minute query timeout for large operations
  reconnect: true, // Enable automatic reconnection
  idleTimeout: 900000, // 15 minutes idle timeout
  maxReconnects: 3, // Maximum reconnection attempts
  // Azure SQL specific optimizations
  ssl: {
    rejectUnauthorized: false // Required for Azure SQL
  },
  // Additional production-specific settings
  charset: 'utf8mb4',
  timezone: 'Z' // Use UTC timezone
};

export function getPoolMonitorInstance(): PoolMonitor {
  if (!monitor) {
    monitor = new PoolMonitor(sqlConfig);
  }
  return monitor;
}
