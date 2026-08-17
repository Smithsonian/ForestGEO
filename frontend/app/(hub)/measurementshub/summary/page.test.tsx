import { describe, expect, it, vi } from 'vitest';

// The page's contract under test is which props it passes to the grid; the
// grid's own import chain (datagrid HCs, DB definitions) stays out of scope.
vi.mock('@/components/datagrids/applications/msvdatagrid', () => ({
  default: () => null
}));

import SummaryPage from './page';

describe('SummaryPage — failed-measurements deep link', () => {
  it('opens the failed-measurements modal and strips the query on close when ?openFailed=1', async () => {
    const element = await SummaryPage({ searchParams: Promise.resolve({ openFailed: '1' }) });

    expect(element.props.autoOpenFailedMeasurements).toBe(true);
    expect(element.props.failedMeasurementsCloseRedirectHref).toBe('/measurementshub/summary');
  });

  it('renders the plain grid when the query parameter is absent', async () => {
    const element = await SummaryPage({ searchParams: Promise.resolve({}) });

    expect(element.props.autoOpenFailedMeasurements).toBe(false);
    expect(element.props.failedMeasurementsCloseRedirectHref).toBeUndefined();
  });

  it('ignores unexpected values for the query parameter', async () => {
    const element = await SummaryPage({ searchParams: Promise.resolve({ openFailed: 'yes' }) });

    expect(element.props.autoOpenFailedMeasurements).toBe(false);
  });
});
