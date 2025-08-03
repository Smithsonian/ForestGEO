// connectionmanager.ts
import '@/lib/connectionlogger';
import { format, PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { v4 as uuidv4 } from 'uuid';
import { patchConnectionManager } from '@/lib/connectionlogger';
import ailogger from '@/ailogger';

// at the top of connectionmanager.ts
class ObservableMap<K, V> extends Map<K, V> {
  override set(key: K, value: V): this {
    super.set(key, value);
    ailogger.info(`[transactionConnections] set ${key} → ${(value as any).threadId}`);
    this.logContents();
    return this;
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    ailogger.info(`[transactionConnections] delete ${key}`);
    this.logContents();
    return deleted;
  }

  private logContents() {
    ailogger.info(
      '[transactionConnections] current:',
      Array.from(this.entries()).map(([id, conn]) => ({ id, threadId: (conn as any).threadId }))
    );
  }
}

class ConnectionManager {
  private static instance: ConnectionManager | null = null; // Singleton instance
  private transactionConnections = new ObservableMap<string, PoolConnection>(); // Store transaction-specific connections

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
      return await runQuery(connection, format(query, params));
    } catch (error: any) {
      ailogger.error(chalk.red('Error executing query:', error));
      throw error;
    } finally {
      if (!transactionId) {
        connection.release(); // Release if not part of a transaction
      }
    }
  }

  // Begin a transaction
  public async beginTransaction(): Promise<string> {
    const startTime = Date.now();
    const transactionId = uuidv4();
    let connection: PoolConnection | null = null;

    try {
      while (Date.now() - startTime < 15000) {
        try {
          connection = await this.acquireConnectionInternal();
          await connection.beginTransaction();
          this.transactionConnections.set(transactionId, connection);
          ailogger.info(chalk.green(`Transaction started: ${transactionId}`));
          return transactionId;
        } catch (error: any) {
          connection?.release();
          if (!this.isDeadlockError(error)) {
            ailogger.error(chalk.red('Error starting transaction:', error));
            throw error;
          }
          ailogger.warn(chalk.yellow(`Error ${error.message} encountered, retrying transaction start...`));
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      throw new Error('Failed to start transaction after 15 seconds due to persistent deadlock issues.');
    } catch (e: any) {
      ailogger.error(chalk.red('Error starting transaction:', e));
      throw e;
    }
  }

  // Commit a transaction
  public async commitTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.commit();
      ailogger.info(chalk.green(`Transaction committed: ${transactionId}`));
    } catch (error: any) {
      ailogger.error(chalk.red('Error committing transaction:', error));
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
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.rollback();
      ailogger.warn(chalk.yellow(`Transaction rolled back: ${transactionId}`));
    } catch (error: any) {
      ailogger.error(chalk.red('Error rolling back transaction:', error));
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

  // Helper method to detect deadlock errors.
  private isDeadlockError(error: any): boolean {
    return error && (error.code === 'ER_LOCK_DEADLOCK' || error.errno === 1213);
  }

  // Acquire a connection for the current operation
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    try {
      const connection = await getConn(); // Reuse getConn from processormacros
      await connection.ping(); // Validate connection
      // console.log(chalk.green('Connection validated.'));
      return connection;
    } catch (error: any) {
      ailogger.error(chalk.red('Error acquiring or validating connection:', error));
      throw error;
    }
  }
}

patchConnectionManager(ConnectionManager.getInstance());

export default ConnectionManager;
