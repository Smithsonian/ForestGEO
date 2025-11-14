/**
 * Database Middleware Wrapper
 *
 * Consolidates database connection handling logic from 32+ API routes.
 * Provides consistent error handling, connection management, and response formatting.
 *
 * Before: Each route had ~10 lines of duplicate connection/error handling
 * After: Single function call with type-safe handler
 *
 * Estimated savings: ~200 lines of duplicated code
 */

import { NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export interface DbHandlerOptions {
  /**
   * If true, doesn't close connection after handler completes
   * Useful for streaming responses or multiple queries
   */
  keepConnectionOpen?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: any) => NextResponse;

  /**
   * Custom success handler
   */
  onSuccess?: <T>(data: T) => NextResponse;
}

/**
 * Wraps a database operation with consistent connection management and error handling
 *
 * @example
 * ```typescript
 * export async function GET(request: Request) {
 *   return withDatabase(async (connectionManager) => {
 *     const results = await connectionManager.executeQuery('SELECT * FROM users');
 *     return results;
 *   });
 * }
 * ```
 */
export async function withDatabase<T = any>(
  handler: (connectionManager: ConnectionManager) => Promise<T>,
  options: DbHandlerOptions = {}
): Promise<NextResponse> {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const result = await handler(connectionManager);

    // Custom success handler
    if (options.onSuccess) {
      return options.onSuccess(result);
    }

    // Default success response
    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (error: any) {
    // Log error
    ailogger.error('Database operation error:', error);

    // Custom error handler
    if (options.onError) {
      return options.onError(error);
    }

    // Default error response
    return NextResponse.json(
      {
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    // Close connection unless explicitly kept open
    if (!options.keepConnectionOpen) {
      await connectionManager.closeConnection();
    }
  }
}

/**
 * Executes a single query with automatic connection management
 *
 * @example
 * ```typescript
 * export async function GET(request: Request) {
 *   return withQuery(
 *     'SELECT * FROM users WHERE id = ?',
 *     [userId]
 *   );
 * }
 * ```
 */
export async function withQuery<T = any>(query: string, params?: any[]): Promise<NextResponse> {
  return withDatabase(async connectionManager => {
    const results = await connectionManager.executeQuery(query, params);
    return results as T;
  });
}

/**
 * Executes multiple queries in a transaction
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const data = await request.json();
 *
 *   return withTransaction(async (connectionManager, transactionId) => {
 *     await connectionManager.executeQuery('INSERT INTO users ...', [data.name]);
 *     await connectionManager.executeQuery('INSERT INTO audit_log ...', [data.name]);
 *     return { success: true };
 *   });
 * }
 * ```
 */
export async function withTransaction<T = any>(
  handler: (connectionManager: ConnectionManager, transactionId: string) => Promise<T>,
  options: DbHandlerOptions = {}
): Promise<NextResponse> {
  return withDatabase(async connectionManager => {
    let transactionId: string | undefined;

    try {
      transactionId = await connectionManager.beginTransaction();
      const result = await handler(connectionManager, transactionId);
      await connectionManager.commitTransaction(transactionId);
      return result;
    } catch (error) {
      if (transactionId) {
        await connectionManager.rollbackTransaction(transactionId);
      }
      throw error;
    }
  }, options);
}

/**
 * Common error response builders
 */
export const ErrorResponses = {
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: HTTPResponses.BAD_REQUEST }),

  invalidRequest: (message: string) => NextResponse.json({ error: message }, { status: HTTPResponses.INVALID_REQUEST }),

  notFound: (message = 'Not found') => NextResponse.json({ error: message }, { status: HTTPResponses.NOT_FOUND }),

  conflict: (message: string) => NextResponse.json({ error: message }, { status: HTTPResponses.CONFLICT }),

  methodNotAllowed: (message = 'Method not allowed') => NextResponse.json({ error: message }, { status: HTTPResponses.METHOD_NOT_ALLOWED }),

  serverError: (message: string, details?: any) =>
    NextResponse.json(
      {
        error: message,
        details: process.env.NODE_ENV === 'development' ? details : undefined
      },
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    ),

  serviceUnavailable: (message = 'Service temporarily unavailable') => NextResponse.json({ error: message }, { status: HTTPResponses.SERVICE_UNAVAILABLE })
};
