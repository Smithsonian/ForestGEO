import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readArcgisSheetMetadata, readArcgisWorkbook, readArcgisWorkbookDetailed } from './workbook-reader';
import { transformArcgisWorkbook } from './transform';
import { AmbiguousSheetError, MissingSheetError, MissingColumnError } from './errors';
import { SourceFormat } from '@/config/macros/formdetails';
import type { ColumnMapping } from '@/lib/column-mapping/types';

async function buildWorkbook(sheets: Record<string, unknown[][]>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    aoa.forEach(row => ws.addRow(row));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M', 'COD_P'];
const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A', 'COD_I'];

describe('readArcgisWorkbook', () => {
  it('splits trees and stems by column signature regardless of sheet names', async () => {
    const buffer = await buildWorkbook({
      CooksBranch_trees_2026: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      CooksBranch_stems_2026: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    const { trees, stems } = await readArcgisWorkbook(buffer);

    expect(trees).toHaveLength(1);
    expect(stems).toHaveLength(1);
    expect(trees[0].GlobalID).toBe('G1');
    expect(trees[0].lx).toBe('5.1');
    expect(trees[0].Date_measured).toBe(46036);
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('canonicalizes a StemID header to the publishedstemid key on both sheets', async () => {
    const treeHeader = [...TREE_HEADER, 'StemID'];
    const stemHeader = [...STEM_HEADER, 'StemID'];
    const buffer = await buildWorkbook({
      trees: [treeHeader, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA', '5001']],
      stems: [stemHeader, ['G1', 'S1', 'A25', '100', '100-2', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA', '5002']]
    });

    const { trees, stems } = await readArcgisWorkbook(buffer);

    // The raw 'StemID' header is exposed under the canonical FileRow key, never the raw string.
    expect(trees[0].publishedstemid).toBe('5001');
    expect(trees[0].StemID).toBeUndefined();
    expect(stems[0].publishedstemid).toBe('5002');
  });

  it('treats empty cells as null', async () => {
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', '', '100', '100', 'QURU', '12.3', '1.3', '', 46036, '5.1', '6.2', '', '']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees } = await readArcgisWorkbook(buffer);
    expect(trees[0].quadrat).toBeNull();
    expect(trees[0].notes).toBeNull();
  });

  it('drops an all-empty-string data row so it never becomes a spurious all-null failure downstream (exceljs reader is intentionally stricter than the old xlsx object-mode, which would have kept it as an all-null row)', async () => {
    // Trees sheet: a valid header, one populated row, then one row whose every cell is an explicit
    // empty string. The old xlsx sheet_to_json({defval:null, raw:true}) object-mode would have emitted
    // the empty-string row as an all-null object; the exceljs reader must DROP it. This contract exists
    // so a future refactor cannot silently flip back to manufacturing a phantom all-null failure row.
    const populatedTreeRow = ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA'];
    const allEmptyStringTreeRow = TREE_HEADER.map(() => '');
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, populatedTreeRow, allEmptyStringTreeRow],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    const { trees } = await readArcgisWorkbook(buffer);

    // Only the populated row survives; the all-empty-string row is dropped (not emitted as all-null).
    expect(trees).toHaveLength(1);
    expect(trees[0].GlobalID).toBe('G1');
    expect(trees[0].lx).toBe('5.1');
    expect(trees[0].ly).toBe('6.2');
  });

  it('throws MissingSheetError when no stems sheet exists', async () => {
    const buffer = await buildWorkbook({ trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', '', 46036, '5.1', '6.2', 'M', '']] });
    await expect(readArcgisWorkbook(buffer)).rejects.toThrow(MissingSheetError);
  });

  it('throws AmbiguousSheetError when multiple stems sheet candidates exist', async () => {
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems_a: [STEM_HEADER, ['G1', 'S1', 'A25', '100', '100-1', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']],
      stems_b: [STEM_HEADER, ['G1', 'S2', 'A25', '100', '100-2', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    await expect(readArcgisWorkbook(buffer)).rejects.toThrow(AmbiguousSheetError);
  });

  it('throws AmbiguousSheetError when multiple trees sheet candidates exist', async () => {
    const buffer = await buildWorkbook({
      trees_a: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      trees_b: [TREE_HEADER, ['G2', 'A25', '101', '101', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', '100-1', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    await expect(readArcgisWorkbook(buffer)).rejects.toThrow(AmbiguousSheetError);
  });

  it('throws MissingColumnError when the stems sheet lacks required columns', async () => {
    const stemHeaderMissing = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured'];
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [stemHeaderMissing, ['G1', 'S1', 'A25', '100', '100-1', '4.4', '1.3', '', 46036]]
    });
    await expect(readArcgisWorkbook(buffer)).rejects.toThrow(MissingColumnError);
  });

  it('accepts capitalized Lx/Ly aliases and resolves them through the transform', async () => {
    const TREE_HEADER_CAPS = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'Lx', 'Ly', 'COD_M', 'COD_P'];
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER_CAPS, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', '100-2', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    const workbook = await readArcgisWorkbook(buffer);
    expect(workbook.trees).toHaveLength(1);
    // Headers are canonicalized at read time, so 'Lx' is exposed under the canonical 'lx' key.
    expect(workbook.trees[0].lx).toBe('5.1');

    const { rows } = transformArcgisWorkbook(workbook);
    expect(rows[0].lx).toBe('5.1');
    expect(rows[0].ly).toBe('6.2');
  });

  it('throws MissingColumnError when the trees sheet lacks lx/ly', async () => {
    const headerNoCoords = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured'];
    const buffer = await buildWorkbook({
      trees: [headerNoCoords, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', '', 46036]],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    await expect(readArcgisWorkbook(buffer)).rejects.toThrow(MissingColumnError);
  });

  it('detects the stems sheet from a lowercase parentglobalid signature header', async () => {
    const stemHeaderLower = ['parentglobalid', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured'];
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [stemHeaderLower, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036]]
    });
    const { stems } = await readArcgisWorkbook(buffer);
    expect(stems).toHaveLength(1);
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('detects the stems sheet from a Parent_GlobalID signature header with underscore separator', async () => {
    const stemHeaderUnderscore = ['Parent_GlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured'];
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [stemHeaderUnderscore, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036]]
    });
    const { stems } = await readArcgisWorkbook(buffer);
    expect(stems).toHaveLength(1);
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('canonicalizes mixed-case and underscore tree headers (GLOBALID/LX/Ly/Local_X) to lx/ly/GlobalID', async () => {
    // 'Local_X' normalizes to 'localx' === norm('LocalX'), which is an alias of the lx field; we keep
    // LX as the lx source here and exercise Ly (case) + GLOBALID (case) on the other required fields.
    const treeHeaderVariant = ['GLOBALID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'LX', 'Ly', 'COD_M'];
    const buffer = await buildWorkbook({
      trees: [treeHeaderVariant, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees } = await readArcgisWorkbook(buffer);
    expect(trees).toHaveLength(1);
    expect(trees[0].GlobalID).toBe('G1');
    expect(trees[0].lx).toBe('5.1');
    expect(trees[0].ly).toBe('6.2');
  });

  it('resolves the lx field from a Local_X underscore alias header', async () => {
    const treeHeaderLocal = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'Local_X', 'LocalY', 'COD_M'];
    const buffer = await buildWorkbook({
      trees: [treeHeaderLocal, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees } = await readArcgisWorkbook(buffer);
    expect(trees[0].lx).toBe('5.1');
    expect(trees[0].ly).toBe('6.2');
  });

  it('splits correctly when the stems sheet comes first in the workbook', async () => {
    const buffer = await buildWorkbook({
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']],
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']]
    });
    const { trees, stems } = await readArcgisWorkbook(buffer);
    expect(trees).toHaveLength(1);
    expect(stems).toHaveLength(1);
    expect(trees[0].GlobalID).toBe('G1');
    expect(trees[0].lx).toBe('5.1');
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('ignores an extra junk sheet and still detects trees and stems by signature', async () => {
    const buffer = await buildWorkbook({
      Summary: [
        ['Region', 'Count', 'Notes'],
        ['CooksBranch', 42, 'export summary']
      ],
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees, stems } = await readArcgisWorkbook(buffer);
    expect(trees).toHaveLength(1);
    expect(stems).toHaveLength(1);
    expect(trees[0].lx).toBe('5.1');
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('hardens against a malicious __proto__ header: the row keeps a null prototype, the __proto__ column is a harmless own key, normal columns still parse, and global Object.prototype is not polluted', async () => {
    // A header literally named "__proto__" canonicalizes to null (no alias normalizes to "proto"),
    // so it is used VERBATIM as the row's object key. On a plain {} the assignment normalized['__proto__']
    // = value would fire the Object.prototype __proto__ setter and replace the row's prototype, breaking
    // every later `key in row` / Object.entries consumer. The reader builds rows with Object.create(null),
    // so the setter does not exist and __proto__ becomes an ordinary own data key. This test fails if a
    // future refactor reverts to a plain object literal.
    const sentinelProtoValue = 'PWNED_PROTO_VALUE';
    const treeHeaderWithProto = [...TREE_HEADER, '__proto__'];
    const treeDataRow = ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA', sentinelProtoValue];
    const buffer = await buildWorkbook({
      trees: [treeHeaderWithProto, treeDataRow],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    // (a) Reading must not throw despite the dangerous header.
    const { trees } = await readArcgisWorkbook(buffer);
    expect(trees).toHaveLength(1);
    const row = trees[0];

    // The row object was NOT corrupted: its prototype is null (Object.create(null)), proving the
    // __proto__ setter never fired to swap the prototype to something else.
    expect(Object.getPrototypeOf(row)).toBeNull();

    // The __proto__ column survives as an ordinary OWN key holding the cell value verbatim (Option A
    // preserves the data instead of dropping the column).
    expect(Object.prototype.hasOwnProperty.call(row, '__proto__')).toBe(true);
    expect((row as Record<string, unknown>).__proto__).toBe(sentinelProtoValue);

    // The normal canonical columns parse exactly as they would without the malicious header.
    expect(row.GlobalID).toBe('G1');
    expect(row.quadrat).toBe('A25');
    expect(row.lx).toBe('5.1');
    expect(row.ly).toBe('6.2');
    expect(row.Date_measured).toBe(46036);

    // (b) Global Object.prototype was not polluted by parsing the crafted value.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).__proto__).toBe(Object.prototype);

    // The hardened row still feeds the transform without error and yields the expected canonical row.
    const { rows } = transformArcgisWorkbook({ trees, stems: [] });
    expect(rows[0].lx).toBe('5.1');
    expect(rows[0].ly).toBe('6.2');
    expect(rows[0].quadrat).toBe('A25');
  });

  it('reads a date-formatted cell as the same ISO date the old reader produced', async () => {
    const wb = new ExcelJS.Workbook();
    const trees = wb.addWorksheet('trees');
    trees.addRow(TREE_HEADER);
    // TREE_HEADER Date_measured is column 9; set an actual date with a date number format.
    const treeRow = trees.addRow(['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', null, '5.1', '6.2', 'M', 'NA']);
    treeRow.getCell(9).value = new Date(Date.UTC(2026, 0, 15));
    treeRow.getCell(9).numFmt = 'yyyy-mm-dd';

    const stems = wb.addWorksheet('stems');
    stems.addRow(STEM_HEADER);
    // The emitted row's date comes from the STEM's Date_measured (STEM_HEADER column 10);
    // set it as a date-formatted cell to prove the Date round-trips with no timezone off-by-one.
    const stemRow = stems.addRow(['G1', 'S1', 'A25', '100', 'S100', 'QURU', '4.4', '1.3', '', null, 'A', 'NA']);
    stemRow.getCell(10).value = new Date(Date.UTC(2026, 0, 15));
    stemRow.getCell(10).numFmt = 'yyyy-mm-dd';

    const workbook = await readArcgisWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const result = transformArcgisWorkbook(workbook);
    expect(result.rows[0].date).toBe('2026-01-15');
  });
});

const CUSTOM_TREE_HEADER = ['GlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'MyX', 'MyY', 'When'];
const CUSTOM_STEM_HEADER = ['GlobalID', 'ParentGlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'When'];

describe('readArcgisWorkbookDetailed', () => {
  it('returns ok with the workbook on success', async () => {
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const outcome = await readArcgisWorkbookDetailed(buffer);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.workbook.trees).toHaveLength(1);
  });

  it('returns raw sheet headers on a mapping-resolvable failure instead of throwing', async () => {
    const buffer = await buildWorkbook({
      TreesCustom: [
        ['GlobalID', 'TreeTag', 'Sp', 'Q', 'MyX', 'MyY', 'When'],
        ['G1', '100', 'QURU', 'A25', '5.1', '6.2', 46036]
      ],
      StemsCustom: [
        ['GlobalID', 'ParentGlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'When'],
        ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]
      ]
    });
    const outcome = await readArcgisWorkbookDetailed(buffer);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(MissingColumnError);
      expect(outcome.sheets.map(s => s.name)).toEqual(['TreesCustom', 'StemsCustom']);
      expect(outcome.sheets[0].columns).toContain('MyX'); // RAW header, not canonicalized
    }
  });
});

describe('readArcgisSheetMetadata', () => {
  it('reports per-sheet columns IDENTICAL to the sheets readArcgisWorkbookDetailed reports for the same workbook (the mapping staleness round-trip depends on the two extraction paths never diverging)', async () => {
    // Headers deliberately stress normalization: surrounding whitespace, a blank header cell, and a
    // whitespace-only header. Both extraction paths must trim and drop blanks identically.
    const buffer = await buildWorkbook({
      TreesCustom: [
        ['GlobalID', '  TreeTag  ', '', 'Sp', 'Q', 'MyX', 'MyY', 'When'],
        ['G1', '100', 'junk', 'QURU', 'A25', '5.1', '6.2', 46036]
      ],
      StemsCustom: [
        ['GlobalID', 'ParentGlobalID', 'TreeTag', '   ', 'Sp', 'Q', 'When'],
        ['S1', 'G1', '100', 'x', 'QURU', 'A25', 46036]
      ]
    });

    const metadata = await readArcgisSheetMetadata(buffer);
    const outcome = await readArcgisWorkbookDetailed(buffer);

    // This workbook is mapping-resolvable but unreadable without one (no lx/ly aliases), so the
    // detailed read takes the !ok path that reports rawColumns per sheet — the other extraction.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(metadata).toEqual(outcome.sheets);
    }

    // Anchor the shared normalization explicitly: trimmed, blanks dropped, order preserved.
    expect(metadata).toEqual([
      { name: 'TreesCustom', columns: ['GlobalID', 'TreeTag', 'Sp', 'Q', 'MyX', 'MyY', 'When'] },
      { name: 'StemsCustom', columns: ['GlobalID', 'ParentGlobalID', 'TreeTag', 'Sp', 'Q', 'When'] }
    ]);
  });
});

describe('readArcgisWorkbook with mapping', () => {
  const mapping: ColumnMapping = {
    version: 1,
    format: SourceFormat.arcgis_xlsx,
    fields: [
      { canonicalField: 'tag', sourceColumns: ['TreeTag'], scope: 'both' },
      { canonicalField: 'spcode', sourceColumns: ['Sp'], scope: 'both' },
      { canonicalField: 'quadrat', sourceColumns: ['Q'], scope: 'both' },
      { canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'trees' },
      { canonicalField: 'ly', sourceColumns: ['MyY'], scope: 'trees' },
      { canonicalField: 'Date_measured', sourceColumns: ['When'], scope: 'both' }
    ],
    sheetRoles: { treesSheetName: 'TreesCustom', stemsSheetName: 'StemsCustom' }
  };

  it('canonicalizes custom headers and uses sheetRoles', async () => {
    const buffer = await buildWorkbook({
      TreesCustom: [CUSTOM_TREE_HEADER, ['G1', '100', '100', 'QURU', 'A25', '5.1', '6.2', 46036]],
      StemsCustom: [CUSTOM_STEM_HEADER, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]]
    });
    const wb = await readArcgisWorkbook(buffer, mapping);
    expect(wb.trees).toHaveLength(1);
    expect(Object.keys(wb.trees[0])).toEqual(expect.arrayContaining(['lx', 'ly', 'tag', 'spcode', 'quadrat', 'Date_measured']));
    expect(wb.trees[0].lx).toBe('5.1');
    expect(wb.stems).toHaveLength(1);
    expect(wb.stems[0].ParentGlobalID).toBe('G1');
  });

  it('does not let a trees-scoped override cross-claim a same-named column on the stems sheet', async () => {
    // lx is scoped 'trees' and explicitly mapped to 'MyX'. The stems sheet ALSO has a 'MyX'
    // column; the scoped-out override must not claim it there, so it passes through under its
    // raw name and the stems rows never grow a phantom lx field.
    const stemHeaderWithSharedColumn = [...CUSTOM_STEM_HEADER, 'MyX'];
    const buffer = await buildWorkbook({
      TreesCustom: [CUSTOM_TREE_HEADER, ['G1', '100', '100', 'QURU', 'A25', '5.1', '6.2', 46036]],
      StemsCustom: [stemHeaderWithSharedColumn, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036, '9.9']]
    });
    const wb = await readArcgisWorkbook(buffer, mapping);
    expect(wb.trees[0].lx).toBe('5.1');
    expect(wb.stems).toHaveLength(1);
    expect(wb.stems[0].MyX).toBe('9.9'); // raw passthrough, NOT consumed as lx
    expect(wb.stems[0].lx).toBeUndefined();
  });

  it('throws MissingSheetError when a sheetRole names a sheet that does not exist', async () => {
    const buffer = await buildWorkbook({
      TreesCustom: [CUSTOM_TREE_HEADER, ['G1', '100', '100', 'QURU', 'A25', '5.1', '6.2', 46036]],
      StemsCustom: [CUSTOM_STEM_HEADER, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]]
    });
    const badRoles: ColumnMapping = { ...mapping, sheetRoles: { treesSheetName: 'Nope', stemsSheetName: 'StemsCustom' } };
    await expect(readArcgisWorkbook(buffer, badRoles)).rejects.toThrow(MissingSheetError);
  });

  it('throws MissingColumnError when a role-selected sheet still lacks a required mapped column', async () => {
    const headerNoCoords = ['GlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'When'];
    const buffer = await buildWorkbook({
      TreesCustom: [headerNoCoords, ['G1', '100', '100', 'QURU', 'A25', 46036]],
      StemsCustom: [CUSTOM_STEM_HEADER, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]]
    });
    await expect(readArcgisWorkbook(buffer, mapping)).rejects.toThrow(MissingColumnError);
  });

  it('lets an explicitly mapped column claim its key even when an alias-named column appears earlier', async () => {
    // Leftover empty 'lx' column sits BEFORE the user-mapped 'MyX'. The explicit mapping must win:
    // lx data comes from MyX, not from the stale alias-named column.
    const headerWithLeftover = ['GlobalID', 'lx', 'TreeTag', 'StemTag', 'Sp', 'Q', 'MyX', 'MyY', 'When'];
    const buffer = await buildWorkbook({
      TreesCustom: [headerWithLeftover, ['G1', '', '100', '100', 'QURU', 'A25', '5.1', '6.2', 46036]],
      StemsCustom: [CUSTOM_STEM_HEADER, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]]
    });
    const wb = await readArcgisWorkbook(buffer, mapping);
    expect(wb.trees).toHaveLength(1);
    expect(wb.trees[0].lx).toBe('5.1');
    expect(wb.trees[0].ly).toBe('6.2');
  });

  it('still alias-resolves a field on a sheet where its mapped source column is absent', async () => {
    // The mapping sends tag <- TreeTag, but this stems sheet names the column 'tag' (an alias) and
    // has no TreeTag; alias detection must still fill the unclaimed key on that sheet.
    const stemHeaderAliasTag = ['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'Sp', 'Q', 'When'];
    const buffer = await buildWorkbook({
      TreesCustom: [CUSTOM_TREE_HEADER, ['G1', '100', '100', 'QURU', 'A25', '5.1', '6.2', 46036]],
      StemsCustom: [stemHeaderAliasTag, ['S1', 'G1', '100', '100-1', 'QURU', 'A25', 46036]]
    });
    const wb = await readArcgisWorkbook(buffer, mapping);
    expect(wb.stems).toHaveLength(1);
    expect(wb.stems[0].tag).toBe('100');
  });

  it('behaves identically to the no-mapping path when mapping is undefined', async () => {
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees, stems } = await readArcgisWorkbook(buffer, undefined);
    expect(trees).toHaveLength(1);
    expect(stems).toHaveLength(1);
  });
});
