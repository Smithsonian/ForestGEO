import { describe, expect, it } from 'vitest';
import { ChangelogOperation } from '@/lib/changelog/record-mutation';
import { BULK_REVISION_SUMMARY_KIND, projectEditOperationToChangelogRows, type ProjectedChangelogRow } from './edit-operation-projection';
import type { EditOperationStateRow } from '@/config/editoperations';

const EDIT_OPERATION_ID = 42;
const TABLE_NAME = 'coremeasurements';
const PRIMARY_KEY = 'CoreMeasurementID';

function stateRow(overrides: Partial<EditOperationStateRow> = {}): EditOperationStateRow {
  return {
    table: TABLE_NAME,
    primaryKey: PRIMARY_KEY,
    primaryKeyValue: 1,
    row: { MeasuredDBH: 10 },
    ...overrides
  };
}

function findRowFor(rows: ProjectedChangelogRow[], primaryKeyValue: string | number): ProjectedChangelogRow {
  const match = rows.find(row => row.recordID === `${primaryKeyValue}::edit-op-${EDIT_OPERATION_ID}`);
  if (!match) {
    throw new Error(`No projected row found for primaryKeyValue=${primaryKeyValue} among recordIDs [${rows.map(r => r.recordID).join(', ')}]`);
  }
  return match;
}

