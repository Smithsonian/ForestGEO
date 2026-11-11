import { describe, expect, it, vi } from 'vitest';
import {
  formatMeasurementDateCell,
  formatMeasurementDateForCsv,
  measurementDateToSaveString,
  measurementDateValueGetter,
  measurementDateValueSetter
} from './measurementdatecolumn';
import { buildEditableFieldsDiffWithMetaForSurface, runMeasurementEditSave } from './measurementscommonsutils';
import { normalizeFieldValue } from '@/config/editplan/fieldpolicy';

// Run under TZ=UTC, TZ=America/Los_Angeles and TZ=Pacific/Auckland. A "picker" Date is built with
// the local-time constructor, exactly like the MUI date editor produces, so the assertions hold in
// whichever zone the process runs in. Nothing mutates process.env.TZ.
const DB_DATE = new Date('2027-02-15T00:00:00.000Z'); // what mysql2 / parseDate yields for DATE 2027-02-15
const pick = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('measurementDate column boundary', () => {
  it('gives the editor the stored calendar day (no -1 day west of UTC)', () => {
    for (const stored of [DB_DATE, '2027-02-15T00:00:00.000Z', '2027-02-15']) {
      const editorValue = measurementDateValueGetter(stored)!;
      expect([editorValue.getFullYear(), editorValue.getMonth() + 1, editorValue.getDate()]).toEqual([2027, 2, 15]);
    }
  });

  it('displays the stored day, not the browser-zone day', () => {
    expect(formatMeasurementDateCell(measurementDateValueGetter(DB_DATE))).toBe('2027-02-15');
    expect(formatMeasurementDateCell('2027-02-15T00:00:00.000Z')).toBe('2027-02-15');
    expect(formatMeasurementDateCell(null)).toBe('');
    expect(formatMeasurementDateCell('garbage')).toBe('');
    expect(formatMeasurementDateCell(new Date(Number.NaN))).toBe('');
  });

  it('stores a picked day as UTC midnight of that day (no +1 day east of UTC)', () => {
    const row = measurementDateValueSetter(pick(2027, 2, 16), { coreMeasurementID: 1, measurementDate: DB_DATE });
    expect((row.measurementDate as Date).toISOString()).toBe('2027-02-16T00:00:00.000Z');
    expect(row.coreMeasurementID).toBe(1);
  });

  it('stores null for a cleared or invalid editor value', () => {
    expect(measurementDateValueSetter(null, { measurementDate: DB_DATE }).measurementDate).toBeNull();
    expect(measurementDateValueSetter(new Date(Number.NaN), { measurementDate: DB_DATE }).measurementDate).toBeNull();
  });

  it('round-trips an untouched value to an identical Date', () => {
    const roundTripped = measurementDateValueSetter(measurementDateValueGetter(DB_DATE), { measurementDate: DB_DATE }).measurementDate as Date;
    expect(roundTripped.getTime()).toBe(DB_DATE.getTime());
  });
});

describe('CSV export and new-row save', () => {
  it('exports the stored calendar day', () => {
    expect(formatMeasurementDateForCsv('2027-02-15T00:00:00.000Z')).toBe('2027-02-15');
    expect(formatMeasurementDateForCsv(DB_DATE)).toBe('2027-02-15');
    expect(formatMeasurementDateForCsv('2027-01-01T00:00:00.000Z')).toBe('2027-01-01');
  });

  it('exports NULL for missing or invalid dates', () => {
    for (const bad of [null, undefined, '', 'nope']) expect(formatMeasurementDateForCsv(bad)).toBe('NULL');
  });

  it('posts a new row date as the picked day from either row shape', () => {
    const picked = measurementDateValueSetter(pick(2027, 2, 15), { measurementDate: null as Date | null }).measurementDate;
    expect(measurementDateToSaveString(picked)).toBe('2027-02-15');
    expect(measurementDateToSaveString('2027-02-15T00:00:00.000Z')).toBe('2027-02-15');
    expect(measurementDateToSaveString('2027-02-15')).toBe('2027-02-15');
    expect(measurementDateToSaveString(null)).toBeUndefined();
    expect(measurementDateToSaveString('bad')).toBeUndefined();
  });
});

describe('edit save diff for MeasurementDate', () => {
  const oldRow = { coreMeasurementID: 7, measurementDate: DB_DATE, measuredDBH: 12.5 };

  it('reports no change when the date is untouched but passed through the editor', () => {
    const newRow = measurementDateValueSetter(measurementDateValueGetter(oldRow.measurementDate), { ...oldRow });
    expect(buildEditableFieldsDiffWithMetaForSurface(newRow, oldRow, 'measurementssummary').diff).toEqual({});
  });

  it('reports no change when the stored value is an ISO string and the editor returns the same day', () => {
    const stringOld = { ...oldRow, measurementDate: '2027-02-15T00:00:00.000Z' };
    const newRow = measurementDateValueSetter(measurementDateValueGetter(stringOld.measurementDate), { ...stringOld });
    expect(buildEditableFieldsDiffWithMetaForSurface(newRow, stringOld, 'measurementssummary').diff).toEqual({});
  });

  it('sends the picked day to the edit plan and the server reads that same day', async () => {
    const newRow = measurementDateValueSetter(pick(2027, 2, 16), { ...oldRow });
    const beginEdit = vi.fn(async () => ({ editOperationID: 5 }) as never);
    await runMeasurementEditSave({ coreMeasurementID: 7, newRow, oldRow, beginEdit, notify: vi.fn(), onEditOperation: vi.fn() });

    expect(beginEdit).toHaveBeenCalledTimes(1);
    const diff = (beginEdit.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(Object.keys(diff)).toEqual(['MeasurementDate']);
    // Server side: the in-memory Date and its JSON form both normalize to the picked day.
    expect(normalizeFieldValue('MeasurementDate', diff.MeasurementDate)).toBe('2027-02-16');
    expect(normalizeFieldValue('MeasurementDate', JSON.parse(JSON.stringify(diff)).MeasurementDate)).toBe('2027-02-16');
  });

  it('does not call the edit plan at all for an untouched date', async () => {
    const newRow = measurementDateValueSetter(measurementDateValueGetter(oldRow.measurementDate), { ...oldRow });
    const beginEdit = vi.fn();
    await runMeasurementEditSave({ coreMeasurementID: 7, newRow, oldRow, beginEdit: beginEdit as never, notify: vi.fn(), onEditOperation: vi.fn() });
    expect(beginEdit).not.toHaveBeenCalled();
  });
});
