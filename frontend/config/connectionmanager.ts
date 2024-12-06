import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';

class ConnectionManager {
  private static instance: ConnectionManager | null = null; // Singleton instance

  // Private constructor
  private constructor() {
    console.log(chalk.green('ConnectionManager initialized as a singleton.'));
  }

  // Singleton instance getter
  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  // Acquire a connection for the current operation
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    console.log(chalk.cyan('Acquiring a connection for operation...'));
    return await getConn(); // Delegates to PoolMonitor indirectly via processormacros
  }

  // Existing method: Acquire a single connection (for backward compatibility)
  public async acquireConnection(): Promise<void> {
    console.warn(chalk.yellow('Warning: acquireConnection is deprecated for concurrency. Consider managing connections dynamically.'));
    // This function is a no-op for concurrency but must be preserved for compatibility
  }

  // Existing method: Execute a query (preserves function signature)
  public async executeQuery(query: string, params?: any[]): Promise<any> {
    let connection: PoolConnection | null = null;

    try {
      connection = await this.acquireConnectionInternal();
      const isModifyingQuery = query.trim().match(/^(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)/i);

      if (isModifyingQuery) {
        console.warn(chalk.yellow('Warning: Modifying query detected. For optimal safety, consider wrapping modifying queries in transactions.'));
      }

      // Execute the query using the dynamic connection
      return await runQuery(connection, query, params);
    } catch (error) {
      console.error(chalk.red('Error executing query:', error));
      throw error;
    } finally {
      if (connection) {
        console.log(chalk.blue('Releasing connection after query execution.'));
        connection.release();
      }
    }
  }

  // Existing method: Begin a transaction
  public async beginTransaction(): Promise<void> {
    const connection = await this.acquireConnectionInternal();
    console.log(chalk.cyan('Starting transaction...'));
    await connection.beginTransaction();
    console.log(chalk.green('Transaction started.'));
    // Store the connection on the class instance for backward compatibility
    (this as any)._transactionConnection = connection;
  }

  // Existing method: Commit a transaction
  public async commitTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;
    if (connection) {
      try {
        await connection.commit();
      } finally {
        connection.release(); // Always release the connection
        delete (this as any)._transactionConnection;
      }
    }
  }

  // Existing method: Rollback a transaction
  public async rollbackTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;
    if (connection) {
      try {
        await connection.rollback();
      } finally {
        connection.release(); // Always release the connection
        delete (this as any)._transactionConnection;
      }
    }
  }

  // Existing method: Close connection
  public async closeConnection(): Promise<void> {
    console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
    // This function is a no-op for concurrency but must be preserved for compatibility
  }
}

export default ConnectionManager;