describe('projectEditOperationToChangelogRows: single-row-edit / revert', () => {
  it('projects an after-only key as INSERT carrying the real afterState row and no oldRowState', () => {
    const after = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tableName: TABLE_NAME,
      recordID: `1::edit-op-${EDIT_OPERATION_ID}`,
      operation: ChangelogOperation.INSERT,
      oldRowState: null,
      newRowState: { MeasuredDBH: 10 }
    });
  });

  it('projects a before-only key as DELETE carrying the real beforeState row and no newRowState', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tableName: TABLE_NAME,
      recordID: `1::edit-op-${EDIT_OPERATION_ID}`,
      operation: ChangelogOperation.DELETE,
      oldRowState: { MeasuredDBH: 10 },
      newRowState: null
    });
  });

  it('projects a before/after key with an actual field difference as UPDATE carrying both real snapshots', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } });
    const after = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 12 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tableName: TABLE_NAME,
      recordID: `1::edit-op-${EDIT_OPERATION_ID}`,
      operation: ChangelogOperation.UPDATE,
      oldRowState: { MeasuredDBH: 10 },
      newRowState: { MeasuredDBH: 12 }
    });
  });

  it('emits no event when before/after snapshots are value-identical regardless of JSON key order', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10, Description: 'ok' } });
    // Same values, keys written in the opposite order — a different SELECT
    // statement or a different MySQL driver version can legitimately produce
    // this; it must not be treated as a real edit.
    const after = stateRow({ primaryKeyValue: 1, row: { Description: 'ok', MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toEqual([]);
  });

  it('emits no event when before/after snapshots are identical with nested object fields in different key order', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10, meta: { a: 1, b: 2 } } });
    const after = stateRow({ primaryKeyValue: 1, row: { meta: { b: 2, a: 1 }, MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toEqual([]);
  });

  it('still emits UPDATE when key order differs AND a nested value actually differs', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10, meta: { a: 1, b: 2 } } });
    const after = stateRow({ primaryKeyValue: 1, row: { meta: { b: 2, a: 999 }, MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe(ChangelogOperation.UPDATE);
  });

  it('emits an UPDATE for a key whose only change is a Date-valued field, instead of collapsing two distinct Dates to the same {} and treating it as a no-op', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasurementDate: new Date('2026-01-01T00:00:00.000Z') } });
    const after = stateRow({ primaryKeyValue: 1, row: { MeasurementDate: new Date('2026-06-01T00:00:00.000Z') } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe(ChangelogOperation.UPDATE);
  });

  it('emits no event when the only field is a Date and both sides hold the identical instant, even as distinct Date instances', () => {
    const sameInstant = '2026-03-15T12:00:00.000Z';
    const before = stateRow({ primaryKeyValue: 1, row: { MeasurementDate: new Date(sameInstant) } });
    const after = stateRow({ primaryKeyValue: 1, row: { MeasurementDate: new Date(sameInstant) } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toEqual([]);
  });

  it('emits no event when a Buffer-valued field is byte-identical on both sides, matching JSON.stringify(Buffer) toJSON semantics', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { RawBytes: Buffer.from('same-bytes') } });
    const after = stateRow({ primaryKeyValue: 1, row: { RawBytes: Buffer.from('same-bytes') } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toEqual([]);
  });

  it('emits an UPDATE when a Buffer-valued field actually differs', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { RawBytes: Buffer.from('before-bytes') } });
    const after = stateRow({ primaryKeyValue: 1, row: { RawBytes: Buffer.from('after-bytes-x') } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe(ChangelogOperation.UPDATE);
  });

  it('emits no event for a key present in both BeforeState and AfterState with row === null on both sides', () => {
    const before = stateRow({ primaryKeyValue: 1, row: null });
    const after = stateRow({ primaryKeyValue: 1, row: null });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toEqual([]);
  });

  it('never fabricates an oldRowState for an INSERT nor a newRowState for a DELETE', () => {
    const after = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } });
    const before = stateRow({ primaryKeyValue: 2, row: { MeasuredDBH: 20 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [before], [after]);

    const insertRow = findRowFor(rows, 1);
    const deleteRow = findRowFor(rows, 2);
    expect(insertRow.operation).toBe(ChangelogOperation.INSERT);
    expect(insertRow.oldRowState).toBeNull();
    expect(deleteRow.operation).toBe(ChangelogOperation.DELETE);
    expect(deleteRow.newRowState).toBeNull();
  });

  it('projects the cmattributes replace-by-delete-and-reinsert pattern as one DELETE and one INSERT, not a dropped or fabricated UPDATE', () => {
    // Same logical attribute slot reused under two different CMAIDs: the old
    // CMAID is deleted, a new CMAID is inserted. Two distinct primary key
    // values -> two distinct keys -> both rows must survive the projection.
    const before = [stateRow({ table: 'cmattributes', primaryKey: 'CMAID', primaryKeyValue: 500, row: { Code: 'DEAD' } })];
    const after = [stateRow({ table: 'cmattributes', primaryKey: 'CMAID', primaryKeyValue: 501, row: { Code: 'ALIVE' } })];

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, before, after);

    expect(rows).toHaveLength(2);
    const deleteRow = findRowFor(rows, 500);
    const insertRow = findRowFor(rows, 501);
    expect(deleteRow).toMatchObject({ operation: ChangelogOperation.DELETE, oldRowState: { Code: 'DEAD' }, newRowState: null });
    expect(insertRow).toMatchObject({ operation: ChangelogOperation.INSERT, oldRowState: null, newRowState: { Code: 'ALIVE' } });
  });

  it("excludes a species_correction_metadata marker row present on both sides, while still projecting the correction's real trees mutation", () => {
    const metadataBefore = stateRow({
      table: 'species_correction_metadata',
      primaryKey: 'TreeID',
      primaryKeyValue: 55,
      row: { version: 1, operation: 'tree-species-correction', speciesID: 10 }
    });
    const metadataAfter = stateRow({
      table: 'species_correction_metadata',
      primaryKey: 'TreeID',
      primaryKeyValue: 55,
      row: { version: 1, operation: 'tree-species-correction', speciesID: 20 }
    });
    const treesBefore = stateRow({ table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 55, row: { SpeciesID: 10 } });
    const treesAfter = stateRow({ table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 55, row: { SpeciesID: 20 } });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [metadataBefore, treesBefore], [metadataAfter, treesAfter]);

    expect(rows).toHaveLength(1);
    expect(rows[0].tableName).toBe('trees');
    expect(rows.some(row => row.tableName === 'species_correction_metadata')).toBe(false);
  });

  it('excludes a species_correction_metadata marker row even when it is the ONLY state row on either side', () => {
    const metadataOnly = stateRow({
      table: 'species_correction_metadata',
      primaryKey: 'TreeID',
      primaryKeyValue: 77,
      row: { version: 1, operation: 'tree-species-correction', speciesID: 99 }
    });

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, [], [metadataOnly]);

    expect(rows).toEqual([]);
  });

  it('preserves first-seen key order across mixed INSERT/UPDATE/DELETE/no-op keys in one ledger entry', () => {
    const before: EditOperationStateRow[] = [
      stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } }), // unchanged -> no-op
      stateRow({ primaryKeyValue: 2, row: { MeasuredDBH: 20 } }) // deleted
    ];
    const after: EditOperationStateRow[] = [
      stateRow({ primaryKeyValue: 3, row: { MeasuredDBH: 30 } }), // inserted
      stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } }) // unchanged -> no-op
    ];

    const rows = projectEditOperationToChangelogRows('single-row-edit', EDIT_OPERATION_ID, before, after);

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.recordID)).toEqual([`2::edit-op-${EDIT_OPERATION_ID}`, `3::edit-op-${EDIT_OPERATION_ID}`]);
  });

  it('applies the identical pairing/no-op logic to revert entries', () => {
    const before = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 12 } });
    const after = stateRow({ primaryKeyValue: 1, row: { MeasuredDBH: 10 } });

    const rows = projectEditOperationToChangelogRows('revert', EDIT_OPERATION_ID, [before], [after]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: ChangelogOperation.UPDATE, oldRowState: { MeasuredDBH: 12 }, newRowState: { MeasuredDBH: 10 } });
  });
});

