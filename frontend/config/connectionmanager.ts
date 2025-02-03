import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { v4 as uuidv4 } from 'uuid'; // For generating unique transaction IDs

class ConnectionManager {
  private static instance: ConnectionManager | null = null; // Singleton instance
  private transactionConnections = new Map<string, PoolConnection>(); // Store transaction-specific connections

  // Private constructor
  private constructor() {
    // console.log(chalk.green('ConnectionManager initialized as a singleton.'));
  }

  // Singleton instance getter
  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  // Execute a query using the acquired connection
  public async executeQuery(query: string, params?: any[], transactionId?: string): Promise<any> {
    const connection = transactionId ? this.transactionConnections.get(transactionId) : await this.acquireConnectionInternal();

    if (!connection) {
      throw new Error(transactionId ? `No connection found for transaction: ${transactionId}` : 'Unable to acquire connection.');
    }

    try {
      return await runQuery(connection, query, params);
    } catch (error) {
      console.error(chalk.red('Error executing query:', error));
      throw error;
    } finally {
      if (!transactionId) {
        connection.release(); // Release if not part of a transaction
      }
    }
  }

  // Begin a transaction
  public async beginTransaction(): Promise<string> {
    const transactionId = uuidv4(); // Generate a unique transaction ID
    const connection = await this.acquireConnectionInternal();

    try {
      await connection.beginTransaction();
      this.transactionConnections.set(transactionId, connection); // Store the connection
      console.log(chalk.green(`Transaction started: ${transactionId}`));
      return transactionId;
    } catch (error) {
      connection.release();
      console.error(chalk.red('Error starting transaction:', error));
      throw error;
    }
  }

  // Commit a transaction
  public async commitTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      console.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.commit();
      console.log(chalk.green(`Transaction committed: ${transactionId}`));
    } catch (error) {
      console.error(chalk.red('Error committing transaction:', error));
      throw error;
    } finally {
      connection.release();
      this.transactionConnections.delete(transactionId); // Cleanup
    }
  }

  // Rollback a transaction
  public async rollbackTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      console.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.rollback();
      console.warn(chalk.yellow(`Transaction rolled back: ${transactionId}`));
    } catch (error) {
      console.error(chalk.red('Error rolling back transaction:', error));
      throw error;
    } finally {
      connection.release();
      this.transactionConnections.delete(transactionId); // Cleanup
    }
  }

  // Close connection method (no-op for compatibility)
  public async closeConnection(): Promise<void> {
    // console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
  }

  // Acquire a connection for the current operation
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    try {
      const connection = await getConn(); // Reuse getConn from processormacros
      await connection.ping(); // Validate connection
      // console.log(chalk.green('Connection validated.'));
      return connection;
    } catch (error) {
      console.error(chalk.red('Error acquiring or validating connection:', error));
      throw error;
    }
  }
}

export default ConnectionManager;
