import { describe, expect, it } from 'vitest';
import {
  formatCensusWindowDuration,
  getCensusStatus,
  getCensusWindow,
  getCensusWindowBounds,
  getMeasurementBounds,
  getMeasurementSpan,
  isCensusEndBeforeStart,
  getCensusDatesError,
  CENSUS_INVALID_DATE_MESSAGE
} from './censuswindow';
import type { CalendarDay } from './dateformats';

const TODAY: CalendarDay = { year: 2026, month: 10, day: 20 };

describe('census window vs measurement span', () => {
  it('reads the window and the measurement span from their own fields', () => {
    const range = {
      startDate: '2027-02-15T00:00:00.000Z',
      endDate: '2027-02-15T00:00:00.000Z',
      censusStartDate: '2027-01-01T00:00:00.000Z',
      censusEndDate: '2027-12-31T00:00:00.000Z',
      firstMeasurementDate: '2027-02-15T00:00:00.000Z',
      lastMeasurementDate: '2027-02-15T00:00:00.000Z'
    };
    expect(getCensusWindow(range)).toEqual({ start: range.censusStartDate, end: range.censusEndDate });
    expect(getMeasurementSpan(range)).toEqual({ first: range.firstMeasurementDate, last: range.lastMeasurementDate });
  });

  it('never presents the census window as a measurement span for an empty census', () => {
    const empty = {
      startDate: '2027-01-01T00:00:00.000Z',
      endDate: '2027-12-31T00:00:00.000Z',
      censusStartDate: '2027-01-01T00:00:00.000Z',
      censusEndDate: '2027-12-31T00:00:00.000Z',
      firstMeasurementDate: null,
      lastMeasurementDate: null
    };
    expect(getMeasurementSpan(empty)).toEqual({ first: null, last: null });
    expect(getMeasurementBounds([empty])).toEqual({ first: undefined, last: undefined });
  });

  it('treats a legacy row (no explicit fields) as window=startDate/endDate and span=startDate/endDate', () => {
    const legacy = { startDate: '2024-01-01', endDate: '2024-12-31' };
    expect(getCensusWindow(legacy)).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(getMeasurementSpan(legacy)).toEqual({ first: '2024-01-01', last: '2024-12-31' });
  });

  it('takes the earliest window start and latest window end across ranges', () => {
    const bounds = getCensusWindowBounds([
      { censusStartDate: '2027-03-01', censusEndDate: '2027-04-01' },
      { censusStartDate: '2027-01-01', censusEndDate: '2027-02-01' }
    ]);
    expect(bounds.start).toEqual({ year: 2027, month: 1, day: 1 });
    expect(bounds.end).toEqual({ year: 2027, month: 4, day: 1 });
    expect(bounds.endIsOpen).toBe(false);
  });
});

describe('getCensusStatus (census window only)', () => {
  it('is planned when there are no ranges or no window start', () => {
    expect(getCensusStatus([], TODAY)).toBe('planned');
    expect(getCensusStatus(undefined, TODAY)).toBe('planned');
    expect(getCensusStatus([{ censusStartDate: null, censusEndDate: null, firstMeasurementDate: '2026-01-01' }], TODAY)).toBe('planned');
  });

  it('is planned when the window starts in the future even if measurements exist', () => {
    expect(
      getCensusStatus(
        [{ censusStartDate: '2027-01-01', censusEndDate: '2027-12-31', firstMeasurementDate: '2026-01-05', lastMeasurementDate: '2026-01-05' }],
        TODAY
      )
    ).toBe('planned');
  });

  it('is in progress while the window is open or its end day has not passed', () => {
    expect(getCensusStatus([{ censusStartDate: '2026-01-01', censusEndDate: null }], TODAY)).toBe('in-progress');
    expect(getCensusStatus([{ censusStartDate: '2026-01-01', censusEndDate: '2026-10-20' }], TODAY)).toBe('in-progress');
  });

  it('is completed once the window end day has passed, regardless of measurement dates', () => {
    expect(
      getCensusStatus(
        [{ censusStartDate: '2026-01-01', censusEndDate: '2026-10-19', firstMeasurementDate: '2026-10-19', lastMeasurementDate: '2026-10-19' }],
        TODAY
      )
    ).toBe('completed');
  });

  it('does not call a census completed just because every measurement is in the past (census 2 regression)', () => {
    expect(
      getCensusStatus([{ censusStartDate: '2026-09-01', censusEndDate: null, firstMeasurementDate: '2026-09-02', lastMeasurementDate: '2026-09-02' }], TODAY)
    ).toBe('in-progress');
  });

  it('stays open when any range has a start but no end', () => {
    expect(
      getCensusStatus(
        [
          { censusStartDate: '2026-01-01', censusEndDate: '2026-02-01' },
          { censusStartDate: '2026-03-01', censusEndDate: null }
        ],
        TODAY
      )
    ).toBe('in-progress');
  });

  it('judges "today" as a calendar day, so a late-evening Los Angeles viewer and an early-morning Auckland viewer differ only by their own date', () => {
    const window = [{ censusStartDate: '2027-01-01', censusEndDate: '2027-01-01' }];
    expect(getCensusStatus(window, { year: 2026, month: 12, day: 31 })).toBe('planned');
    expect(getCensusStatus(window, { year: 2027, month: 1, day: 1 })).toBe('in-progress');
    expect(getCensusStatus(window, { year: 2027, month: 1, day: 2 })).toBe('completed');
  });
});

