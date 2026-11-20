import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/connectionmanager', () => {
  throw new Error('ConnectionManager must not load when the errors explorer modules are imported');
});

const PRODUCTION_DIRECTORIES = ['app', 'components', 'config', 'lib'];
const TEST_DIRECTORY_NAME = '__tests__';
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const ORACLE_ENTRY_FILE = 'tests/oracles/errors-explorer-legacy.ts';
const ORACLE_DIRECTORY = path.posix.dirname(ORACLE_ENTRY_FILE);
const ORACLE_IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"][^'"]*tests\/oracles\/[^'"]*['"]/;
const REPO_ALIAS_PREFIX = '@/';
const SAME_DIRECTORY_PREFIX = './';
const RELATIVE_SPECIFIER_PREFIXES = [SAME_DIRECTORY_PREFIX, '../'];
const RESOLVABLE_EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const LIVE_EXPLORER_PATH = /^(config|lib\/errorsexplorer|lib\/activemeasurementcount|app\/api\/errors)(\/|\.|$)/;
const NON_LITERAL_SPECIFIER_LABEL = 'non-literal module specifier';

interface ModuleReference {
  specifier: string | null;
  sourceText: string;
  isTypeOnly: boolean;
}

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return entry === TEST_DIRECTORY_NAME ? [] : productionSourceFiles(fullPath);
    return SOURCE_FILE.test(entry) && !TEST_FILE.test(entry) ? [fullPath] : [];
  });
}

