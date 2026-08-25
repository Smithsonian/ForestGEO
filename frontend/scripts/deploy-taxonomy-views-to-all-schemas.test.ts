import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { deployTaxonomyViewsToSchema, extractViewStatements } from './deploy-taxonomy-views-to-all-schemas';

describe('taxonomy view deployment helpers', () => {
  it('extracts only the two allowlisted view statements', () => {
    const statements = extractViewStatements(`
      CREATE OR REPLACE VIEW unrelated AS SELECT 0;
      CREATE OR REPLACE VIEW alltaxonomiesview AS SELECT 1;
      CREATE OR REPLACE VIEW stemtaxonomiesview AS SELECT 2;
    `);

    expect([...statements.keys()]).toEqual(['alltaxonomiesview', 'stemtaxonomiesview']);
    expect(statements.get('alltaxonomiesview')).toContain('SELECT 1');
    expect(statements.get('stemtaxonomiesview')).toContain('SELECT 2');
  });

  it('fails closed when an allowlisted definition is missing', () => {
    expect(() => extractViewStatements('CREATE OR REPLACE VIEW alltaxonomiesview AS SELECT 1;')).toThrow(/stemtaxonomiesview/);
  });

  it('applies each extracted statement and reports it only after success', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const connection = { query } as unknown as Connection;
    const onApplied = vi.fn();
    const statements = new Map([
      ['alltaxonomiesview', 'CREATE OR REPLACE VIEW alltaxonomiesview AS SELECT 1;'],
      ['stemtaxonomiesview', 'CREATE OR REPLACE VIEW stemtaxonomiesview AS SELECT 2;']
    ]);

    await deployTaxonomyViewsToSchema(connection, statements, onApplied);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([...statements.values()]);
    expect(onApplied.mock.calls.map(([name]) => name)).toEqual([...statements.keys()]);
  });
});
