/**
 * SMOKE TEST — server-authoritative CSV resolution (#6)
 *
 * Drives a REAL census export through the exact resolution the server runs on the
 * /api/sqlpacketload raw-rows path (`resolveMeasurementChunk`) plus the wire-boundary
 * mapping guard (`isColumnMappingShape`). It proves, against live data, that:
 *
 *   1. real RABI headers key to canonical measurement fields, with typed cells and
 *      no leaked `__ignored`/raw passthrough keys;
 *   2. an explicit confirmed mapping resolves a RENAMED source column to its
 *      canonical field (the actual column-mapping feature, not just auto-detect);
 *   3. a malformed mapping is rejected at the wire boundary (parity with the 400 gate);
 *   4. a row whose REQUIRED column cannot be resolved is routed to invalidRows with a
 *      "Missing required fields" reason — the server never silently mis-keys it.
 *
 * Reference data lives OUTSIDE the repo (external sample data, intentionally not
 * committed). The default path is the RABI census-3 demo; override with SMOKE_CSV.
 * The suite AUTO-SKIPS when the file is absent, so it is safe to leave in the tree
 * and harmless in CI.
 *
 * Run:
 *   npx vitest run tests/smoke/csv-server-resolution.smoke.test.ts
 *   SMOKE_CSV=/abs/path/to/census.csv npx vitest run tests/smoke/csv-server-resolution.smoke.test.ts
 *
 * SCOPE: this validates the server's resolution AUTHORITY (keying + validation +
 * reconciliation split) offline — no DB, no running server. For the FULL end-to-end
 * check (that resolved rows actually land in `temporarymeasurements` with the right
 * canonical columns, and the post-upload row-count reconciliation does not false-flag),
 * upload the SAME CSV through the dev UI against a live schema; the route-level
 * contract is covered by app/api/sqlpacketload/route.test.ts.
 */
import fs from 'node:fs';
import Papa from 'papaparse';
import { describe, it, expect } from 'vitest';
import { FormType, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { resolveMeasurementChunk } from '@/lib/column-mapping/measurement-rows';
import { isColumnMappingShape, seedMapping } from '@/lib/column-mapping/mapping';

const CSV_PATH = process.env.SMOKE_CSV ?? '/Users/mason/Documents/fgeo_sample_data/RABI/rabi_census3_demo.csv';
const CSV_EXISTS = fs.existsSync(CSV_PATH);

const CANONICAL_FIELDS_PRESENT = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date'] as const;
const REQUIRED_HEADERS = RequiredTableHeadersByFormType[FormType.measurements];

/** Parse a CSV exactly as the upload does: header row + raw string cells, no transform. */
function parseRawCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headers = Array.isArray(parsed.meta.fields) ? parsed.meta.fields : [];
  return { headers, rows: parsed.data };
}

/** Run the server's resolution stage on a chunk (mirrors the sqlpacketload rawRows path). */
function resolveOnServer(rows: Record<string, string>[], headers: string[], storedMapping?: ReturnType<typeof seedMapping>) {
  return resolveMeasurementChunk(rows, headers.length, {
    formType: FormType.measurements,
    uploadMode: 'other',
    delimiter: ',',
    requiredHeaders: REQUIRED_HEADERS,
    csvHeaders: headers,
    storedMapping
  });
}

/** Rebuild rows under a renamed header WHILE PRESERVING COLUMN ORDER (positional keying depends on it). */
function renameColumn(rows: Record<string, string>[], headers: string[], from: string, to: string) {
  const newHeaders = headers.map(h => (h === from ? to : h));
  const newRows = rows.map(row => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h === from ? to : h] = row[h];
    return out;
  });
  return { headers: newHeaders, rows: newRows };
}

// Auto-skip when the external reference file is not present (keeps CI green).
const suite = CSV_EXISTS ? describe : describe.skip;

if (!CSV_EXISTS) {
  // eslint-disable-next-line no-console
  console.warn(`[smoke] SKIPPED — reference CSV not found at ${CSV_PATH}. Set SMOKE_CSV to run.`);
}

