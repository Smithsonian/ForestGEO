import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readArcgisWorkbook } from './workbook-reader';
import { transformArcgisWorkbook } from './transform';
import { MissingSheetError, MissingColumnError } from './errors';

function buildWorkbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M', 'COD_P'];
const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A', 'COD_I'];

describe('readArcgisWorkbook', () => {
  it('splits trees and stems by column signature regardless of sheet names', () => {
    const buffer = buildWorkbook({
      CooksBranch_trees_2026: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      CooksBranch_stems_2026: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    const { trees, stems } = readArcgisWorkbook(buffer);

    expect(trees).toHaveLength(1);
    expect(stems).toHaveLength(1);
    expect(trees[0].GlobalID).toBe('G1');
    expect(trees[0].lx).toBe('5.1');
    expect(trees[0].Date_measured).toBe(46036);
    expect(stems[0].ParentGlobalID).toBe('G1');
  });

  it('treats empty cells as null', () => {
    const buffer = buildWorkbook({
      trees: [TREE_HEADER, ['G1', '', '100', '100', 'QURU', '12.3', '1.3', '', 46036, '5.1', '6.2', '', '']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    const { trees } = readArcgisWorkbook(buffer);
    expect(trees[0].quadrat).toBeNull();
    expect(trees[0].notes).toBeNull();
  });

  it('throws MissingSheetError when no stems sheet exists', () => {
    const buffer = buildWorkbook({ trees: [TREE_HEADER, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', '', 46036, '5.1', '6.2', 'M', '']] });
    expect(() => readArcgisWorkbook(buffer)).toThrow(MissingSheetError);
  });

  it('accepts capitalized Lx/Ly aliases and resolves them through the transform', () => {
    const TREE_HEADER_CAPS = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'Lx', 'Ly', 'COD_M', 'COD_P'];
    const buffer = buildWorkbook({
      trees: [TREE_HEADER_CAPS, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', 'ok', 46036, '5.1', '6.2', 'M', 'NA']],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', '100-2', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });

    const workbook = readArcgisWorkbook(buffer);
    expect(workbook.trees).toHaveLength(1);
    expect(workbook.trees[0].Lx).toBe('5.1');

    const { rows } = transformArcgisWorkbook(workbook);
    expect(rows[0].lx).toBe('5.1');
    expect(rows[0].ly).toBe('6.2');
  });

  it('throws MissingColumnError when the trees sheet lacks lx/ly', () => {
    const headerNoCoords = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured'];
    const buffer = buildWorkbook({
      trees: [headerNoCoords, ['G1', 'A25', '100', '100', 'QURU', '12.3', '1.3', '', 46036]],
      stems: [STEM_HEADER, ['G1', 'S1', 'A25', '100', 'QURU', '4.4', '1.3', '', 46036, 'A', 'NA']]
    });
    expect(() => readArcgisWorkbook(buffer)).toThrow(MissingColumnError);
  });
});
