import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { findProhibitedModifiers, validateDefaultE2ESuite } from './assert-default-e2e-suite.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeSuite(files) {
  const root = mkdtempSync(join(tmpdir(), 'forestgeo-e2e-suite-'));
  temporaryDirectories.push(root);
  for (const [path, source] of Object.entries(files)) {
    const segments = path.split('/');
    segments.pop();
    mkdirSync(join(root, ...segments), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

test('rejects a same-sized suite when a reviewed spec was replaced', () => {
  const root = makeSuite({ 'alpha.cy.ts': "it('alpha', () => {})", 'replacement.cy.ts': "it('replacement', () => {})" });

  const result = validateDefaultE2ESuite(root, ['alpha.cy.ts', 'reviewed.cy.ts']);

  assert.deepEqual(result.missing, ['reviewed.cy.ts']);
  assert.deepEqual(result.unexpected, ['replacement.cy.ts']);
});

test('recognizes supported focused and skipped Mocha forms', () => {
  const matches = findProhibitedModifiers(`
    test.skip('one', () => {});
    it . only('two', () => {});
    describe['skip']('three', () => {});
    xcontext('four', () => {});
    suite.only('five', () => {});
    xspecify('six', () => {});
  `);

  assert.deepEqual(
    matches.map(match => match.line),
    [2, 3, 4, 5, 6, 7]
  );
});

test('checks real-DB specs for modifiers while excluding them from the default manifest', () => {
  const root = makeSuite({
    'default.cy.ts': "it('default', () => {})",
    'column-mapping-realdb/real.cy.ts': "xit('disabled real DB test', () => {})"
  });

  const result = validateDefaultE2ESuite(root, ['default.cy.ts']);

  assert.deepEqual(result.actual, ['default.cy.ts']);
  assert.deepEqual(
    result.prohibited.map(match => match.path),
    ['column-mapping-realdb/real.cy.ts']
  );
});
