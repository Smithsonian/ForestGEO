// test/bg-mocks.ts
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * If you already have a separate connectionmanager mock (e.g., '@/lib/connectionmanager'),
 * prefer consolidating on ONE path. These files import from '@/config/connectionmanager',
 * so we mock that here.
 */

// ---------------------------
// Minimal logger + chalk
// ---------------------------
vi.mock('chalk', () => ({
  default: { red: String, yellow: String, cyan: String },
  red: String,
  yellow: String,
  cyan: String
}));

vi.mock('@/ailogger', () => {
  const noop = vi.fn();
  return { default: { info: noop, warn: noop, error: noop, debug: noop } };
});

// ---------------------------
// CSS import used by macros.ts
// ---------------------------
// Prevent runtime errors when importing CSS in Node test env
vi.mock('@/styles/customtablesettings.css', () => ({}));

// ---------------------------
// react-dropzone types import
// ---------------------------
// macros.ts imports FileRejection, FileWithPath at runtime; provide dummies.
vi.mock('react-dropzone', () => {
  class FileRejection {
    file: any;
    errors: any[] = [];
    constructor(file?: any) {
      this.file = file;
    }
  }
  type FileWithPath = File & { path?: string };
  // we don’t use useDropzone in these background modules, but expose a noop to be safe
  const useDropzone = vi.fn(() => ({ getRootProps: vi.fn(), getInputProps: vi.fn(), isDragActive: false }));
  return { FileRejection, useDropzone, /* type placeholder */ FileWithPath: class {} as any };
});

// --------------------------------------
// Processor fns used by fileMappings
// --------------------------------------
vi.mock('@/components/processors/processpersonnel', () => ({
  processPersonnel: vi.fn(async () => {})
}));
vi.mock('@/components/processors/processspecies', () => ({
  processSpecies: vi.fn(async () => {})
}));
// processcensus.tsx removed - individual measurements processing no longer supported

// --------------------------------------
// Mock ConnectionManager (class default)
// --------------------------------------
type Call = { sql: string; params?: any[]; kind: 'execute' };

const executeQueue: Array<() => Promise<any>> = [];
const calls: Call[] = [];

function __pushExecuteResult(result: any) {
  executeQueue.push(async () => result);
}
function __pushExecuteError(error: unknown) {
  executeQueue.push(async () => {
    throw error;
  });
}
function __getCalls() {
  return [...calls];
}
function __clearAll() {
  executeQueue.length = 0;
  calls.length = 0;
}

class MockConnectionManager {
  executeQuery = vi.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params, kind: 'execute' });
    if (executeQueue.length) return executeQueue.shift()!();
    // Default shape similar to mysql2 execute return for INSERT (has insertId)
    return { insertId: 0, affectedRows: 0, rows: [] };
  });
}

vi.mock('@/config/connectionmanager', () => {
  return {
    default: MockConnectionManager,
    __cm: {
      pushResult: __pushExecuteResult,
      pushError: __pushExecuteError,
      getCalls: __getCalls,
      clear: __clearAll
    }
  };
});

// --------------------------------------
// Environment safety for anything reading it
// --------------------------------------
process.env.AZURE_SQL_USER ??= 'user';
process.env.AZURE_SQL_PASSWORD ??= 'pass';
process.env.AZURE_SQL_SERVER ??= 'localhost';
process.env.AZURE_SQL_PORT ??= '3306';
process.env.AZURE_SQL_CATALOG_SCHEMA ??= 'testdb';

// --------------------------------------
// Per-test hygiene
// --------------------------------------
beforeEach(() => {
  __clearAll();
  vi.clearAllMocks();
});

afterEach(() => {
  // Nothing to release — class mock is stateless between tests aside from queues
});

// --------------------------------------
// Named test helpers export (optional)
// --------------------------------------
export const __BgMocks = {
  pushResult: __pushExecuteResult,
  pushError: __pushExecuteError,
  getCalls: __getCalls,
  clear: __clearAll
};