describe('projectEditOperationToChangelogRows: bulk-revision-row', () => {
  it('projects exactly one UPDATE row carrying the real BeforeState[0] summary tagged with the summaryKind marker', () => {
    const summary = stateRow({
      table: 'bulk-revision-apply',
      primaryKey: 'bulkPlanHash',
      primaryKeyValue: 'hash-abc',
      row: { updatedCount: 3, skippedCount: 1, insertedCount: 0, deletedDuplicateCount: 2 }
    });

    const rows = projectEditOperationToChangelogRows('bulk-revision-row', EDIT_OPERATION_ID, [summary], []);

    expect(rows).toEqual([
      {
        tableName: 'bulk-revision-apply',
        recordID: `hash-abc::edit-op-${EDIT_OPERATION_ID}`,
        operation: ChangelogOperation.UPDATE,
        oldRowState: null,
        newRowState: { updatedCount: 3, skippedCount: 1, insertedCount: 0, deletedDuplicateCount: 2, summaryKind: BULK_REVISION_SUMMARY_KIND }
      }
    ]);
  });

  it('never invents a summary row count beyond what BeforeState[0] actually carried', () => {
    const summary = stateRow({ primaryKeyValue: 'hash-xyz', row: { updatedCount: 7 } });

    const rows = projectEditOperationToChangelogRows('bulk-revision-row', EDIT_OPERATION_ID, [summary], []);

    expect(rows[0].newRowState).toEqual({ updatedCount: 7, summaryKind: BULK_REVISION_SUMMARY_KIND });
    expect(rows[0].newRowState).not.toHaveProperty('skippedCount');
  });

  it('ignores AfterState entirely — a bulk ledger entry never carries per-row after snapshots', () => {
    const summary = stateRow({ primaryKeyValue: 'hash-abc', row: { updatedCount: 1 } });
    const spuriousAfter = stateRow({ primaryKeyValue: 'should-not-matter', row: { updatedCount: 999 } });

    const rows = projectEditOperationToChangelogRows('bulk-revision-row', EDIT_OPERATION_ID, [summary], [spuriousAfter]);

    expect(rows).toHaveLength(1);
    expect(rows[0].recordID).toBe(`hash-abc::edit-op-${EDIT_OPERATION_ID}`);
  });

  it('emits nothing when BeforeState is empty (no summary captured)', () => {
    const rows = projectEditOperationToChangelogRows('bulk-revision-row', EDIT_OPERATION_ID, [], []);
    expect(rows).toEqual([]);
  });

  it('emits nothing when BeforeState[0].row is explicitly null', () => {
    const summary = stateRow({ primaryKeyValue: 'hash-abc', row: null });
    const rows = projectEditOperationToChangelogRows('bulk-revision-row', EDIT_OPERATION_ID, [summary], []);
    expect(rows).toEqual([]);
  });
});
