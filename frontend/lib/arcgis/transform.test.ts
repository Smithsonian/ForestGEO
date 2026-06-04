import { describe, it, expect } from 'vitest';
import { transformArcgisWorkbook } from './transform';
import { UnparseableDateError } from './errors';
import type { ArcgisRow } from './types';

function tree(over: Partial<ArcgisRow> = {}): ArcgisRow {
  return {
    GlobalID: 'G1',
    quadrat: 'A25',
    tag: '100',
    StemTag: '100',
    spcode: 'QURU',
    DBH_CURRENT: '12.3',
    HOM: '1.3',
    notes: 'fine',
    Date_measured: 46036,
    lx: '5.1',
    ly: '6.2',
    COD_M: 'M',
    COD_P: 'NA',
    ...over
  };
}
function stem(over: Partial<ArcgisRow> = {}): ArcgisRow {
  return {
    ParentGlobalID: 'G1',
    GlobalID: 'S1',
    quadrat: 'A25',
    tag: '100',
    StemTag: '100-2',
    spcode: 'QURU',
    DBH_CURRENT: '4.4',
    HOM: '1.3',
    notes: '',
    Date_measured: 46036,
    COD_A: 'A',
    COD_I: 'NA',
    ...over
  };
}

describe('transformArcgisWorkbook', () => {
  it('emits one canonical row per tree with lx/ly passed through verbatim', () => {
    const { rows, summary } = transformArcgisWorkbook({ trees: [tree()], stems: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tag: '100',
      stemtag: '100',
      spcode: 'QURU',
      quadrat: 'A25',
      lx: '5.1',
      ly: '6.2',
      dbh: '12.3',
      hom: '1.3',
      comments: 'fine'
    });
    expect(rows[0].date).toBe('2026-01-14');
    expect(rows[0].codes).toBe('M');
    expect(summary.treesTransformed).toBe(1);
    expect(summary.totalRows).toBe(1);
  });

  it('joins multiple codes in column order and yields empty string when all NA', () => {
    const { rows } = transformArcgisWorkbook({ trees: [tree({ COD_M: 'M', COD_P: 'P' })], stems: [] });
    expect(rows[0].codes).toBe('M;P');
    const allNa = transformArcgisWorkbook({ trees: [tree({ COD_M: 'NA', COD_P: 'NA' })], stems: [] });
    expect(allNa.rows[0].codes).toBe('');
  });

  it('inherits parent lx/ly/quadrat onto stem rows and lets the parent tag win', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', tag: '100', lx: '5.1', ly: '6.2', quadrat: 'A25' })],
      stems: [stem({ ParentGlobalID: 'G1', tag: '999', StemTag: '100-2' })]
    });
    const stemRow = rows.find(r => r.stemtag === '100-2')!;
    expect(stemRow.tag).toBe('100');
    expect(stemRow.lx).toBe('5.1');
    expect(stemRow.ly).toBe('6.2');
    expect(stemRow.quadrat).toBe('A25');
    expect(warnings.some(w => w.type === 'TAG_MISMATCH' && w.globalId === 'S1')).toBe(true);
    expect(summary.stemsJoined).toBe(1);
    expect(summary.tagMismatchCount).toBe(1);
  });

  it('drops orphan stems and reports them', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1' })],
      stems: [stem({ ParentGlobalID: 'GHOST', GlobalID: 'S9' })]
    });
    expect(rows).toHaveLength(1);
    expect(warnings.some(w => w.type === 'ORPHAN_STEM' && w.globalId === 'S9')).toBe(true);
    expect(summary.orphanStemsDropped).toBe(1);
    expect(summary.stemsJoined).toBe(0);
  });

  it('passes a blank quadrat through as null and flags it', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({ trees: [tree({ quadrat: null })], stems: [] });
    expect(rows[0].quadrat).toBeNull();
    expect(warnings.some(w => w.type === 'BLANK_QUADRAT' && w.globalId === 'G1')).toBe(true);
    expect(summary.blankQuadratCount).toBe(1);
  });

  it('sets a blank Date_measured to null but propagates a bad non-blank date', () => {
    const blank = transformArcgisWorkbook({ trees: [tree({ Date_measured: null })], stems: [] });
    expect(blank.rows[0].date).toBeNull();
    expect(() => transformArcgisWorkbook({ trees: [tree({ Date_measured: 'garbage' })], stems: [] })).toThrow(UnparseableDateError);
  });
});
