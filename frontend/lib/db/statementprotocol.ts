/**
 * Statements MySQL cannot prepare, or that mysql2's execute() cannot carry, go over the text protocol (query()):
 * CALL, savepoint commands, USE, START TRANSACTION, and any statement bound with a bulk VALUES array.
 * Everything else is prepared through execute(). runQuery and the test dispatch helper share this rule.
 */
export const TEXT_PROTOCOL_STATEMENT = /^\s*(?:CALL\b|SAVEPOINT\b|RELEASE\s+SAVEPOINT\b|ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?|USE\b|START\s+TRANSACTION\b)/i;

export function hasBulkValuesParam(params: readonly unknown[] | undefined): boolean {
  return params?.some(param => Array.isArray(param) && param.length > 0 && Array.isArray(param[0])) ?? false;
}

export function usesTextProtocol(query: string, params?: readonly unknown[]): boolean {
  return TEXT_PROTOCOL_STATEMENT.test(query) || hasBulkValuesParam(params);
}

export function normalizeStatementParams(params: readonly unknown[] | undefined): unknown[] | undefined {
  return params?.map(param => (param === undefined ? null : param));
}
