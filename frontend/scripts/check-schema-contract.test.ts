import { describe, it, expect } from 'vitest';
import { summarizeAudits, parseAuditArgs } from './check-schema-contract';
import type { ContractAudit } from './apply-schema-migrations';

function audit(schema: string, ok: boolean): ContractAudit {
  return {
    schema,
    contractFailures: ok
      ? []
      : [{ table: 'temporarymeasurements', object: 'PublishedStemID', category: 'column', kind: 'missing', expected: 'int unsigned', actual: null }],
    contractExtras: [],
    collationViolations: ok ? [] : ['temporarymeasurements.Comments => utf8mb4_general_ci'],
    missingProcedures: [],
    pendingMigrationIds: ok ? [] : ['2026-07-13-01-add-published-stemid-and-source-format'],
    ok
  };
}

describe('summarizeAudits', () => {
  it('passes and reports N when every schema is compatible', () => {
    const summary = summarizeAudits([audit('a', true), audit('b', true)]);
    expect(summary.passed).toBe(true);
    expect(summary.checked).toBe(2);
    expect(summary.incompatible).toBe(0);
    expect(summary.message).toBe('schema-contract OK: 2 schemas');
  });

  it('fails and counts incompatible schemas', () => {
    const summary = summarizeAudits([audit('a', true), audit('b', false), audit('c', false)]);
    expect(summary.passed).toBe(false);
    expect(summary.checked).toBe(3);
    expect(summary.incompatible).toBe(2);
    expect(summary.message).toBe('schema-contract FAILED: 3 schemas checked, 2 incompatible');
  });

  it('treats zero schemas checked as a FAILURE (no false green)', () => {
    const summary = summarizeAudits([]);
    expect(summary.passed).toBe(false);
    expect(summary.checked).toBe(0);
    expect(summary.message).toBe('schema-contract FAILED: 0 schemas checked, 0 incompatible');
  });
  it('reports quarantined schemas in the OK line without counting them as checked', () => {
    const summary = summarizeAudits([audit('a', true), audit('b', true)], ['forestgeo_new']);
    console.log(`[summary] ${JSON.stringify(summary)}`);
    expect(summary.passed).toBe(true);
    expect(summary.checked).toBe(2);
    expect(summary.quarantined).toBe(1);
    expect(summary.message).toBe('schema-contract OK: 2 schemas (1 quarantined: forestgeo_new)');
  });

  it('still fails when every schema is quarantined (zero checked)', () => {
    const summary = summarizeAudits([], ['forestgeo_a', 'forestgeo_b']);
    console.log(`[summary] ${JSON.stringify(summary)}`);
    expect(summary.passed).toBe(false);
    expect(summary.message).toBe('schema-contract FAILED: 0 schemas checked, 0 incompatible (2 quarantined: forestgeo_a, forestgeo_b)');
  });

  it('keeps the exact legacy message when nothing is quarantined', () => {
    expect(summarizeAudits([audit('a', true)]).message).toBe('schema-contract OK: 1 schemas');
    expect(summarizeAudits([audit('a', true)]).quarantined).toBe(0);
  });
});

describe('parseAuditArgs', () => {
  it('parses --all-sites', () => {
    expect(parseAuditArgs(['--all-sites'])).toEqual({ allSites: true, schema: null });
  });

  it('parses --schema <name>', () => {
    expect(parseAuditArgs(['--schema', 'forestgeo_x'])).toEqual({ allSites: false, schema: 'forestgeo_x' });
  });

  it('rejects neither or both targets', () => {
    expect(() => parseAuditArgs([])).toThrow(/Exactly one target/);
    expect(() => parseAuditArgs(['--all-sites', '--schema', 'x'])).toThrow(/Exactly one target/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseAuditArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});
