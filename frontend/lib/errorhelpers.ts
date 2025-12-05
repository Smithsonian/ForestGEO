/**
 * Error Helper Utilities
 *
 * Shared utilities for error handling across the codebase.
 * Provides type-safe error handling patterns for API routes and components.
 */

/**
 * MySQL-specific error interface
 * Extends Error with MySQL error properties
 */
export interface MySQLError extends Error {
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
}

/**
 * Generic error with code property
 * Used for database and network errors
 */
export interface CodedError extends Error {
  code?: string;
}

/**
 * Extract error message from unknown error type
 * Safe for use in catch blocks with unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Extract error code from unknown error type
 * Safe for use in catch blocks when checking MySQL/network error codes
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as CodedError).code;
    // Ensure code is actually a string (could be number or other type)
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Check if error has a specific code
 * Useful for MySQL error checking (e.g., ER_BAD_DB_ERROR, ECONNREFUSED)
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

/**
 * Check if error message contains a substring
 * Case-insensitive check
 */
export function errorMessageContains(error: unknown, substring: string): boolean {
  const message = getErrorMessage(error);
  return message.toLowerCase().includes(substring.toLowerCase());
}

/**
 * Convert unknown error to Error object
 * Creates new Error if needed, preserving original message
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(getErrorMessage(error));
}

/**
 * Check if error is a MySQL database error
 */
export function isMySQLError(error: unknown): error is MySQLError {
  return error instanceof Error && ('code' in error || 'errno' in error || 'sqlState' in error);
}
