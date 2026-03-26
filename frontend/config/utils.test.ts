import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  openSidebar,
  closeSidebar,
  toggleSidebar,
  createInsertOrUpdateQuery,
  buildBulkUpsertQuery,
  handleUpsert,
  createError,
  capitalizeFirstLetter,
  transformSpecialCases,
  capitalizeAndTransformField,
  getUpdatedValues
} from './utils';
import type ConnectionManager from '@/config/connectionmanager';

describe('Sidebar Utilities', () => {
  beforeEach(() => {
    // Reset document state before each test
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.documentElement.style.removeProperty('--SideNavigation-slideIn');
    }
  });

  describe('openSidebar', () => {
    it('should set overflow hidden and slideIn property', () => {
      openSidebar();
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
    });

    it('should handle case when document is undefined', () => {
      const originalDocument = global.document;
      // @ts-ignore
      global.document = undefined;
      expect(() => openSidebar()).not.toThrow();
      global.document = originalDocument;
    });
  });

  describe('closeSidebar', () => {
    it('should remove overflow and slideIn properties', () => {
      // First open to set properties
      openSidebar();
      // Then close
      closeSidebar();
      expect(document.body.style.overflow).toBe('');
      expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');
    });

    it('should handle case when document is undefined', () => {
      const originalDocument = global.document;
      // @ts-ignore
      global.document = undefined;
      expect(() => closeSidebar()).not.toThrow();
      global.document = originalDocument;
    });
  });

  describe('toggleSidebar', () => {
    it('should open sidebar when closed', () => {
      closeSidebar();
      toggleSidebar();
      expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
    });

    it('should close sidebar when open', () => {
      openSidebar();
      toggleSidebar();
      expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');
    });

    it('should handle case when window or document is undefined', () => {
      const originalWindow = global.window;
      // @ts-ignore
      global.window = undefined;
      expect(() => toggleSidebar()).not.toThrow();
      global.window = originalWindow;
    });
  });
});

