import { describe, expect, it, vi } from 'vitest';
import { findDroppedMeasurementCandidates, isUnsignedIntFieldInvalid, MYSQL_UNSIGNED_INT_MAX, parseUnsignedIntField } from './temporary-measurements';
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { FileRow } from '@/config/macros/formdetails';

describe('parseUnsignedIntField', () => {
  it('parses positive integers within the MySQL unsigned range', () => {
    expect(parseUnsignedIntField(5001)).toBe(5001);
    expect(parseUnsignedIntField('5001')).toBe(5001);
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX)).toBe(MYSQL_UNSIGNED_INT_MAX);
  });

  it('returns null for absent or blank values', () => {
    expect(parseUnsignedIntField(undefined)).toBeNull();
    expect(parseUnsignedIntField(null)).toBeNull();
    expect(parseUnsignedIntField('')).toBeNull();
    expect(parseUnsignedIntField('   ')).toBeNull();
  });

  it('returns null for present-but-invalid values', () => {
    expect(parseUnsignedIntField('5,001')).toBeNull();
    expect(parseUnsignedIntField('STEM-5001')).toBeNull();
    expect(parseUnsignedIntField('5001x')).toBeNull();
    expect(parseUnsignedIntField(0)).toBeNull();
    expect(parseUnsignedIntField(-1)).toBeNull();
    expect(parseUnsignedIntField(12.3)).toBeNull();
    expect(parseUnsignedIntField(MYSQL_UNSIGNED_INT_MAX + 1)).toBeNull();
  });
});

describe('findDroppedMeasurementCandidates placeholder alignment', () => {
  const TEST_SCHEMA = 'forestgeo_testing';
  const TEST_FILE_NAME = 'SERC_census1_2025.csv';
  const TEST_BATCH_ID = 'batch-7';
  const TEST_PLOT_ID = 22;
  const TEST_CENSUS_ID = 32;
  const TEST_TRANSACTION_ID = 'tx-test';

  it('fills every ?? with the backticked schema and keeps value params aligned to the remaining ? slots', async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const connectionManager = { executeQuery } as unknown as ConnectionManager;

    await findDroppedMeasurementCandidates(
      connectionManager,
      TEST_SCHEMA,
      TEST_FILE_NAME,
      TEST_BATCH_ID,
      TEST_PLOT_ID,
      TEST_CENSUS_ID,
      [{ tag: '100001', stemtag: '1', spcode: 'FAGR', quadrat: '1011', date: '2010-03-17' }] as FileRow[],
      TEST_TRANSACTION_ID
    );

    const droppedRowCall = executeQuery.mock.calls.find(call => String(call[0]).includes('MIN(dup.BatchID)'));
    expect(droppedRowCall, 'dropped-row audit query was never executed').toBeDefined();
    const [sql, params] = droppedRowCall!;

    // Regression guard for the mysql2 format() misfill this query shipped with:
    // format(sql, [schema, schema]) fills placeholders strictly in order, so the
    // second schema landed in the `tm.FileID = ?` value slot and the second ??
    // was later misfilled by a value param and treated as a database name.
    // safeFormatQuery must consume EVERY ?? so executeQuery sees only value slots.
    expect(sql).not.toContain('??');
    expect(String(sql).match(/`forestgeo_testing`\.temporarymeasurements/g)).toHaveLength(2);

    expect(String(sql).match(/\?/g)).toHaveLength(params.length);
    expect(params).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_FILE_NAME, TEST_PLOT_ID, TEST_CENSUS_ID]);
    expect(params).not.toContain(TEST_SCHEMA);

    const slotOrder = ['tm.FileID = ?', 'tm.BatchID = ?', 'dup.FileID = ?', 'dup.PlotID = ?', 'dup.CensusID = ?'];
    const slotPositions = slotOrder.map(slot => String(sql).indexOf(slot));
    slotPositions.forEach((position, index) => expect(position, `missing value slot ${slotOrder[index]}`).toBeGreaterThan(-1));
    expect(slotPositions, 'value slots appear in a different order than the params array').toEqual([...slotPositions].sort((a, b) => a - b));
  });
});

describe('isUnsignedIntFieldInvalid', () => {
  it('is false for absent/blank values (a missing PublishedStemID is legitimately optional)', () => {
    expect(isUnsignedIntFieldInvalid(undefined)).toBe(false);
    expect(isUnsignedIntFieldInvalid(null)).toBe(false);
    expect(isUnsignedIntFieldInvalid('')).toBe(false);
    expect(isUnsignedIntFieldInvalid('   ')).toBe(false);
  });

  it('is false for values that parse to a valid unsigned int', () => {
    expect(isUnsignedIntFieldInvalid(5001)).toBe(false);
    expect(isUnsignedIntFieldInvalid('5001')).toBe(false);
  });

  it('is true only for present values that cannot be stored as an unsigned int', () => {
    // These are exactly the cases that were previously coerced to NULL and ingested silently.
    expect(isUnsignedIntFieldInvalid('5,001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('STEM-5001')).toBe(true);
    expect(isUnsignedIntFieldInvalid('5001x')).toBe(true);
    expect(isUnsignedIntFieldInvalid(0)).toBe(true);
    expect(isUnsignedIntFieldInvalid(-1)).toBe(true);
    expect(isUnsignedIntFieldInvalid(12.3)).toBe(true);
  });
});
