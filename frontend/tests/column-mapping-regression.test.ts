import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { SourceFormat } from '@/config/macros/formdetails';
import { extractCsvHeaderRow } from '@/lib/column-mapping/csv-headers';
import { chooseEffectiveCsvMapping, mappingApplies, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import { CSV_RESOLVE_OPTIONS, planColumnCountMatches, resolveHeaders } from '@/lib/column-mapping/resolution';
import { aliasesFor } from '@/lib/column-mapping/fields';

// Cross-cutting regressions that tie the column-mapping pieces together. Unit-level behavior
// (extractor edge cases, signature shape, chooseEffectiveCsvMapping branches, route trust checks)
// is pinned in the respective *.test.ts files; these tests pin the SEAMS between them.

function csvFile(text: string, name = 'sample.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

/** The exact column count papaparse parses for a CSV body with the given delimiter. */
function papaColumnCount(text: string, delimiter: string): number {
  const result = Papa.parse<string[]>(text, { delimiter, header: false, preview: 1, skipEmptyLines: true });
  return (result.data[0] ?? []).length;
}

const CSV = SourceFormat.csv;
const csvAliases = aliasesFor(CSV);

// A header set that satisfies every REQUIRED measurements field (tag, spcode, quadrat, lx, ly, date),
// so a mapping seeded from it is valid. Reused as the "known-good fallback target".
const FULLY_VALID_HEADERS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];

describe('CSV header plan preserves column count across parser edge cases (divergence guard never false-fires)', () => {
  // The upload executor aborts when the resolved plan's outputKeys.length disagrees with the number
  // of columns papaparse parsed. These are exactly the header shapes the OLD custom tokenizer split
  // incorrectly (keeping quotes / splitting quoted newlines). With Papa as the single source, the
  // plan and Papa agree by construction — proven here per shape.
  const cases: { name: string; body: string; expectedColumns: number }[] = [
    { name: 'quoted delimiter inside a header cell', body: '"tag,alias",spcode\n1,2\n', expectedColumns: 2 },
    { name: 'quoted newline inside a header cell', body: '"tag\nx",spcode\n1,2\n', expectedColumns: 2 },
    { name: 'leading BOM', body: '﻿tag,spcode\n1,2\n', expectedColumns: 2 },
    { name: 'duplicate headers', body: 'tag,tag,spcode\n1,2,3\n', expectedColumns: 3 },
    { name: 'blank header column', body: 'tag,,spcode\n1,2,3\n', expectedColumns: 3 }
  ];

  for (const { name, body, expectedColumns } of cases) {
    it(name, async () => {
      const headers = await extractCsvHeaderRow(csvFile(body), ',');
      expect(headers.length).toBe(expectedColumns);
      // The extractor's column count is authoritative against a raw Papa parse of the same body.
      expect(headers.length).toBe(papaColumnCount(body, ','));

      const plan = resolveHeaders(headers, seedMapping({ format: CSV, headers }), csvAliases, CSV_RESOLVE_OPTIONS);
      // resolveHeaders emits exactly one output key per input header, so the upload's
      // `plan.outputKeys.length === papaFields.length` invariant holds for every shape above.
      expect(plan.outputKeys.length).toBe(expectedColumns);
    });
  }
});

describe('divergence guard predicate (planColumnCountMatches — the exact function the upload guard calls)', () => {
  // uploadfiresql.tsx aborts the upload on the first chunk when `!planColumnCountMatches(plan, papaFields)`.
  // Testing the shared predicate (not a re-derived `a !== b`) means a regression to the guard's
  // comparison — flipped operator, wrong operand — fails here. The abort WIRING around it remains
  // integration-only (verified by code-trace in the Task 3 review).
  it('matches when the plan was built from the same number of columns papa parsed (guard does NOT fire)', () => {
    const headers = ['tag', 'spcode', 'quadrat'];
    const plan = resolveHeaders(headers, seedMapping({ format: CSV, headers }), csvAliases, CSV_RESOLVE_OPTIONS);
    expect(planColumnCountMatches(plan, headers.length)).toBe(true);
  });

  it('does NOT match when papa parsed a different column count, so the guard fires and the upload aborts', () => {
    const headers = ['tag', 'spcode', 'quadrat']; // a 3-column plan
    const plan = resolveHeaders(headers, seedMapping({ format: CSV, headers }), csvAliases, CSV_RESOLVE_OPTIONS);
    expect(planColumnCountMatches(plan, 4)).toBe(false); // e.g. the file gained a column between preview and upload
  });
});

describe('delimiter-change staleness invalidates a confirmed mapping', () => {
  it('a mapping built under one delimiter stops applying after the delimiter switches', async () => {
    const body = 'tag,spcode\n1,2\n'; // comma-delimited content
    const headersComma = await extractCsvHeaderRow(csvFile(body), ',');
    const headersSemicolon = await extractCsvHeaderRow(csvFile(body), ';');

    expect(headersComma).toEqual(['tag', 'spcode']);
    expect(headersSemicolon).toEqual(['tag,spcode']); // wrong delimiter collapses to a single header

    const mapping = seedMapping({ format: CSV, headers: headersComma });
    expect(mappingApplies(mapping, headersComma)).toBe(true);
    expect(mappingApplies(mapping, headersSemicolon)).toBe(false);

    // Upload-time revalidation must seed instead of reusing the now-stale mapping.
    const chosen = chooseEffectiveCsvMapping(mapping, headersSemicolon);
    expect(chosen.usedStored).toBe(false);
    expect(chosen.reasonCode).toBe('stale');
  });
});

describe('stored-mapping fallback is safe (the seeded replacement is usable)', () => {
  it('falls back to a seed that still satisfies every required field', () => {
    // A stored mapping built for unrelated headers does not apply to this file.
    const storedForOtherFile = seedMapping({ format: CSV, headers: ['totally', 'different'] });
    const chosen = chooseEffectiveCsvMapping(storedForOtherFile, FULLY_VALID_HEADERS);

    expect(chosen.usedStored).toBe(false);
    // The fallback is not merely "not the stored one" — it is a valid mapping for THIS file, so the
    // upload proceeds with a usable plan rather than a degenerate one.
    expect(validateMapping(chosen.mapping, { format: CSV, headers: FULLY_VALID_HEADERS }).valid).toBe(true);
  });
});
