import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, poolMonitor, runQuery } from '@/components/processors/processormacros';

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
    const connection = await getConn();
    try {
      await connection.ping(); // Validate connection
      return connection;
    } catch (error) {
      console.error(chalk.red('Error validating connection:', error));
      connection.release(); // Release if validation fails
      poolMonitor.trackConnectionRelease(connection);
      throw error;
    }
  }

  // Existing method: Acquire a single connection (for backward compatibility)
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
        poolMonitor.trackConnectionRelease(connection); // Explicitly track release
      }
    }
  }

  // Existing method: Begin a transaction
  public async beginTransaction(timeout: number = 10000): Promise<void> {
    const connection = await this.acquireConnectionInternal();
    try {
      const timer = setTimeout(() => {
        console.warn(chalk.yellow('Transaction timeout exceeded.'));
        throw new Error('Transaction timeout exceeded.');
      }, timeout);

      await connection.beginTransaction();
      clearTimeout(timer); // Clear the timer if transaction starts successfully
      console.log(chalk.green('Transaction started.'));
      (this as any)._transactionConnection = connection;
    } catch (error) {
      console.error(chalk.red('Error starting transaction:', error));
      connection.release(); // Release connection on failure
      throw error;
    }
  }

  // Existing method: Commit a transaction
  public async commitTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;
    if (connection) {
      try {
        await connection.commit();
      } catch (error) {
        console.error(chalk.red('Error committing transaction:', error));
        throw error;
      } finally {
        connection.release(); // Ensure connection is always released
        delete (this as any)._transactionConnection;
      }
    }
  }

  public async rollbackTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;
    if (connection) {
      try {
        await connection.rollback();
      } catch (error) {
        console.error(chalk.red('Error rolling back transaction:', error));
        throw error;
      } finally {
        connection.release(); // Ensure connection is always released
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
