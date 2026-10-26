import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CensusesOverview from './censusesoverview';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

vi.mock('@/components/loading', () => ({
  ContentSkeleton: () => <div data-testid="skeleton" />
}));

// Date-only values arrive as ISO strings at UTC midnight (mysql2 pool timezone 'Z').
// They are cast because the declared type is Date, but JSON delivers strings.
const day = (iso: string) => iso as unknown as Date;

function census(plotCensusNumber: number, ranges: Record<string, unknown>): OrgCensusRDS {
  return {
    plotID: 1,
    plotCensusNumber,
    censusIDs: [plotCensusNumber],
    dateRanges: [{ censusID: plotCensusNumber, ...ranges }],
    description: ''
  } as OrgCensusRDS;
}

// Assertions hold in every browser zone; run the file under TZ=UTC, TZ=America/Los_Angeles and
// TZ=Pacific/Auckland. Nothing mutates process.env.TZ.
describe('CensusesOverview date handling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Noon UTC on 2026-10-20: the same calendar day in every zone from LA to Auckland.
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a census window starting 2027-01-01 as January, not December', () => {
    render(
      <CensusesOverview
        censuses={[
          census(1, {
            startDate: day('2027-01-01T00:00:00.000Z'),
            endDate: day('2027-12-31T00:00:00.000Z'),
            censusStartDate: day('2027-01-01T00:00:00.000Z'),
            censusEndDate: day('2027-12-31T00:00:00.000Z'),
            firstMeasurementDate: null,
            lastMeasurementDate: null
          })
        ]}
      />
    );
    expect(screen.getByText('Census window: Jan 2027 - Dec 2027')).toBeInTheDocument();
    expect(screen.queryByText(/Dec 2026/)).not.toBeInTheDocument();
  });

  it('uses the census window for status and duration, not the measurement dates', () => {
    // Window starts in the future; a single past measurement must not make it Completed / "0 days".
    render(
      <CensusesOverview
        censuses={[
          census(2, {
            startDate: day('2026-09-02T00:00:00.000Z'),
            endDate: day('2026-09-02T00:00:00.000Z'),
            censusStartDate: day('2027-01-01T00:00:00.000Z'),
            censusEndDate: null,
            firstMeasurementDate: day('2026-09-02T00:00:00.000Z'),
            lastMeasurementDate: day('2026-09-02T00:00:00.000Z')
          })
        ]}
      />
    );
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('0 days')).not.toBeInTheDocument();
    expect(screen.getByText('Measurements: Sep 2, 2026')).toBeInTheDocument();
  });

  it('marks a census Completed only when its window has ended and keeps measurement dates separate', () => {
    render(
      <CensusesOverview
        censuses={[
          census(3, {
            censusStartDate: day('2025-01-01T00:00:00.000Z'),
            censusEndDate: day('2025-12-31T00:00:00.000Z'),
            firstMeasurementDate: day('2025-02-15T00:00:00.000Z'),
            lastMeasurementDate: day('2025-03-03T00:00:00.000Z')
          })
        ]}
      />
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Census window: Jan 2025 - Dec 2025')).toBeInTheDocument();
    expect(screen.getByText('Measurements: Feb 15, 2025 - Mar 3, 2025')).toBeInTheDocument();
    expect(screen.getByText('11 months')).toBeInTheDocument();
  });

  it('shows no measurement line and an unset window for a census without dates', () => {
    render(<CensusesOverview censuses={[census(4, { censusStartDate: null, censusEndDate: null, firstMeasurementDate: null, lastMeasurementDate: null })]} />);
    expect(screen.getByText('Census window not set')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.queryByText(/^Measurements:/)).not.toBeInTheDocument();
  });

  it('falls back to startDate/endDate for a legacy payload without window fields', () => {
    render(<CensusesOverview censuses={[census(5, { startDate: day('2025-02-01T00:00:00.000Z'), endDate: day('2025-04-30T00:00:00.000Z') })]} />);
    expect(screen.getByText('Census window: Feb 2025 - Apr 2025')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('labels a census with a closed range plus an open range as ongoing, with duration through today', () => {
    const open: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 7,
      censusIDs: [8, 7],
      dateRanges: [
        { censusID: 8, censusStartDate: day('2026-03-01T00:00:00.000Z'), censusEndDate: null },
        { censusID: 7, censusStartDate: day('2026-01-01T00:00:00.000Z'), censusEndDate: day('2026-02-01T00:00:00.000Z') }
      ],
      description: ''
    } as unknown as OrgCensusRDS;
    render(<CensusesOverview censuses={[open]} />);
    expect(screen.getByText('Census window: Jan 2026 - ongoing')).toBeInTheDocument();
    expect(screen.queryByText(/Feb 2026/)).not.toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('9 months')).toBeInTheDocument();
  });

  it('does not throw for a census with no date ranges', () => {
    render(<CensusesOverview censuses={[{ plotID: 1, plotCensusNumber: 6, censusIDs: [6], dateRanges: [], description: '' } as OrgCensusRDS]} />);
    expect(screen.getByText('Census window not set')).toBeInTheDocument();
  });
});
