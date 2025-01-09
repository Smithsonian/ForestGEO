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
    try {
      const connection = await getConn(); // Reuse getConn from processormacros
      await connection.ping(); // Validate connection
      console.log(chalk.green('Connection validated.'));
      return connection;
    } catch (error) {
      console.error(chalk.red('Error acquiring or validating connection:', error));
      throw error;
    }
  }

  // Execute a query using the acquired connection
  public async executeQuery(query: string, params?: any[]): Promise<any> {
    let connection: PoolConnection | null = null;

    try {
      connection = await this.acquireConnectionInternal(); // Acquire connection
      const isModifyingQuery = query.trim().match(/^(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)/i);

      if (isModifyingQuery) {
        console.warn(chalk.yellow('Warning: Modifying query detected. For optimal safety, consider wrapping modifying queries in transactions.'));
      }

      // Execute the query using the helper function
      return await runQuery(connection, query, params);
    } catch (error) {
      console.error(chalk.red('Error executing query:', error));
      throw error;
    } finally {
      if (connection) {
        console.log(chalk.blue('Releasing connection after query execution.'));
        connection.release(); // Ensure connection is released
      }
    }
  }

  // Begin a transaction
  public async beginTransaction(timeout: number = 10000): Promise<void> {
    let connection: PoolConnection | null = null;

    try {
      connection = await this.acquireConnectionInternal();
      const timer = setTimeout(() => {
        console.warn(chalk.yellow('Transaction timeout exceeded.'));
        throw new Error('Transaction timeout exceeded.');
      }, timeout);

      await connection.beginTransaction();
      clearTimeout(timer);
      console.log(chalk.green('Transaction started.'));
      (this as any)._transactionConnection = connection;
    } catch (error) {
      if (connection) connection.release();
      console.error(chalk.red('Error starting transaction:', error));
      throw error;
    }
  }

  // Commit a transaction
  public async commitTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;

    if (connection) {
      try {
        await connection.commit();
        console.log(chalk.green('Transaction committed.'));
      } catch (error) {
        console.error(chalk.red('Error committing transaction:', error));
        throw error;
      } finally {
        connection.release(); // Ensure connection is always released
        delete (this as any)._transactionConnection;
      }
    }
  }

  // Rollback a transaction
  public async rollbackTransaction(): Promise<void> {
    const connection = (this as any)._transactionConnection;

    if (connection) {
      try {
        await connection.rollback();
        console.log(chalk.yellow('Transaction rolled back.'));
      } catch (error) {
        console.error(chalk.red('Error rolling back transaction:', error));
        throw error;
      } finally {
        connection.release(); // Ensure connection is always released
        delete (this as any)._transactionConnection;
      }
    }
  }

  // Close connection method (no-op for compatibility)
  public async closeConnection(): Promise<void> {
    console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
  }
}

export default ConnectionManager;
