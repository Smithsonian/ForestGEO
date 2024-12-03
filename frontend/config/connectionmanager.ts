import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';

class ConnectionManager {
  private connection: PoolConnection | null = null;
  private transactionActive: boolean = false;
  private rollbackCalled: boolean = false;

  async acquireConnection(): Promise<void> {
    if (!this.connection) {
      console.log(chalk.cyan('Acquiring new connection...'));
      this.connection = await getConn();
    }
  }

  async beginTransaction(): Promise<void> {
    await this.acquireConnection();
    if (!this.transactionActive) {
      await this.connection!.beginTransaction();
      this.transactionActive = true;
      this.rollbackCalled = false;
      console.log(chalk.green('Transaction started.'));
    }
  }

  async executeQuery(query: string, params?: any[]): Promise<any> {
    await this.acquireConnection();
    try {
      const isModifyingQuery = query.trim().match(/^(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)/i);

      if (isModifyingQuery && !this.transactionActive) {
        console.warn(chalk.yellow('No transaction active for modifying query. Starting a new transaction.'));
        await this.beginTransaction();
      }

      return await runQuery(this.connection!, query, params);
    } catch (error) {
      console.error(chalk.red('Error executing query:', error));
      throw error;
    }
  }

  async commitTransaction(): Promise<void> {
    if (this.transactionActive && this.connection) {
      await this.connection.commit();
      console.log(chalk.green('Transaction committed.'));
      this.transactionActive = false;
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (this.transactionActive && this.connection) {
      await this.connection.rollback();
      console.log(chalk.red('Transaction rolled back.'));
      this.transactionActive = false;
      this.rollbackCalled = true; // Set rollback flag
    }
  }

  async closeConnection(): Promise<void> {
    if (this.connection) {
      if (this.transactionActive && !this.rollbackCalled) {
        console.log(chalk.green('Auto-committing active transaction before closing connection.'));
        await this.commitTransaction(); // Commit any active transaction if no rollback was called
      }
      console.log(chalk.blue('Releasing connection...'));
      this.connection.release();
      this.connection = null;
    }
  }
}

export default ConnectionManager;
