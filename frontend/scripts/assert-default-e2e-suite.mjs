import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_DEFAULT_SPECS = Object.freeze([
  'a11y-responsive.cy.ts',
  'accessibility-audit.cy.ts',
  'admin-provisioning.cy.ts',
  'admin-workflows.cy.ts',
  'app.cy.ts',
  'bug-fixes-e2e.cy.ts',
  'census-creation.cy.ts',
  'column-mapping/arcgis-preflight-mapping.cy.ts',
  'column-mapping/csv-mapping-dialog.cy.ts',
  'column-mapping/mapping-negative-paths.cy.ts',
  'column-mapping/mapping-signature-persistence.cy.ts',
  'complete-auth-and-selection-flow.cy.ts',
  'cross-feature-integration.cy.ts',
  'dashboard-visual-enhancements.cy.ts',
  'data-editing-workflows.cy.ts',
  'data-viewing-comprehensive.cy.ts',
  'demo/product-showcase.cy.ts',
  'duplicate-tag-stemtag-detection.cy.ts',
  'error-recovery-workflows.cy.ts',
  'errors-explorer.cy.ts',
  'fixed-data-management.cy.ts',
  'measurements-datagrid.cy.ts',
  'performance-benchmarks.cy.ts',
  'recent-changes.cy.ts',
  'revision-upload.cy.ts',
  'selection-persistence.cy.ts',
  'upload-file-management.cy.ts',
  'validation-invalid-codes.cy.ts',
  'validations-management.cy.ts'
]);

const SPEC_PATTERN = /\.cy\.(?:js|ts|jsx|tsx)$/;
const DEFAULT_EXCLUDED_PREFIX = 'column-mapping-realdb/';
const PROHIBITED_MODIFIER_PATTERN =
  /\b(?:x(?:it|test|specify|describe|context|suite))\s*\(|\b(?:it|test|specify|describe|context|suite)\s*(?:\.\s*(?:skip|only)|\[\s*(['"])(?:skip|only)\1\s*\])\s*\(/g;

function toPosixPath(path) {
  return path.replaceAll('\\', '/');
}

export function listSpecFiles(rootDirectory) {
  const visit = (directory, prefix = '') =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return visit(absolutePath, relativePath);
      return entry.isFile() && SPEC_PATTERN.test(entry.name) ? [toPosixPath(relativePath)] : [];
    });

  return visit(rootDirectory).sort();
}

export function findProhibitedModifiers(source) {
  return [...source.matchAll(PROHIBITED_MODIFIER_PATTERN)].map(match => ({
    line: source.slice(0, match.index).split('\n').length,
    expression: match[0].trim()
  }));
}

export function validateDefaultE2ESuite(rootDirectory, expectedSpecs = EXPECTED_DEFAULT_SPECS) {
  const allSpecs = listSpecFiles(rootDirectory);
  const actualDefaultSpecs = allSpecs.filter(path => !path.startsWith(DEFAULT_EXCLUDED_PREFIX));
  const expected = [...expectedSpecs].sort();
  const actual = [...actualDefaultSpecs].sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter(path => !actualSet.has(path));
  const unexpected = actual.filter(path => !expectedSet.has(path));
  const prohibited = allSpecs.flatMap(path => findProhibitedModifiers(readFileSync(resolve(rootDirectory, path), 'utf8')).map(match => ({ path, ...match })));

  return { actual, missing, unexpected, prohibited };
}

function main() {
  const rootDirectory = resolve(process.cwd(), 'cypress/e2e');
  const result = validateDefaultE2ESuite(rootDirectory);

  if (result.missing.length > 0 || result.unexpected.length > 0) {
    console.error('::error::Default e2e spec manifest changed. Review the change and update EXPECTED_DEFAULT_SPECS.');
    for (const path of result.missing) console.error(`  missing: ${path}`);
    for (const path of result.unexpected) console.error(`  unexpected: ${path}`);
  }

  if (result.prohibited.length > 0) {
    console.error('::error::Focused or skipped tests found under cypress/e2e.');
    for (const match of result.prohibited) console.error(`  ${match.path}:${match.line}: ${match.expression}`);
  }

  if (result.missing.length > 0 || result.unexpected.length > 0 || result.prohibited.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Default e2e suite: ${result.actual.length} reviewed specs, no focus/skip modifiers`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