describe('Database Query Utilities', () => {
  describe('createInsertOrUpdateQuery', () => {
    it('should create proper INSERT ... ON DUPLICATE KEY UPDATE query', () => {
      const data = {
        name: 'Test',
        age: 25,
        email: 'test@example.com'
      };
      const query = createInsertOrUpdateQuery('testSchema', 'users', data);

      expect(query).toContain('INSERT INTO `testSchema`.`users`');
      expect(query).toContain('`name`, `age`, `email`');
      expect(query).toContain('VALUES (?, ?, ?)');
      expect(query).toContain('ON DUPLICATE KEY UPDATE');
      expect(query).toContain('`name` = VALUES(`name`)');
      expect(query).toContain('`age` = VALUES(`age`)');
      expect(query).toContain('`email` = VALUES(`email`)');
    });

    it('should handle empty data object', () => {
      const data = {};
      const query = createInsertOrUpdateQuery('testSchema', 'users', data);

      expect(query).toContain('INSERT INTO `testSchema`.`users` ()');
      expect(query).toContain('VALUES ()');
    });

    it('should properly escape column names with backticks', () => {
      const data = { 'user-name': 'test' };
      const query = createInsertOrUpdateQuery('testSchema', 'users', data);

      expect(query).toContain('`user-name`');
    });
  });

  describe('buildBulkUpsertQuery', () => {
    it('should create bulk upsert query for multiple rows', () => {
      const rows = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
        { id: 3, name: 'Charlie', age: 35 }
      ];

      const { sql, params } = buildBulkUpsertQuery('testSchema', 'users', rows, 'id');

      expect(sql).toContain('INSERT INTO `testSchema`.`users`');
      expect(sql).toContain('(`id`,`name`,`age`)');
      expect(sql).toContain('VALUES (?,?,?),(?,?,?),(?,?,?)');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(sql).toContain('`name` = VALUES(`name`)');
      expect(sql).toContain('`age` = VALUES(`age`)');
      expect(sql).not.toContain('`id` = VALUES(`id`)'); // Primary key should be excluded

      expect(params).toHaveLength(9); // 3 rows * 3 columns
      expect(params).toEqual([1, 'Alice', 30, 2, 'Bob', 25, 3, 'Charlie', 35]);
    });

    it('should throw error when no rows provided', () => {
      expect(() => buildBulkUpsertQuery('testSchema', 'users', [], 'id')).toThrow('No rows provided for bulk upsert');
    });

    it('should handle single row', () => {
      const rows = [{ id: 1, name: 'Alice' }];
      const { sql, params } = buildBulkUpsertQuery('testSchema', 'users', rows, 'id');

      expect(sql).toContain('VALUES (?,?)');
      expect(params).toEqual([1, 'Alice']);
    });

    it('should handle rows with null values', () => {
      const rows: Array<{ id: number; name: string; email: string | null }> = [
        { id: 1, name: 'Alice', email: null },
        { id: 2, name: 'Bob', email: 'bob@example.com' }
      ];
      const { sql, params } = buildBulkUpsertQuery('testSchema', 'users', rows, 'id');

      expect(params).toContain(null);
      expect(params).toContain('bob@example.com');
    });
  });

  describe('handleUpsert', () => {
    let mockConnectionManager: ConnectionManager;

    beforeEach(() => {
      mockConnectionManager = {
        executeQuery: vi.fn()
      } as unknown as ConnectionManager;
    });

    it('should throw error when no data provided', async () => {
      await expect(handleUpsert(mockConnectionManager, 'testSchema', 'users', {}, 'id')).rejects.toThrow(
        'No data provided for upsert operation on table users'
      );
    });

    it('should return new id for insert operation', async () => {
      const data: { id?: number; name: string; age: number } = { name: 'Test', age: 25 };
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 123 });

      const result = await handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id');

      expect(result).toEqual({ id: 123, operation: 'inserted' });
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(1);
    });

    it('should pass transactionID through executeQuery calls when provided', async () => {
      const data: { id?: number; name: string; age: number } = { name: 'Test', age: 25 };
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 123 });

      await handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id', 'tx-123');

      expect(mockConnectionManager.executeQuery).toHaveBeenCalledWith(expect.any(String), ['Test', 25], 'tx-123');
    });

    it('should handle update operation when insertId is 0', async () => {
      const data: { id?: number; name: string; age: number } = { name: 'Test', age: 25 };
      (mockConnectionManager.executeQuery as any)
        .mockResolvedValueOnce({ insertId: 0 }) // First call returns 0 (update case)
        .mockResolvedValueOnce([{ id: 456, name: 'Test', age: 25 }]); // Second call finds existing record

      const result = await handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id');

      expect(result).toEqual({ id: 456, operation: 'updated' });
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should throw error when record not found after update', async () => {
      const data: { id?: number; name: string; age: number } = { name: 'Test', age: 25 };
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 0 }).mockResolvedValueOnce([]); // No record found

      await expect(handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id')).rejects.toThrow(
        'Upsert failed: Record in users could not be found after update'
      );
    });

    it('should filter out falsy values before upserting', async () => {
      const data: { id?: number; name: string; age: number; email: string; active: null } = { name: 'Test', age: 0, email: '', active: null };
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 123 });

      await handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id');

      // Only 'name' should be included (truthy value)
      const callArgs = (mockConnectionManager.executeQuery as any).mock.calls[0];
      expect(callArgs[1]).toEqual(['Test']); // Only name value should be included
    });

    it('should handle numeric strings in WHERE clause', async () => {
      const data: { id?: number; price: string; quantity: string } = { price: '19.99', quantity: '10' };
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 0 }).mockResolvedValueOnce([{ id: 789, price: 19.99, quantity: 10 }]);

      const result = await handleUpsert(mockConnectionManager, 'testSchema', 'products', data, 'id');

      expect(result.id).toBe(789);
      // Verify that numeric strings were converted
      const searchCallArgs = (mockConnectionManager.executeQuery as any).mock.calls[1];
      expect(searchCallArgs[1]).toContain(19.99);
      expect(searchCallArgs[1]).toContain('10'); // Non-decimal numeric strings stay as strings
    });

    it('should throw error when query exceeds max_allowed_packet size', async () => {
      // Create a very large data object
      const largeData: { id?: number; name: string; data: string } = { name: 'Test', data: 'x'.repeat(5000000) }; // > 4MB
      (mockConnectionManager.executeQuery as any).mockResolvedValueOnce({ insertId: 0 });

      await expect(handleUpsert(mockConnectionManager, 'testSchema', 'users', largeData, 'id')).rejects.toThrow('Query exceeds MySQL max_allowed_packet size');
    });

    it('should wrap database errors with createError', async () => {
      const data: { id?: number; name: string } = { name: 'Test' };
      const dbError = new Error('Database connection failed');
      (mockConnectionManager.executeQuery as any).mockRejectedValueOnce(dbError);

      await expect(handleUpsert(mockConnectionManager, 'testSchema', 'users', data, 'id')).rejects.toThrow('Database connection failed');
    });
  });
});

describe('Error Utilities', () => {
  describe('createError', () => {
    it('should create error with ProcessingError name', () => {
      const error = createError('Test error message', { context: 'test' });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('ProcessingError');
    });

    it('should log error to console', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const context = { user: 'testUser', action: 'testAction' };

      createError('Test error', context);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Test error', context);
      consoleErrorSpy.mockRestore();
    });
  });
});

