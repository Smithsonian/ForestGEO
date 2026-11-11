import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllCaches, DelimiterIssueCode, validateDelimiter } from './delimiterdetection';

const SPECIES_REQUIRED_HEADERS = ['spcode', 'species'];

function fileOf(text: string, name: string): File {
  return new File([text], name, { type: 'text/plain' });
}

describe('validateDelimiter (quoted headers from R write.table)', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it('accepts a quoted, tab-delimited R-style header with no missing-columns issue', async () => {
    const content =
      '"Spcode"\t"Latin"\t"Genus"\t"Species"\t"Family"\t"speciesID"\t"authority"\t"IDlevel"\t"syn"\t"subsp"\n' +
      '"ACAL"\t"Acalypha diversifolia"\t"Acalypha"\t"diversifolia"\t"Euphorbiaceae"\t"1"\t"L."\t"species"\t"0"\t""\n';
    const file = fileOf(content, 'quoted-tab.tsv');

    const result = await validateDelimiter(file, '\t', SPECIES_REQUIRED_HEADERS);

    expect(result.isValid).toBe(true);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS)).toBe(false);
  });

  it('accepts the same quoted content when comma-delimited', async () => {
    const content =
      '"Spcode","Latin","Genus","Species","Family","speciesID","authority","IDlevel","syn","subsp"\n' +
      '"ACAL","Acalypha diversifolia","Acalypha","diversifolia","Euphorbiaceae","1","L.","species","0",""\n';
    const file = fileOf(content, 'quoted-comma.csv');

    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);

    expect(result.isValid).toBe(true);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS)).toBe(false);
  });

  it('still accepts unquoted headers, including case/separator normalization (no regression)', async () => {
    const content = 'SpCode,sp_code,Family,Genus,Species,Subspecies\n' + 'ACAL,ACAL,Euphorbiaceae,Acalypha,diversifolia,\n';
    const file = fileOf(content, 'unquoted.csv');

    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);

    expect(result.isValid).toBe(true);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS)).toBe(false);
  });

  it('still rejects a genuinely missing required column (quoted headers, no Species)', async () => {
    const content = '"Spcode","Family","Genus","speciesID","authority"\n' + '"ACAL","Euphorbiaceae","Acalypha","1","L."\n';
    const file = fileOf(content, 'missing-species-quoted.csv');

    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);

    expect(result.isValid).toBe(false);
    const missing = result.issues.find(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS);
    expect(missing).toBeDefined();
    expect(missing?.message).toContain('Species');
  });

  it('does not let a quoted "speciesID" header partially satisfy the "species" requirement', async () => {
    // Deliberately omit an actual "Species" column; "speciesID" must not match it.
    const content = '"Spcode","speciesID","Family"\n' + '"ACAL","1","Euphorbiaceae"\n';
    const file = fileOf(content, 'speciesid-only.csv');

    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);

    expect(result.isValid).toBe(false);
    const missing = result.issues.find(i => i.code === DelimiterIssueCode.MISSING_REQUIRED_COLUMNS);
    expect(missing).toBeDefined();
    expect(missing?.message).toContain('Species');
  });

  it('still flags a row/header column count mismatch (quotes do not mask real issues)', async () => {
    const content = '"Spcode","Species","Family"\n' + '"ACAL","diversifolia"\n'; // one column short
    const file = fileOf(content, 'row-mismatch.csv');

    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);

    expect(result.issues.some(i => i.code === DelimiterIssueCode.ROW_COLUMN_COUNT_MISMATCH)).toBe(true);
  });
});

