/**
 * @fileoverview Unit tests for application macros and constants.
 *
 * This test suite validates the HTTPResponses enum that defines standard
 * and custom HTTP status codes used throughout the ForestGEO application.
 * These constants ensure consistent API responses and error handling
 * across all endpoints.
 *
 * @see /config/macros.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { HTTPResponses } from './macros';

describe('Macros', () => {
  describe('HTTPResponses', () => {
    /**
     * @test Validates that standard HTTP status codes are correctly defined.
     *
     * This test ensures that common HTTP response codes (200, 201, 400, 409, 500, 503)
     * are properly mapped in the HTTPResponses enum. These codes are used across
     * API endpoints to provide consistent response status indication.
     */
    it('should define correct HTTP status codes', () => {
      expect(HTTPResponses.OK).toBe(200);
      expect(HTTPResponses.CREATED).toBe(201);
      expect(HTTPResponses.CONFLICT).toBe(409);
      expect(HTTPResponses.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HTTPResponses.SERVICE_UNAVAILABLE).toBe(503);
      expect(HTTPResponses.INVALID_REQUEST).toBe(400);
    });

    /**
     * @test Verifies custom HTTP status codes specific to the ForestGEO application.
     *
     * This test validates application-specific error codes:
     * - 408: SQL_CONNECTION_FAILURE for database connectivity issues
     * - 412: PRECONDITION_VALIDATION_FAILURE for business rule violations
     * - 555: FOREIGN_KEY_CONFLICT for referential integrity errors
     */
    it('should define custom status codes', () => {
      expect(HTTPResponses.SQL_CONNECTION_FAILURE).toBe(408);
      expect(HTTPResponses.PRECONDITION_VALIDATION_FAILURE).toBe(412);
      expect(HTTPResponses.FOREIGN_KEY_CONFLICT).toBe(555);
    });

    /**
     * @test Ensures the NOT_FOUND status code is properly defined.
     *
     * This test validates that the NOT_FOUND enumeration value exists,
     * which is used throughout the application for indicating missing
     * resources or failed lookups.
     */
    it('should handle NOT_FOUND status', () => {
      expect(HTTPResponses.NOT_FOUND).toBeDefined();
    });
  });
});
