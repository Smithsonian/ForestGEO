import { describe, expect, it } from 'vitest';
import { ErrorResponses, withDatabase, withQuery, withTransaction } from './db-middleware';

describe('db-middleware exports', () => {
  it('exposes the database helpers used by API routes', () => {
    expect(withDatabase).toBeTypeOf('function');
    expect(withQuery).toBeTypeOf('function');
    expect(withTransaction).toBeTypeOf('function');
  });

  it('exposes the standard error-response helpers', () => {
    expect(ErrorResponses.badRequest).toBeTypeOf('function');
    expect(ErrorResponses.invalidRequest).toBeTypeOf('function');
    expect(ErrorResponses.notFound).toBeTypeOf('function');
    expect(ErrorResponses.conflict).toBeTypeOf('function');
    expect(ErrorResponses.methodNotAllowed).toBeTypeOf('function');
    expect(ErrorResponses.serverError).toBeTypeOf('function');
    expect(ErrorResponses.serviceUnavailable).toBeTypeOf('function');
  });
});
