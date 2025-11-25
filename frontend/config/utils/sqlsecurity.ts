/**
 * SQL Security Utilities
 *
 * Provides shared validation and sanitization functions to prevent SQL injection attacks.
 * All schema names MUST be validated against the whitelist before use in SQL queries.
 * IMPORTANT: This module must NOT import mysql2 to remain compatible with client-side code.
 */

// Whitelist of allowed schemas - MUST match production database schemas
export const ALLOWED_SCHEMAS = [
  'forestgeo',
  'forestgeo_testing',
  'forestgeo_testing_alternate',
  'forestgeo_panama',
  'forestgeo_harvard',
  'forestgeo_mpala',
  'forestgeo_serc',
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
 * Manually escapes a MySQL identifier (schema, table, column name)
 * Wraps identifier in backticks and escapes any backticks within
 * @param identifier - The identifier to escape
 * @returns Escaped identifier wrapped in backticks
 */
function escapeIdentifier(identifier: string): string {
  return '`' + identifier.replace(/`/g, '``') + '`';
}

/**
 * Safely formats SQL query with schema identifier(s)
 * Replaces ?? placeholders with escaped schema identifiers
 * Handles multiple ?? placeholders by replacing each with the schema
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
  const escapedSchema = escapeIdentifier(schema);
  // Replace all ?? with escaped schema identifier
  return query.replace(/\?\?/g, escapedSchema);
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

/**
 * Safely escapes an identifier (table name, column name, etc.)
 * Validates that identifier contains only alphanumeric characters, underscores, and dots
 * Then wraps in backticks with proper escaping
 *
 * @param identifier - The identifier to escape (table/column name)
 * @returns Escaped identifier wrapped in backticks
 * @throws Error if identifier contains invalid characters
 *
 * @example
 * safeEscapeId('user_name') // Returns: `user_name`
 * safeEscapeId('table.column') // Returns: `table`.`column`
 * safeEscapeId('user-name') // Throws error (invalid character)
 */
export function safeEscapeId(identifier: string): string {
  // Validate identifier contains only safe characters
  // Allow alphanumeric, underscore, and dot (for qualified names like table.column)
  if (!/^[a-zA-Z0-9_.]+$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}. Only alphanumeric characters, underscores, and dots are allowed.`);
  }

  // Handle qualified identifiers (e.g., "table.column")
  if (identifier.includes('.')) {
    return identifier
      .split('.')
      .map(part => escapeIdentifier(part))
      .join('.');
  }

  // Single identifier
  return escapeIdentifier(identifier);
}