describe('String Transformation Utilities', () => {
  describe('capitalizeFirstLetter', () => {
    it('should capitalize first letter of string', () => {
      expect(capitalizeFirstLetter('hello')).toBe('Hello');
      expect(capitalizeFirstLetter('world')).toBe('World');
    });

    it('should handle already capitalized strings', () => {
      expect(capitalizeFirstLetter('Hello')).toBe('Hello');
    });

    it('should handle single character strings', () => {
      expect(capitalizeFirstLetter('a')).toBe('A');
    });

    it('should handle empty strings', () => {
      expect(capitalizeFirstLetter('')).toBe('');
    });

    it('should preserve rest of string casing', () => {
      expect(capitalizeFirstLetter('hELLO')).toBe('HELLO');
    });
  });

  describe('transformSpecialCases', () => {
    it('should transform dbh to DBH', () => {
      expect(transformSpecialCases('dbh')).toBe('DBH');
      expect(transformSpecialCases('Dbh')).toBe('DBH');
      expect(transformSpecialCases('DBH')).toBe('DBH');
      expect(transformSpecialCases('treeDbh')).toBe('treeDBH');
    });

    it('should transform hom to HOM', () => {
      expect(transformSpecialCases('hom')).toBe('HOM');
      expect(transformSpecialCases('Hom')).toBe('HOM');
      expect(transformSpecialCases('HOM')).toBe('HOM');
      expect(transformSpecialCases('treeHom')).toBe('treeHOM');
    });

    it('should transform cma to CMA', () => {
      expect(transformSpecialCases('cma')).toBe('CMA');
      expect(transformSpecialCases('Cma')).toBe('CMA');
      expect(transformSpecialCases('CMA')).toBe('CMA');
      expect(transformSpecialCases('areaCma')).toBe('areaCMA');
    });

    it('should transform cq to CQ', () => {
      expect(transformSpecialCases('cq')).toBe('CQ');
      expect(transformSpecialCases('Cq')).toBe('CQ');
      expect(transformSpecialCases('quadratCq')).toBe('quadratCQ');
    });

    it('should transform id to ID', () => {
      expect(transformSpecialCases('id')).toBe('ID');
      expect(transformSpecialCases('Id')).toBe('ID');
      expect(transformSpecialCases('userId')).toBe('userID');
    });

    it('should transform validcode to ValidCode', () => {
      expect(transformSpecialCases('validcode')).toBe('ValidCode');
      expect(transformSpecialCases('ValidCode')).toBe('ValidCode');
      expect(transformSpecialCases('VALIDCODE')).toBe('ValidCode');
    });

    it('should prioritize validcode over id transformation', () => {
      expect(transformSpecialCases('validcode')).toBe('ValidCode');
    });

    it('should not transform unrelated strings', () => {
      expect(transformSpecialCases('name')).toBe('name');
      expect(transformSpecialCases('value')).toBe('value');
    });
  });

  describe('capitalizeAndTransformField', () => {
    it('should capitalize and transform field names', () => {
      expect(capitalizeAndTransformField('dbh')).toBe('DBH');
      expect(capitalizeAndTransformField('userId')).toBe('UserID');
      expect(capitalizeAndTransformField('treeHom')).toBe('TreeHOM');
    });

    it('should handle complex field names', () => {
      expect(capitalizeAndTransformField('measurementDbh')).toBe('MeasurementDBH');
      expect(capitalizeAndTransformField('validcode')).toBe('ValidCode');
    });

    it('should handle already capitalized fields', () => {
      expect(capitalizeAndTransformField('TreeId')).toBe('TreeID');
    });
  });

  describe('getUpdatedValues', () => {
    it('should return only changed values', () => {
      const original = { name: 'John', age: 30, email: 'john@example.com' };
      const updated = { name: 'John', age: 31, email: 'john@example.com' };

      const changes = getUpdatedValues(original, updated);

      expect(changes).toEqual({ age: 31 });
    });

    it('should return empty object when no changes', () => {
      const original = { name: 'John', age: 30 };
      const updated = { name: 'John', age: 30 };

      const changes = getUpdatedValues(original, updated);

      expect(changes).toEqual({});
    });

    it('should detect all changed values', () => {
      const original = { name: 'John', age: 30, email: 'john@example.com' };
      const updated = { name: 'Jane', age: 25, email: 'jane@example.com' };

      const changes = getUpdatedValues(original, updated);

      expect(changes).toEqual({
        name: 'Jane',
        age: 25,
        email: 'jane@example.com'
      });
    });

    it('should handle null and undefined values', () => {
      const original = { name: 'John', age: 30, email: null };
      const updated = { name: 'John', age: undefined, email: 'john@example.com' } as any;

      const changes = getUpdatedValues(original, updated);

      expect(changes).toEqual({
        age: undefined,
        email: 'john@example.com'
      });
    });

    it('should handle boolean changes', () => {
      const original = { active: true, verified: false };
      const updated = { active: false, verified: true };

      const changes = getUpdatedValues(original, updated);

      expect(changes).toEqual({
        active: false,
        verified: true
      });
    });

    it('should handle nested object changes by reference', () => {
      const obj1 = { nested: 'value' };
      const obj2 = { nested: 'value' };
      const original = { data: obj1 };
      const updated = { data: obj2 };

      const changes = getUpdatedValues(original, updated);

      // Even though contents are the same, references are different
      expect(changes).toEqual({ data: obj2 });
    });
  });
});