// Issue #504: a header-only CSV was shown as "Valid" by client validation, submitted as a Clean
// Re-Upload, and the server-side census replacement deleted all existing measurements. These
// cases must all be flagged NO_DATA_ROWS -- a STRUCTURAL failure (asserted by the mapping-rescue
// test below) rather than silently treated as a passing file.
describe('validateDelimiter (empty-data detection — issue #504)', () => {
  beforeEach(() => {
    clearAllCaches();
  });

  function expectNoDataRows(result: Awaited<ReturnType<typeof validateDelimiter>>) {
    expect(result.isValid).toBe(false);
    const issue = result.issues.find(i => i.code === DelimiterIssueCode.NO_DATA_ROWS);
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/empty|no data rows/i);
  }

  it('flags a header-only file with a trailing newline', async () => {
    const file = fileOf('spcode,species\n', 'header-only-trailing-newline.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a header-only file with NO trailing newline', async () => {
    // Deliberately no trailing "\n" -- the fixture must actually match the title.
    const file = fileOf('spcode,species', 'header-only-no-trailing-newline.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a header followed only by trailing blank lines', async () => {
    const file = fileOf('spcode,species\n\n\n\n', 'header-trailing-blanks.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a header followed only by whitespace-only lines', async () => {
    const file = fileOf('spcode,species\n   \n\t\n', 'header-whitespace-lines.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a header followed only by delimiter-only padding lines (e.g. ",,")', async () => {
    const file = fileOf('spcode,species\n,\n,\n', 'header-comma-padding.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a header followed only by quoted-empty cells (e.g. "","")', async () => {
    const file = fileOf('spcode,species\n"",""\n', 'header-quoted-empty.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a tab-delimited header followed only by tab-only padding lines', async () => {
    const file = fileOf('spcode\tspecies\n\t\n\t\n', 'header-tab-padding.tsv');
    const result = await validateDelimiter(file, '\t', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('flags a totally empty file', async () => {
    const file = fileOf('', 'totally-empty.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('does NOT flag NO_DATA_ROWS when a real data row follows more than five blank lines', async () => {
    // The old implementation only inspected the first five physical lines; a real row
    // past that point must still be recognized so it is not misclassified as empty.
    const content = 'spcode,species\n' + '\n'.repeat(8) + 'ACAL,diversifolia\n';
    const file = fileOf(content, 'data-after-many-blank-lines.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  // validateDelimiter only reads the first 5KB of the file for its other checks; the
  // real data row here starts well past that sample window, so this specifically
  // exercises the whole-file fallback scan, not the 5KB-sample check.
  const PADDING_BYTE_COUNT = 6 * 1024 + 500; // > 6KB, safely past the 5KB sample window
  const paddingBlankLines = '\n'.repeat(PADDING_BYTE_COUNT);

  it('does NOT flag NO_DATA_ROWS when the real data row is preceded by >6KB of blank-line padding', async () => {
    const content = 'spcode,species\n' + paddingBlankLines + 'ACAL,diversifolia\n';
    expect(content.length).toBeGreaterThan(5 * 1024);
    const file = fileOf(content, 'data-after-6kb-blank-padding.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('does NOT flag NO_DATA_ROWS when the real data row is preceded by >6KB of delimiter-only padding', async () => {
    const paddingDelimiterOnlyLines = `${','.repeat(10)}\n`.repeat(Math.ceil(PADDING_BYTE_COUNT / 11));
    const content = 'spcode,species\n' + paddingDelimiterOnlyLines + 'ACAL,diversifolia\n';
    expect(content.length).toBeGreaterThan(6 * 1024);
    const file = fileOf(content, 'data-after-6kb-delimiter-padding.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('flags NO_DATA_ROWS when only padding runs all the way to EOF, even past the 5KB sample', async () => {
    const content = 'spcode,species\n' + paddingBlankLines;
    expect(content.length).toBeGreaterThan(5 * 1024);
    const file = fileOf(content, 'padding-to-eof.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('does NOT flag NO_DATA_ROWS for a quoted multiline record that is the only data row', async () => {
    // A quoted field containing a literal newline is still ONE CSV record; the greedy
    // skip-empty-lines pass (and the whole-file fallback scan) must not mistake the
    // embedded newline for a second, blank row.
    const content = 'spcode,species\n"ACAL","multi\nline value"\n';
    const file = fileOf(content, 'quoted-multiline-record.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('does NOT flag NO_DATA_ROWS for a quoted multiline record that starts beyond the 5KB sample', async () => {
    const content = 'spcode,species\n' + paddingBlankLines + '"ACAL","multi\nline value"\n';
    expect(content.length).toBeGreaterThan(5 * 1024);
    const file = fileOf(content, 'quoted-multiline-record-beyond-sample.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('does NOT flag NO_DATA_ROWS for a normal file with a real data row (no regression)', async () => {
    const file = fileOf('spcode,species\nACAL,diversifolia\n', 'normal.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
    expect(result.isValid).toBe(true);
  });

  it('correctly finds data beyond a BOM-prefixed header (BOM does not break row counting)', async () => {
    const file = fileOf('\uFEFFspcode,species\nACAL,diversifolia\n', 'bom-with-data.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('flags a BOM-prefixed header-only file as empty', async () => {
    const file = fileOf('\uFEFFspcode,species\n', 'bom-header-only.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });

  it('correctly finds data when the file uses CRLF line endings', async () => {
    const file = fileOf('spcode,species\r\nACAL,diversifolia\r\n', 'crlf-with-data.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expect(result.issues.some(i => i.code === DelimiterIssueCode.NO_DATA_ROWS)).toBe(false);
  });

  it('flags a header-only file with CRLF line endings and trailing blank CRLF lines', async () => {
    const file = fileOf('spcode,species\r\n\r\n\r\n', 'crlf-header-only.csv');
    const result = await validateDelimiter(file, ',', SPECIES_REQUIRED_HEADERS);
    expectNoDataRows(result);
  });
});
