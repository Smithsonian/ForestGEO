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

  it('resolves a lowercase cod_ code column into codes (case-insensitive code matching)', () => {
    const { rows } = transformArcgisWorkbook({ trees: [tree({ COD_M: 'NA', cod_m: 'M', COD_P: 'NA' })], stems: [] });
    expect(rows[0].codes).toBe('M');
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

  it('emits orphan stems with their own tag/quadrat and null coordinates instead of dropping them', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1' })],
      stems: [stem({ ParentGlobalID: 'GHOST', GlobalID: 'S9', tag: '777', quadrat: 'B12', StemTag: '777-1' })]
    });
    // one tree row + the emitted orphan stem row
    expect(rows).toHaveLength(2);
    const orphanRow = rows.find(r => r.stemtag === '777-1')!;
    expect(orphanRow.tag).toBe('777');
    expect(orphanRow.quadrat).toBe('B12');
    expect(orphanRow.lx).toBeNull();
    expect(orphanRow.ly).toBeNull();
    expect(warnings.some(w => w.type === 'ORPHAN_STEM' && w.globalId === 'S9' && w.value === 'GHOST')).toBe(true);
    expect(summary.orphanStemsEmitted).toBe(1);
    expect(summary.stemsJoined).toBe(0);
    // orphan has null lx/ly, so the missing-required preview should flag both coordinates
    const orphanMissing = warnings.filter(w => w.type === 'MISSING_REQUIRED' && w.sheet === 'stems' && w.globalId === 'S9').map(w => w.value);
    expect(orphanMissing.sort()).toEqual(['lx', 'ly']);
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

  it('tags every warning with its source sheet and row index', () => {
    const { warnings } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', quadrat: null })],
      stems: [stem({ ParentGlobalID: 'G1', GlobalID: 'S1', tag: '999' })]
    });
    const blank = warnings.find(w => w.type === 'BLANK_QUADRAT')!;
    expect(blank.sheet).toBe('trees');
    expect(blank.rowIndex).toBe(0);
    const mismatch = warnings.find(w => w.type === 'TAG_MISMATCH')!;
    expect(mismatch.sheet).toBe('stems');
    expect(mismatch.rowIndex).toBe(0);
    expect(mismatch.value).toBe('999');
  });

  it('reports duplicate tree tags for the second and later occurrences but still emits all rows', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', tag: '100' }), tree({ GlobalID: 'G2', tag: '100' })],
      stems: []
    });
    expect(rows).toHaveLength(2);
    const dups = warnings.filter(w => w.type === 'DUPLICATE_TREE_TAG');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ sheet: 'trees', rowIndex: 1, value: '100', globalId: 'G2' });
    expect(summary.duplicateTreeTags).toBe(1);
  });

  it('reports duplicate GlobalIDs and keeps the first occurrence for joins', () => {
    const { warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', tag: '100' }), tree({ GlobalID: 'G1', tag: '200' })],
      stems: []
    });
    const dups = warnings.filter(w => w.type === 'DUPLICATE_GLOBAL_ID');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ sheet: 'trees', rowIndex: 1, value: 'G1', globalId: 'G1' });
    expect(summary.duplicateGlobalIds).toBe(1);
  });

  it('flags a blank required tag and spcode on a tree but still emits the row', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({ trees: [tree({ GlobalID: 'G1', tag: null, spcode: null })], stems: [] });
    expect(rows).toHaveLength(1);
    const missing = warnings.filter(w => w.type === 'MISSING_REQUIRED');
    expect(missing.map(w => w.value).sort()).toEqual(['spcode', 'tag']);
    missing.forEach(w => expect(w).toMatchObject({ sheet: 'trees', rowIndex: 0, globalId: 'G1' }));
    expect(summary.missingRequired).toBe(2);
  });

  it('flags blank lx/ly/date on a tree as missing-required but still emits the row', () => {
    const { rows, warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', lx: null, ly: null, Date_measured: null })],
      stems: []
    });
    expect(rows).toHaveLength(1);
    const missing = warnings.filter(w => w.type === 'MISSING_REQUIRED');
    expect(missing.map(w => w.value).sort()).toEqual(['date', 'lx', 'ly']);
    missing.forEach(w => expect(w).toMatchObject({ sheet: 'trees', rowIndex: 0, globalId: 'G1' }));
    expect(summary.missingRequired).toBe(3);
  });

  it('does not fold a blank quadrat into missing-required (covered only by BLANK_QUADRAT)', () => {
    const { warnings, summary } = transformArcgisWorkbook({ trees: [tree({ GlobalID: 'G1', quadrat: null })], stems: [] });
    expect(warnings.some(w => w.type === 'BLANK_QUADRAT')).toBe(true);
    expect(warnings.some(w => w.type === 'MISSING_REQUIRED' && w.value === 'quadrat')).toBe(false);
    expect(summary.missingRequired).toBe(0);
  });

  it('flags a blank required spcode on a stem but does not flag an inherited blank stem tag', () => {
    const { warnings, summary } = transformArcgisWorkbook({
      trees: [tree({ GlobalID: 'G1', tag: '100' })],
      stems: [stem({ ParentGlobalID: 'G1', GlobalID: 'S1', tag: null, spcode: null })]
    });
    const missing = warnings.filter(w => w.type === 'MISSING_REQUIRED');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ sheet: 'stems', rowIndex: 0, value: 'spcode', globalId: 'S1' });
    expect(summary.missingRequired).toBe(1);
  });
});