describe('formatCensusWindowDuration', () => {
  it('uses the window, not the measurement dates', () => {
    expect(
      formatCensusWindowDuration(
        [{ censusStartDate: '2026-01-01', censusEndDate: '2026-12-31', firstMeasurementDate: '2026-06-10', lastMeasurementDate: '2026-06-10' }],
        TODAY
      )
    ).toBe('11 months');
  });

  it('is null when there is no window start or the window has not started', () => {
    expect(formatCensusWindowDuration([{ censusStartDate: null }], TODAY)).toBeNull();
    expect(formatCensusWindowDuration([{ censusStartDate: '2027-01-01', censusEndDate: '2027-02-01' }], TODAY)).toBeNull();
    expect(formatCensusWindowDuration(undefined, TODAY)).toBeNull();
  });

  it('runs to today for an open window and formats days, months and years', () => {
    expect(formatCensusWindowDuration([{ censusStartDate: '2026-10-10', censusEndDate: null }], TODAY)).toBe('10 days');
    expect(formatCensusWindowDuration([{ censusStartDate: '2026-10-19', censusEndDate: null }], TODAY)).toBe('1 day');
    expect(formatCensusWindowDuration([{ censusStartDate: '2026-04-20', censusEndDate: null }], TODAY)).toBe('6 months');
    expect(formatCensusWindowDuration([{ censusStartDate: '2024-10-20', censusEndDate: null }], TODAY)).toBe('2 years');
    expect(formatCensusWindowDuration([{ censusStartDate: '2024-07-20', censusEndDate: null }], TODAY)).toBe('2y 3m');
  });
});

describe('open ranges (R5)', () => {
  const closedThenOpen = [
    { censusStartDate: '2026-01-01', censusEndDate: '2026-02-01' },
    { censusStartDate: '2026-03-01', censusEndDate: null }
  ];

  it('has no window end when a later range is open, and runs the duration to today', () => {
    const bounds = getCensusWindowBounds(closedThenOpen);
    expect(bounds.start).toEqual({ year: 2026, month: 1, day: 1 });
    expect(bounds.end).toBeUndefined();
    expect(bounds.endIsOpen).toBe(true);
    expect(getCensusStatus(closedThenOpen, TODAY)).toBe('in-progress');
    // Jan 1 -> Oct 20, not Jan 1 -> Feb 1 ("1 month").
    expect(formatCensusWindowDuration(closedThenOpen, TODAY)).toBe('9 months');
  });

  it('uses earliest start to latest end for all-closed ranges and completes after the end', () => {
    const ranges = [
      { censusStartDate: '2026-03-01', censusEndDate: '2026-04-01' },
      { censusStartDate: '2026-01-01', censusEndDate: '2026-02-01' }
    ];
    const bounds = getCensusWindowBounds(ranges);
    expect(bounds.end).toEqual({ year: 2026, month: 4, day: 1 });
    expect(getCensusStatus(ranges, TODAY)).toBe('completed');
    expect(formatCensusWindowDuration(ranges, TODAY)).toBe('3 months');
  });

  it('plans a single open range before its start and runs it after', () => {
    const open = [{ censusStartDate: '2026-11-01', censusEndDate: null }];
    expect(getCensusStatus(open, TODAY)).toBe('planned');
    expect(formatCensusWindowDuration(open, TODAY)).toBeNull();
    expect(getCensusStatus(open, { year: 2026, month: 11, day: 5 })).toBe('in-progress');
    expect(formatCensusWindowDuration(open, { year: 2026, month: 11, day: 5 })).toBe('4 days');
  });

  it('does not invent a window or measurement span for an empty census', () => {
    const empty = [{ censusStartDate: null, censusEndDate: null, firstMeasurementDate: null, lastMeasurementDate: null }];
    expect(getCensusWindowBounds(empty)).toEqual({ start: undefined, end: undefined, endIsOpen: false });
    expect(getMeasurementBounds(empty)).toEqual({ first: undefined, last: undefined });
  });
});

describe('isCensusEndBeforeStart', () => {
  it('is true only when the end day precedes the start day', () => {
    expect(isCensusEndBeforeStart('2026-03-10', '2026-03-09')).toBe(true);
    expect(isCensusEndBeforeStart('2026-03-10', '2026-03-10')).toBe(false);
    expect(isCensusEndBeforeStart('2026-03-10', '2026-03-11')).toBe(false);
  });

  it('is false when either day is missing, so an open-ended census is allowed', () => {
    expect(isCensusEndBeforeStart('2026-03-10', null)).toBe(false);
    expect(isCensusEndBeforeStart('2026-03-10', '')).toBe(false);
    expect(isCensusEndBeforeStart(null, '2026-03-10')).toBe(false);
  });

  it('reads database DATE values (UTC-midnight Dates) by calendar day in every zone', () => {
    // A persisted StartDate arrives from mysql2 as a UTC-midnight Date; the request's EndDate is a string.
    const persistedStart = new Date('2026-01-01T00:00:00.000Z');
    expect(isCensusEndBeforeStart(persistedStart, '2025-12-31')).toBe(true);
    expect(isCensusEndBeforeStart(persistedStart, '2026-01-01')).toBe(false);
  });
});

describe('getCensusDatesError', () => {
  it('accepts leap days, MySQL DATE year bounds, and an open end', () => {
    expect(getCensusDatesError('2024-02-29', null)).toBeNull();
    expect(getCensusDatesError('1000-01-01', '9999-12-31')).toBeNull();
    expect(getCensusDatesError(new Date('2024-02-29T00:00:00.000Z'), '2024-03-01')).toBeNull();
  });

  it('rejects invalid calendar days and Date objects instead of treating them as absent', () => {
    expect(getCensusDatesError('2023-02-29', null)).toBe(CENSUS_INVALID_DATE_MESSAGE);
    expect(getCensusDatesError('2024-02-29', new Date(Number.NaN))).toBe(CENSUS_INVALID_DATE_MESSAGE);
  });
});