function literalSpecifier(node: ts.Expression | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function importDeclarationIsTypeOnly(declaration: ts.ImportDeclaration): boolean {
  const clause = declaration.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const namedBindings = clause.namedBindings;
  const onlyInlineTypeNames =
    !clause.name &&
    namedBindings !== undefined &&
    ts.isNamedImports(namedBindings) &&
    namedBindings.elements.length > 0 &&
    namedBindings.elements.every(element => element.isTypeOnly);
  return onlyInlineTypeNames;
}

function exportDeclarationIsTypeOnly(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return true;
  const exportClause = declaration.exportClause;
  return (
    exportClause !== undefined &&
    ts.isNamedExports(exportClause) &&
    exportClause.elements.length > 0 &&
    exportClause.elements.every(element => element.isTypeOnly)
  );
}

function moduleReferencesOf(source: string, fileName: string): ModuleReference[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      references.push({
        specifier: literalSpecifier(node.moduleSpecifier),
        sourceText: node.moduleSpecifier.getText(sourceFile),
        isTypeOnly: importDeclarationIsTypeOnly(node)
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      references.push({
        specifier: literalSpecifier(node.moduleSpecifier),
        sourceText: node.moduleSpecifier.getText(sourceFile),
        isTypeOnly: exportDeclarationIsTypeOnly(node)
      });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      references.push({ specifier: literalSpecifier(expression), sourceText: expression.getText(sourceFile), isTypeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
        references.push({ specifier: literalSpecifier(node.arguments[0]), sourceText: node.arguments[0].getText(sourceFile), isTypeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function resolveToRepoPath(specifier: string, containingRepoPath: string): string | null {
  if (specifier.startsWith(REPO_ALIAS_PREFIX)) return path.posix.normalize(specifier.slice(REPO_ALIAS_PREFIX.length));
  if (RELATIVE_SPECIFIER_PREFIXES.some(prefix => specifier.startsWith(prefix))) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(containingRepoPath), specifier));
  }
  return null;
}

function liveExplorerValueImports(source: string, containingRepoPath: string): string[] {
  return moduleReferencesOf(source, containingRepoPath)
    .filter(reference => !reference.isTypeOnly)
    .filter(reference => {
      if (reference.specifier === null) return true;
      const repoPath = resolveToRepoPath(reference.specifier, containingRepoPath);
      return repoPath !== null && LIVE_EXPLORER_PATH.test(repoPath);
    })
    .map(reference => (reference.specifier === null ? `${NON_LITERAL_SPECIFIER_LABEL} ${reference.sourceText}` : reference.specifier));
}

function resolveSourceFileOnDisk(frontendRoot: string, repoPathWithoutExtension: string): string | null {
  const resolved = RESOLVABLE_EXTENSIONS.map(extension => `${repoPathWithoutExtension}${extension}`).find(candidate => {
    const fullPath = path.join(frontendRoot, candidate);
    return existsSync(fullPath) && statSync(fullPath).isFile();
  });
  return resolved ?? null;
}

function sameDirectoryImportsOf(frontendRoot: string, repoPath: string): string[] {
  const source = readFileSync(path.join(frontendRoot, repoPath), 'utf8');
  return moduleReferencesOf(source, repoPath)
    .filter(reference => reference.specifier?.startsWith(SAME_DIRECTORY_PREFIX))
    .map(reference => {
      const target = resolveToRepoPath(reference.specifier as string, repoPath) as string;
      const resolved = resolveSourceFileOnDisk(frontendRoot, target);
      if (resolved === null) throw new Error(`${repoPath} imports ${reference.specifier}, which resolves to no file under ${target}`);
      return resolved;
    });
}

function oracleFilesReachableFromEntry(frontendRoot: string): string[] {
  const reached = new Set<string>([ORACLE_ENTRY_FILE]);
  const pending = [ORACLE_ENTRY_FILE];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    sameDirectoryImportsOf(frontendRoot, current)
      .filter(imported => !reached.has(imported))
      .forEach(imported => {
        reached.add(imported);
        pending.push(imported);
      });
  }
  return [...reached].sort();
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

  it('freezes the oracle: every file it loads takes only types from the live explorer modules', () => {
    const frontendRoot = path.resolve(__dirname, '../../../..');
    const oracleFiles = oracleFilesReachableFromEntry(frontendRoot);
    const entryImports = sameDirectoryImportsOf(frontendRoot, ORACLE_ENTRY_FILE);
    const liveValueImportsByFile = Object.fromEntries(
      oracleFiles.map(file => [file, liveExplorerValueImports(readFileSync(path.join(frontendRoot, file), 'utf8'), file)])
    );
    const offenders = Object.fromEntries(Object.entries(liveValueImportsByFile).filter(([, specifiers]) => specifiers.length > 0));
    console.log(
      `[#544 imports] oracle files reached from ${ORACLE_ENTRY_FILE}: ${JSON.stringify(oracleFiles)}; live value imports: ${JSON.stringify(offenders)}`
    );
    expect(oracleFiles, 'the walk must include the entry file').toContain(ORACLE_ENTRY_FILE);
    expect(entryImports.length, 'the entry file must import its frozen helpers').toBeGreaterThan(0);
    entryImports.forEach(imported => expect(oracleFiles, `the walk must include ${imported}`).toContain(imported));
    oracleFiles.forEach(file => expect(path.posix.dirname(file), `${file} is outside the oracle directory`).toBe(ORACLE_DIRECTORY));
    expect(offenders).toEqual({});
  });

  it('detects a value import of live explorer code, by any specifier spelling, but allows type-only imports (mutant)', () => {
    const containingFile = `${ORACLE_DIRECTORY}/errors-explorer-legacy-mutant.ts`;
    const typeOnlySource = [
      "import type { ErrorExplorerRow } from '@/config/errorsexplorer';",
      "import type { ColumnValueRow } from '@/lib/errorsexplorer/columnquery';",
      "import type { groupErrorRowsForTest } from '@/app/api/errors/explorer/_shared';",
      "import { type ErrorExplorerSortItem } from '../../config/errorsexplorer';",
      "export type { ErrorExplorerColumnFilter } from '@/config/errorsexplorer';",
      "import { safeFormatQuery } from '@/lib/db/sqlsecurity';",
      "import { toTextCellValue } from './errors-explorer-legacy-columnquery';"
    ].join('\n');
    const mutantLinesAndFlaggedSpecifiers: Array<[string, string]> = [
      ["import { dedupeStrings } from '@/config/errorsexplorer';", '@/config/errorsexplorer'],
      ["import {\n  type ErrorExplorerRow,\n  dedupeNumbers\n} from '@/config/errorsexplorer';", '@/config/errorsexplorer'],
      ["import { readActiveMeasurementCount } from '@/lib/activemeasurementcount';", '@/lib/activemeasurementcount'],
      ["export { compareRowsBySortItem } from '@/lib/errorsexplorer/columnquery';", '@/lib/errorsexplorer/columnquery'],
      ["const live = await import('@/config/errorsexplorer');", '@/config/errorsexplorer'],
      ["import '@/lib/errorsexplorer/columnquery';", '@/lib/errorsexplorer/columnquery'],
      ["import { groupErrorRowsForTest } from '@/app/api/errors/explorer/_shared';", '@/app/api/errors/explorer/_shared'],
      ["import { dedupeStrings } from '../../config/errorsexplorer';", '../../config/errorsexplorer'],
      ["import { buildErrorTypeKey } from '@/lib/errorsexplorer';", '@/lib/errorsexplorer'],
      ["import {\n  dedupeNumbers, // don't drift from the frozen copy\n  dedupeStrings\n} from '@/config/errorsexplorer';", '@/config/errorsexplorer'],
      ['const live = await import(`@/config/errorsexplorer`);', '@/config/errorsexplorer'],
      ["const live = require('@/config/errorsexplorer');", '@/config/errorsexplorer'],
      ['const live = await import(`@/config/${moduleName}`);', `${NON_LITERAL_SPECIFIER_LABEL} \`@/config/\${moduleName}\``]
    ];
    console.log(`[#544 imports] type-only source reports ${JSON.stringify(liveExplorerValueImports(typeOnlySource, containingFile))}`);
    expect(liveExplorerValueImports(typeOnlySource, containingFile)).toEqual([]);
    mutantLinesAndFlaggedSpecifiers.forEach(([mutantLine, flaggedSpecifier]) => {
      const mutant = `${typeOnlySource}\n${mutantLine}`;
      const found = liveExplorerValueImports(mutant, containingFile);
      console.log(`[#544 imports] mutant reports ${JSON.stringify(found)} for:\n${mutantLine}`);
      expect(found, `exactly the added line must be flagged:\n${mutantLine}`).toEqual([flaggedSpecifier]);
    });
  });
});