suite('smoke: server-authoritative CSV resolution (#6)', () => {
  const text = CSV_EXISTS ? fs.readFileSync(CSV_PATH, 'utf8') : '';
  const { headers, rows } = parseRawCsv(text);

  it('parsed the reference file into raw rows', () => {
    // eslint-disable-next-line no-console
    console.log(`[smoke] ${CSV_PATH}`);
    // eslint-disable-next-line no-console
    console.log(`[smoke] headers (${headers.length}): ${headers.join(', ')}`);
    // eslint-disable-next-line no-console
    console.log(`[smoke] data rows: ${rows.length}`);
    expect(headers.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('(1) keys valid rows to canonical fields and rejects only resolution-invalid rows', () => {
    // NOTE: the RABI demo file deliberately includes invalid rows. The RESOLUTION layer
    // (#6) is responsible only for missing-required + out-of-range/decimal checks; richer
    // business rules (species-not-in-DB, growth limits, duplicates, length caps) are caught
    // downstream by the stored procedure and are correctly PASSED THROUGH here.
    const result = resolveOnServer(rows, headers);

    const reasons = result.invalidRows.map((r, i) => `    [${i}] ${r.failureReason}`).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[smoke] resolved: ${result.validRows.length} valid / ${result.invalidRows.length} invalid (of ${rows.length})`);
    if (result.invalidRows.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[smoke] resolution-layer rejections:\n${reasons}`);
    }

    expect(result.columnCountMismatch).toBe(false);
    expect(result.validRows.length + result.invalidRows.length).toBe(rows.length);
    expect(result.validRows.length).toBeGreaterThan(0);

    // Every rejected row failed for a real resolution-layer reason — never silently mis-keyed.
    const RESOLUTION_REASON = /Missing required fields|out of range|delimiter character|Unusually long/i;
    for (const r of result.invalidRows) {
      expect(r.failureReason ?? '', `unexpected rejection shape: ${JSON.stringify(r)}`).toMatch(RESOLUTION_REASON);
    }

    const sample = result.validRows[0] as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.log(`[smoke] sample keyed row: ${JSON.stringify(sample)}`);

    for (const field of CANONICAL_FIELDS_PRESENT) {
      expect(Object.keys(sample), `canonical field "${field}" must be keyed`).toContain(field);
    }
    // No inert/diverted keys (#5) and no raw passthrough leftovers reach any valid row.
    for (const row of result.validRows) {
      const leaked = Object.keys(row).filter(k => k.includes('__ignored'));
      expect(leaked, `row leaked diverted keys: ${leaked.join(', ')}`).toEqual([]);
    }
    // Per-field type normalization the server applies.
    expect(typeof sample.dbh).toBe('number');
    expect(typeof sample.lx).toBe('number');
    expect(typeof sample.ly).toBe('number');
    expect(sample.date instanceof Date).toBe(true);
  });

  it('(2) resolves a RENAMED source column via an explicit confirmed mapping (split unchanged)', () => {
    const RENAMED = 'stem_diameter_cm'; // not an alias of dbh
    const variant = renameColumn(rows, headers, 'dbh', RENAMED);

    // Build the confirmed mapping the dialog would produce for these headers, then
    // point the `dbh` field at the renamed source column.
    const mapping = seedMapping({ format: SourceFormat.csv, headers: variant.headers });
    const dbhField = mapping.fields.find(f => f.canonicalField === 'dbh');
    expect(dbhField, 'seeded mapping should contain a dbh field').toBeDefined();
    dbhField!.sourceColumns = [RENAMED];

    // It must be a well-formed wire payload (server would 400 otherwise).
    expect(isColumnMappingShape(mapping)).toBe(true);

    const baseline = resolveOnServer(rows, headers);
    const result = resolveOnServer(variant.rows, variant.headers, mapping);
    // eslint-disable-next-line no-console
    console.log(`[smoke] renamed-column mapping: ${result.validRows.length} valid / ${result.invalidRows.length} invalid`);

    expect(result.columnCountMismatch).toBe(false);
    // Re-pointing dbh at a renamed source must not change which rows are valid.
    expect(result.validRows.length).toBe(baseline.validRows.length);
    expect(result.invalidRows.length).toBe(baseline.invalidRows.length);

    // The renamed source collapsed into canonical dbh on every valid row; the raw name is gone.
    for (const row of result.validRows) {
      expect(Object.keys(row), 'raw renamed column must not survive on the row').not.toContain(RENAMED);
    }
    const sample = result.validRows[0] as Record<string, unknown>;
    expect(Object.keys(sample), 'renamed column should resolve into canonical dbh').toContain('dbh');
    expect(typeof sample.dbh).toBe('number');
  });

  it('(3) rejects a malformed mapping at the wire boundary (parity with the 400 gate)', () => {
    expect(isColumnMappingShape({ version: 99 })).toBe(false);
    expect(isColumnMappingShape(null)).toBe(false);
    expect(isColumnMappingShape('not-an-object')).toBe(false);
    expect(isColumnMappingShape([])).toBe(false);
    // A well-formed seeded mapping passes.
    expect(isColumnMappingShape(seedMapping({ format: SourceFormat.csv, headers }))).toBe(true);
  });

  it('(4) routes rows with an unresolvable REQUIRED column to invalidRows (no silent mis-key)', () => {
    // Rename the required `spcode` column to a token that is NOT one of its aliases,
    // and send NO mapping — the server seeds, cannot resolve spcode, and must reject.
    const NON_ALIAS = 'taxon_identifier';
    const variant = renameColumn(rows, headers, 'spcode', NON_ALIAS);

    const result = resolveOnServer(variant.rows, variant.headers);
    // eslint-disable-next-line no-console
    console.log(`[smoke] unresolvable-required: ${result.validRows.length} valid / ${result.invalidRows.length} invalid`);

    expect(result.columnCountMismatch).toBe(false);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(variant.rows.length);
    expect(result.invalidRows[0].failureReason).toMatch(/Missing required fields.*spcode/i);
  });
});
