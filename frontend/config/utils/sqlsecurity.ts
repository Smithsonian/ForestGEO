/**
 * SQL Security Utilities
 *
 * Provides shared validation and sanitization functions to prevent SQL injection attacks.
 * All schema names MUST be validated against the whitelist before use in SQL queries.
 */

import { format } from 'mysql2/promise';

// Whitelist of allowed schemas - MUST match production database schemas
export const ALLOWED_SCHEMAS = [
  'forestgeo',
  'forestgeo_testing',
  'forestgeo_testing_alternate',
  'catalog'
] as const;

export type AllowedSchema = (typeof ALLOWED_SCHEMAS)[number];

/**
 * Validates if a schema name is in the allowed list
 * @param schema - Schema name to validate
 * @returns true if schema is allowed, false otherwise
 */
export function isValidSchema(schema: string | null | undefined): schema is AllowedSchema {
  if (!schema) return false;
  return ALLOWED_SCHEMAS.includes(schema as AllowedSchema);
}

/**
 * Validates schema name and throws error if invalid
 * Use this in API routes to fail fast on invalid schema
 * @param schema - Schema name to validate
 * @throws Error if schema is not in whitelist
 */
export function validateSchemaOrThrow(schema: string | null | undefined): asserts schema is AllowedSchema {
  if (!isValidSchema(schema)) {
    throw new Error(`Invalid or unauthorized schema: ${schema}`);
  }
}

/**
 * Safely formats SQL query with schema identifier(s)
 * Uses mysql2 format() to escape identifiers and prevent SQL injection
 * Handles multiple ?? placeholders by passing schema multiple times
 *
 * @example
 * const sql = formatWithSchema(schema, 'SELECT * FROM ??.users WHERE id = ?');
 * // Returns: "SELECT * FROM `forestgeo`.users WHERE id = ?"
 *
 * @example
 * const sql = formatWithSchema(schema, 'SELECT * FROM ??.users u JOIN ??.roles r ON u.roleId = r.id');
 * // Returns: "SELECT * FROM `forestgeo`.users u JOIN `forestgeo`.roles r ON u.roleId = r.id"
 *
 * @param schema - Validated schema name
 * @param query - SQL query with ?? placeholder(s) for schema
 * @returns Formatted SQL string with escaped schema identifier(s)
 */
export function formatWithSchema(schema: AllowedSchema, query: string): string {
  // Count how many ?? placeholders exist in the query
  const placeholderCount = (query.match(/\?\?/g) || []).length;
  // Pass schema once for each ?? placeholder
  const params = Array(placeholderCount).fill(schema);
  return format(query, params);
}

/**
 * Validates and formats SQL query with schema in one step
 * Convenience function that combines validation and formatting
 *
 * @param schema - Schema name to validate and use
 * @param query - SQL query with ?? placeholder for schema
 * @returns Formatted SQL string
 * @throws Error if schema is invalid
 */
export function safeFormatQuery(schema: string | null | undefined, query: string): string {
  validateSchemaOrThrow(schema);
  return formatWithSchema(schema, query);
}
