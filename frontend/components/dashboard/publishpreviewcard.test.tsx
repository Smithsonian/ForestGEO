import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PublishPreviewCard from './publishpreviewcard';
import { CENSUS_OVERVIEW_TEXT, formatExportedWithUnresolvedErrors, type CensusOverviewSummary } from '@/config/censusoverview';

const CARD_TEST_ID = 'publish-preview-card';
const EXPORT_PREVIEW_TEST_ID = 'census-overview-export-preview';
const SKIP_REASONS_TEST_ID = 'census-overview-skip-reasons';
const SKIP_REASON_ROW_TEST_ID = 'census-overview-skip-reason-row';
const SPLIT_BAR_NAME = '67 exported, 21 skipped';
const VERDICT_WORDING = /ready/i;

function buildExportPreview(overrides: Partial<CensusOverviewSummary['exportPreview']> = {}): CensusOverviewSummary['exportPreview'] {
  return {
    totalActiveMeasurements: 88,
    exportableCount: 67,
    skippedCount: 21,
    skipReasons: [
      { kind: 'not-validated', count: 21 },
      { kind: 'no-stem-guid', count: 11 },
      { kind: 'inactive-stem-or-tree', count: 0 },
      { kind: 'missing-link', count: 0 },
      { kind: 'other', count: 0 }
    ],
    exportedWithUnresolvedErrorCount: 0,
    ...overrides
  };
}

function skipReasonRows(): string[][] {
  const rows = within(screen.getByTestId(SKIP_REASONS_TEST_ID))
    .getAllByTestId(SKIP_REASON_ROW_TEST_ID)
    .map(row => Array.from(row.children).map(child => child.textContent ?? ''));
  console.log(`[option A publish preview] skip reasons ${JSON.stringify(rows)}`);
  return rows;
}

describe('PublishPreviewCard', () => {
  it('states what a publish would export against the active total', () => {
    render(<PublishPreviewCard exportPreview={buildExportPreview()} />);
    expect(screen.getByRole('heading', { name: CENSUS_OVERVIEW_TEXT.publishPreviewTitle })).toBeInTheDocument();
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.publishPreviewSubtitle)).toBeInTheDocument();
    const preview = screen.getByTestId(EXPORT_PREVIEW_TEST_ID);
    expect(within(preview).getByText('67')).toBeInTheDocument();
    expect(within(preview).getByText('of 88 measurements exported')).toBeInTheDocument();
  });

  it('draws the exported/skipped split as a labelled bar with a legend', () => {
    render(<PublishPreviewCard exportPreview={buildExportPreview()} />);
    expect(screen.getByRole('img', { name: SPLIT_BAR_NAME })).toBeInTheDocument();
    expect(screen.getByText('67 exported')).toBeInTheDocument();
    expect(screen.getByText('21 skipped')).toBeInTheDocument();
  });

  it('lists skip reasons in sentence case, says they overlap, and hides zero counts', () => {
    render(<PublishPreviewCard exportPreview={buildExportPreview()} />);
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.skipReasonsHeading)).toBeInTheDocument();
    expect(skipReasonRows()).toEqual([
      ['Not validated', '21'],
      ['Failed (no stem)', '11']
    ]);
  });

  it('hides the skip reasons when nothing is skipped', () => {
    render(
      <PublishPreviewCard exportPreview={buildExportPreview({ exportableCount: 88, skippedCount: 0, skipReasons: [{ kind: 'not-validated', count: 0 }] })} />
    );
    expect(screen.queryByTestId(SKIP_REASONS_TEST_ID)).toBeNull();
  });

  it('says how many exported rows still carry an unresolved error, only when there are some', () => {
    const { unmount } = render(<PublishPreviewCard exportPreview={buildExportPreview({ exportedWithUnresolvedErrorCount: 37 })} />);
    expect(screen.getByText(formatExportedWithUnresolvedErrors(37))).toBeInTheDocument();
    unmount();

    render(<PublishPreviewCard exportPreview={buildExportPreview({ exportedWithUnresolvedErrorCount: 0 })} />);
    expect(screen.queryByText(/still ha(s|ve) an unresolved error/)).toBeNull();
  });

  it('draws no bar for a census with no active measurements', () => {
    render(<PublishPreviewCard exportPreview={buildExportPreview({ totalActiveMeasurements: 0, exportableCount: 0, skippedCount: 0, skipReasons: [] })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('states facts without a readiness verdict', () => {
    render(<PublishPreviewCard exportPreview={buildExportPreview()} />);
    expect(screen.getByTestId(CARD_TEST_ID).textContent).not.toMatch(VERDICT_WORDING);
  });

  it('shows the title but no numbers while the summary loads', () => {
    render(<PublishPreviewCard exportPreview={null} />);
    expect(screen.getByRole('heading', { name: CENSUS_OVERVIEW_TEXT.publishPreviewTitle })).toBeInTheDocument();
    expect(screen.queryByTestId(EXPORT_PREVIEW_TEST_ID)).toBeNull();
  });
});
