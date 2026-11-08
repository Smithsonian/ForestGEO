import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/connectionmanager', () => {
  throw new Error('ConnectionManager must not load when the errors explorer modules are imported');
});

const PRODUCTION_DIRECTORIES = ['app', 'components', 'config', 'lib'];
const TEST_DIRECTORY_NAME = '__tests__';
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const ORACLE_IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"][^'"]*tests\/oracles\/[^'"]*['"]/;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return entry === TEST_DIRECTORY_NAME ? [] : productionSourceFiles(fullPath);
    return SOURCE_FILE.test(entry) && !TEST_FILE.test(entry) ? [fullPath] : [];
  });
}

describe('errors explorer module boundaries (#544)', () => {
  it('imports the explorer modules without ConnectionManager or the pool', async () => {
    await expect(import('./_shared')).resolves.toBeDefined();
    await expect(import('./errorsetsql')).resolves.toBeDefined();
    await expect(import('./errorsetcounts')).resolves.toBeDefined();
  });

  it('keeps the frozen oracle out of production code', () => {
    const frontendRoot = path.resolve(__dirname, '../../../..');
    const files = PRODUCTION_DIRECTORIES.flatMap(directory => productionSourceFiles(path.join(frontendRoot, directory)));
    const offenders = files.filter(file => ORACLE_IMPORT_SPECIFIER.test(readFileSync(file, 'utf8')));
    console.log(`[#544 imports] scanned ${files.length} production files; importing the oracle: ${JSON.stringify(offenders)}`);
    expect(files.length, 'the scan must read production files').toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
