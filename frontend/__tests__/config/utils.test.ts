import { describe, expect, it } from 'vitest';
import {
  capitalizeAndTransformField,
  capitalizeFirstLetter,
  closeSidebar,
  createError,
  createInsertOrUpdateQuery,
  createSelectQuery,
  fetchPrimaryKey,
  openSidebar,
  toggleSidebar,
  transformSpecialCases
} from '@/config/utils';
import { PoolConnection } from 'mysql2/promise';
import { runQuery } from '@/components/processors/processormacros';

describe('Sidebar Utilities', () => {
  it('should set styles to hide body overflow and slide in sidebar when opening', () => {
    // Mock document
    document.body.style.overflow = '';
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '0');

    openSidebar();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
  });

  it('should remove styles when closing the sidebar', () => {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '1');

    closeSidebar();

    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');
  });

  it('should toggle sidebar state based on current state', () => {
    // Setup initial state
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '1');
    toggleSidebar();
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');

    toggleSidebar();
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
  });
});

describe('String Transformation Utilities', () => {
  it('should capitalize the first letter', () => {
    expect(capitalizeFirstLetter('test')).toBe('Test');
    expect(capitalizeFirstLetter('Test')).toBe('Test');
  });

  it('should transform special cases like DBH, HOM, and CMA', () => {
    expect(transformSpecialCases('dbhHeight')).toBe('DBHHeight');
    expect(transformSpecialCases('homLocation')).toBe('HOMLocation');
    expect(transformSpecialCases('cmaError')).toBe('CMAError');
  });

  it('should capitalize and transform special cases', () => {
    expect(capitalizeAndTransformField('dbhHeight')).toBe('DBHHeight');
    expect(capitalizeAndTransformField('homLocation')).toBe('HOMLocation');
  });
});

vi.mock('@/components/processors/processormacros', () => ({
  runQuery: vi.fn()
}));

describe('createSelectQuery', () => {
  it('should create correct select query', () => {
    const query = createSelectQuery('testSchema', 'testTable', { name: 'John', age: 30 });
    expect(query).toBe('SELECT * FROM `testSchema`.`testTable` WHERE `name` = ? AND `age` = ?');
  });

  it('should create correct query for a single where condition', () => {
    const query = createSelectQuery('testSchema', 'testTable', { name: 'John' });
    expect(query).toBe('SELECT * FROM `testSchema`.`testTable` WHERE `name` = ?');
  });

  it('should create correct query for multiple where conditions', () => {
    const query = createSelectQuery('testSchema', 'testTable', { name: 'John', age: 30 });
    expect(query).toBe('SELECT * FROM `testSchema`.`testTable` WHERE `name` = ? AND `age` = ?');
  });

  it('should correctly escape column names with special characters', () => {
    const query = createSelectQuery('testSchema', 'testTable', { 'first-name': 'John', 'last name': 'Doe' });
    expect(query).toBe('SELECT * FROM `testSchema`.`testTable` WHERE `first-name` = ? AND `last name` = ?');
  });
});

describe('createInsertOrUpdateQuery', () => {
  it('should create correct insert or update query', () => {
    const query = createInsertOrUpdateQuery('testSchema', 'testTable', { name: 'John', age: 30 });
    expect(query).toBe(
      'INSERT INTO `testSchema`.`testTable` (`name`, `age`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `age` = VALUES(`age`)'
    );
  });

  it('should create correct query for a single column', () => {
    const query = createInsertOrUpdateQuery('testSchema', 'testTable', { name: 'John' });
    expect(query).toBe('INSERT INTO `testSchema`.`testTable` (`name`) VALUES (?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)');
  });

  it('should create correct query for multiple columns', () => {
    const query = createInsertOrUpdateQuery('testSchema', 'testTable', { name: 'John', age: 30 });
    expect(query).toBe(
      'INSERT INTO `testSchema`.`testTable` (`name`, `age`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `age` = VALUES(`age`)'
    );
  });

  it('should correctly escape column names with special characters', () => {
    const query = createInsertOrUpdateQuery('testSchema', 'testTable', { 'first-name': 'John', 'last name': 'Doe' });
    expect(query).toBe(
      'INSERT INTO `testSchema`.`testTable` (`first-name`, `last name`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `first-name` = VALUES(`first-name`), `last name` = VALUES(`last name`)'
    );
  });
});

describe('fetchPrimaryKey', () => {
  type TestResult = {
    id: number;
    name: string;
    age: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch primary key correctly', async () => {
    // Define a Result type for this test

    const mockConnection = {} as PoolConnection;
    const mockRows = [{ id: 1 }];
    (runQuery as any).mockResolvedValue(mockRows); // Mocking the runQuery to return mock rows

    const result = await fetchPrimaryKey<TestResult>('testSchema', 'testTable', { name: 'John' }, mockConnection, 'id');

    expect(result).toBe(1);
    expect(runQuery).toHaveBeenCalledWith(mockConnection, expect.any(String), ['John']);
  });

  it('should throw an error when no rows are found', async () => {
    const mockConnection = {} as PoolConnection;
    (runQuery as any).mockResolvedValue([]); // Simulate no rows found

    await expect(fetchPrimaryKey<TestResult>('testSchema', 'testTable', { name: 'John' }, mockConnection, 'id')).rejects.toThrowError(
      'John not found in' + ' testTable.'
    );
  });

  it('should handle multiple rows and return the primary key of the first row', async () => {
    const mockConnection = {} as PoolConnection;
    const mockRows = [{ id: 1 }, { id: 2 }];
    (runQuery as any).mockResolvedValue(mockRows); // Simulate multiple rows found

    const result = await fetchPrimaryKey<TestResult>('testSchema', 'testTable', { name: 'John' }, mockConnection, 'id');
    expect(result).toBe(1); // Should return the primary key of the first row
  });

  it('should fetch a custom primary key correctly', async () => {
    type TestResult = {
      uuid: string;
      name: string;
    };

    const mockConnection = {} as PoolConnection;
    const mockRows = [{ uuid: '123e4567-e89b-12d3-a456-426614174000' }];
    (runQuery as any).mockResolvedValue(mockRows);

    const result = await fetchPrimaryKey<TestResult>('testSchema', 'testTable', { name: 'John' }, mockConnection, 'uuid');
    expect(result).toBe('123e4567-e89b-12d3-a456-426614174000');
  });
});

describe('Error Handling Utilities', () => {
  it('should create a custom error with context', () => {
    const error = createError('Test Error', { field: 'testField' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test Error');
    expect(error.name).toBe('ProcessingError');
  });

  it('should handle an empty error message', () => {
    const error = createError('', { field: 'testField' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(''); // Message should be empty
    expect(error.name).toBe('ProcessingError');
  });

  it('should handle no context being provided', () => {
    const error = createError('Test Error', null);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test Error');
    expect(error.name).toBe('ProcessingError');
  });

  it('should handle undefined context', () => {
    const error = createError('Test Error', undefined);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test Error');
    expect(error.name).toBe('ProcessingError');
  });

  it('should handle complex context objects', () => {
    const complexContext = {
      field: 'testField',
      details: {
        expected: 'value',
        actual: 'differentValue'
      },
      errors: ['error1', 'error2'],
      retry: () => {
        return true;
      }
    };

    const error = createError('Test Error with complex context', complexContext);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test Error with complex context');
    expect(error.name).toBe('ProcessingError');
  });

  it('should handle numeric error messages', () => {
    const error = createError(123 as unknown as string, { field: 'testField' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('123'); // Message should be converted to string
    expect(error.name).toBe('ProcessingError');
  });
});
