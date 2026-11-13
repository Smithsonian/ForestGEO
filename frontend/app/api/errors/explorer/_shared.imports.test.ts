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
const ORACLE_DIRECTORY = 'tests/oracles';
const ORACLE_FILE = /^errors-explorer-legacy.*\.ts$/;
const LIVE_EXPLORER_MODULE_PREFIXES = ['@/config/', '@/lib/errorsexplorer/', '@/lib/activemeasurementcount'];
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const STATIC_MODULE_REFERENCE = /\b(import|export)\s+(type\s+)?(?:[^;'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_MODULE_REFERENCE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const ORACLE_IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"][^'"]*tests\/oracles\/[^'"]*['"]/;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return entry === TEST_DIRECTORY_NAME ? [] : productionSourceFiles(fullPath);
    return SOURCE_FILE.test(entry) && !TEST_FILE.test(entry) ? [fullPath] : [];
  });
}

function isLiveExplorerModule(specifier: string): boolean {
  return LIVE_EXPLORER_MODULE_PREFIXES.some(prefix => specifier.startsWith(prefix));
}

function valueImportsOfLiveExplorerModules(source: string): string[] {
  const code = source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  const staticValueSpecifiers = [...code.matchAll(STATIC_MODULE_REFERENCE)].filter(match => !match[2]).map(match => match[3]);
  const dynamicSpecifiers = [...code.matchAll(DYNAMIC_MODULE_REFERENCE)].map(match => match[1]);
  return [...staticValueSpecifiers, ...dynamicSpecifiers].filter(isLiveExplorerModule);
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

  it('freezes the oracle: it takes only types from the live explorer modules', () => {
    const frontendRoot = path.resolve(__dirname, '../../../..');
    const oracleDirectory = path.join(frontendRoot, ORACLE_DIRECTORY);
    const oracleFiles = readdirSync(oracleDirectory).filter(entry => ORACLE_FILE.test(entry));
    const valueImportsByFile = Object.fromEntries(
      oracleFiles.map(file => [file, valueImportsOfLiveExplorerModules(readFileSync(path.join(oracleDirectory, file), 'utf8'))])
    );
    const offenders = Object.fromEntries(Object.entries(valueImportsByFile).filter(([, specifiers]) => specifiers.length > 0));
    console.log(`[#544 imports] scanned oracle files ${JSON.stringify(oracleFiles)}; live value imports: ${JSON.stringify(offenders)}`);
    expect(oracleFiles.length, 'the scan must read oracle files').toBeGreaterThan(0);
    expect(offenders).toEqual({});
  });

  it('detects a value import from a live explorer module but allows type-only imports (mutant)', () => {
    const typeOnlySource = [
      "import type { ErrorExplorerRow } from '@/config/errorsexplorer';",
      "import type { ColumnValueRow } from '@/lib/errorsexplorer/columnquery';",
      "import { safeFormatQuery } from '@/lib/db/sqlsecurity';"
    ].join('\n');
    const mutantSources = [
      `${typeOnlySource}\nimport { dedupeStrings } from '@/config/errorsexplorer';`,
      `${typeOnlySource}\nimport {\n  type ErrorExplorerRow,\n  dedupeNumbers\n} from '@/config/errorsexplorer';`,
      `${typeOnlySource}\nimport { readActiveMeasurementCount } from '@/lib/activemeasurementcount';`,
      `${typeOnlySource}\nexport { compareRowsBySortItem } from '@/lib/errorsexplorer/columnquery';`,
      `${typeOnlySource}\nconst live = await import('@/config/errorsexplorer');`,
      `${typeOnlySource}\nimport '@/lib/errorsexplorer/columnquery';`
    ];
    console.log(`[#544 imports] type-only source reports ${JSON.stringify(valueImportsOfLiveExplorerModules(typeOnlySource))}`);
    expect(valueImportsOfLiveExplorerModules(typeOnlySource)).toEqual([]);
    mutantSources.forEach(mutant => {
      const found = valueImportsOfLiveExplorerModules(mutant);
      console.log(`[#544 imports] mutant reports ${JSON.stringify(found)} for:\n${mutant}`);
      expect(found.length, `a value import must be detected in:\n${mutant}`).toBeGreaterThan(0);
    });
  });
});
