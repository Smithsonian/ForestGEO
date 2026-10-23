import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorsExportPreviewCard, { type ErrorsExportPreviewCardProps } from './errorsexportpreviewcard';
import { BLOCKER_FIX_HINTS, CENSUS_OVERVIEW_TEXT, formatBlockerRowCount, type CensusOverviewSummary, type ErrorTypeCount } from '@/config/censusoverview';
import { ERRORS_EXPLORER_MESSAGE_PARAM, ERRORS_EXPLORER_VIEW_ALL_HREF } from '@/config/errorsexplorer';

const URL_BASE = 'http://localhost';
const CALLOUT_TEST_ID = 'census-overview-blocker-callout';
const BLOCKER_ROW_TEST_ID = 'census-overview-blocker-row';
const BLOCKER_COUNT_TEST_ID = 'census-overview-blocker-count';
const ERROR_TYPE_ROW_TEST_ID = 'census-overview-error-type-row';
const ERROR_OVERVIEW_TEST_ID = 'census-overview-error-overview';
const EXPORT_PREVIEW_TEST_ID = 'census-overview-export-preview';
const SKIP_REASONS_TEST_ID = 'census-overview-skip-reasons';
const VERDICT_WORDING = /ready/i;
const CENSUS_NOT_FOUND_MESSAGE = 'Census not found';

function errorTypes(count: number): ErrorTypeCount[] {
  return Array.from({ length: count }, (_, index) => ({ message: `Error type ${index + 1}`, count: 100 - index }));
}

function buildSummary(
  overrides: {
    errorOverview?: Partial<CensusOverviewSummary['errorOverview']>;
    exportPreview?: Partial<CensusOverviewSummary['exportPreview']>;
    blockers?: CensusOverviewSummary['blockers'];
  } = {}
): CensusOverviewSummary {
  return {
    errorOverview: {
      affectedMeasurements: 1204,
      totalActiveMeasurements: 16084,
      topErrorTypes: errorTypes(5),
      remainingErrorTypeCount: 0,
      ...overrides.errorOverview
    },
    exportPreview: {
      totalActiveMeasurements: 16084,
      exportableCount: 14580,
      skippedCount: 1504,
      skipReasons: [
        { kind: 'not-validated', count: 1180 },
        { kind: 'no-stem-guid', count: 412 },
        { kind: 'inactive-stem-or-tree', count: 0 },
        { kind: 'missing-link', count: 2 },
        { kind: 'other', count: 0 }
      ],
      exportedWithUnresolvedErrorCount: 37,
      ...overrides.exportPreview
    },
    blockers: overrides.blockers ?? []
  };
}

function renderCard(props: Partial<ErrorsExportPreviewCardProps> = {}) {
  const onRetry = vi.fn();
  render(<ErrorsExportPreviewCard summary={buildSummary()} isLoading={false} errorMessage={null} onRetry={onRetry} {...props} />);
  return { onRetry };
}

function blockerRow(label: string): HTMLElement {
  const row = within(screen.getByTestId(CALLOUT_TEST_ID)).getByText(label).closest(`[data-testid="${BLOCKER_ROW_TEST_ID}"]`);
  if (!row) throw new Error(`No blocker row for "${label}"`);
  return row as HTMLElement;
}

describe('ErrorsExportPreviewCard', () => {
  it('shows no blocker callout when nothing blocks a publish', () => {
    renderCard();
    expect(screen.queryByTestId(CALLOUT_TEST_ID)).toBeNull();
  });

  it('shows every blocker with its label and fix hint; census-level kinds carry no row count', () => {
    renderCard({
      summary: buildSummary({
        blockers: [
          { kind: 'unknown-attribute-code', count: 12 },
          { kind: 'missing-taxonomy-fields', count: 1 },
          { kind: 'string-too-long', count: 3 },
          { kind: 'zero-exportable-rows', count: null },
          { kind: 'insufficient-exportable-rows', count: null }
        ]
      })
    });

    const callout = screen.getByTestId(CALLOUT_TEST_ID);
    console.log('[#547 callout]', callout.textContent);
    expect(within(callout).getByText(CENSUS_OVERVIEW_TEXT.blockerCalloutTitle)).toBeInTheDocument();
    for (const [kind, fixHint] of Object.entries(BLOCKER_FIX_HINTS)) {
      expect(within(callout).getByText(fixHint.hint), `${kind} hint`).toBeInTheDocument();
    }
    expect(within(blockerRow(BLOCKER_FIX_HINTS['unknown-attribute-code'].label)).getByTestId(BLOCKER_COUNT_TEST_ID)).toHaveTextContent(
      formatBlockerRowCount(12)
    );
    expect(within(blockerRow(BLOCKER_FIX_HINTS['missing-taxonomy-fields'].label)).getByTestId(BLOCKER_COUNT_TEST_ID)).toHaveTextContent(
      formatBlockerRowCount(1)
    );
    expect(within(blockerRow(BLOCKER_FIX_HINTS['zero-exportable-rows'].label)).queryByTestId(BLOCKER_COUNT_TEST_ID)).toBeNull();
    expect(within(blockerRow(BLOCKER_FIX_HINTS['insufficient-exportable-rows'].label)).queryByTestId(BLOCKER_COUNT_TEST_ID)).toBeNull();
  });

  it('orders the parts: callout, then the error overview, then the export preview', () => {
    renderCard({ summary: buildSummary({ blockers: [{ kind: 'string-too-long', count: 3 }] }) });

    const callout = screen.getByTestId(CALLOUT_TEST_ID);
    const overview = screen.getByTestId(ERROR_OVERVIEW_TEST_ID);
    const preview = screen.getByTestId(EXPORT_PREVIEW_TEST_ID);
    expect(callout.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overview.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states the affected rows against the active total', () => {
    renderCard();
    expect(screen.getByText('1,204 of 16,084 active measurements have unresolved errors (7.5%)')).toBeInTheDocument();
  });

  it('shows neutral text, and no verdict, when there are no unresolved errors', () => {
    renderCard({ summary: buildSummary({ errorOverview: { affectedMeasurements: 0, topErrorTypes: [], remainingErrorTypeCount: 0 } }) });

    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.noUnresolvedErrors)).toBeInTheDocument();
    expect(screen.queryAllByTestId(ERROR_TYPE_ROW_TEST_ID)).toHaveLength(0);
    expect(screen.queryByText(VERDICT_WORDING)).toBeNull();
  });

  it('says there are no measurements yet and still shows the zero-exportable blocker for an empty census', () => {
    renderCard({
      summary: buildSummary({
        errorOverview: { affectedMeasurements: 0, totalActiveMeasurements: 0, topErrorTypes: [], remainingErrorTypeCount: 0 },
        exportPreview: { totalActiveMeasurements: 0, exportableCount: 0, skippedCount: 0, exportedWithUnresolvedErrorCount: 0 },
        blockers: [{ kind: 'zero-exportable-rows', count: null }]
      })
    });

    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.noMeasurementsYet)).toBeInTheDocument();
    expect(within(screen.getByTestId(CALLOUT_TEST_ID)).getByText(BLOCKER_FIX_HINTS['zero-exportable-rows'].label)).toBeInTheDocument();
  });

  it('shows five error types and "+ 2 more types" when there are seven', () => {
    renderCard({ summary: buildSummary({ errorOverview: { topErrorTypes: errorTypes(5), remainingErrorTypeCount: 2 } }) });

    expect(screen.getAllByTestId(ERROR_TYPE_ROW_TEST_ID)).toHaveLength(5);
    expect(screen.getByText('+ 2 more types')).toBeInTheDocument();
  });

  it('shows no "more types" line with five or fewer types', () => {
    renderCard({ summary: buildSummary({ errorOverview: { topErrorTypes: errorTypes(3), remainingErrorTypeCount: 0 } }) });
    expect(screen.queryByText(/more type/)).toBeNull();
  });

  it('links each error type to View Errors with the full message encoded', () => {
    const awkwardMessage = 'DBH & HOM / 50% growth check';
    renderCard({ summary: buildSummary({ errorOverview: { topErrorTypes: [{ message: awkwardMessage, count: 9 }], remainingErrorTypeCount: 0 } }) });

    const link = screen.getByRole('link', { name: awkwardMessage });
    const href = link.getAttribute('href') as string;
    console.log(`[#547 type link] ${href}`);
    expect(new URL(href, URL_BASE).searchParams.get(ERRORS_EXPLORER_MESSAGE_PARAM)).toBe(awkwardMessage);
  });

  it('links "View all errors" to the explicit view-all deep link', () => {
    renderCard();
    expect(screen.getByRole('link', { name: CENSUS_OVERVIEW_TEXT.viewAllErrors })).toHaveAttribute('href', ERRORS_EXPLORER_VIEW_ALL_HREF);
  });

  it('truncates a long message but keeps the full text in a tooltip and in the link', async () => {
    const user = userEvent.setup();
    const longMessage = `Validation ${'very '.repeat(40)}long description`;
    renderCard({ summary: buildSummary({ errorOverview: { topErrorTypes: [{ message: longMessage, count: 4 }], remainingErrorTypeCount: 0 } }) });

    const link = screen.getByRole('link', { name: longMessage });
    expect(new URL(link.getAttribute('href') as string, URL_BASE).searchParams.get(ERRORS_EXPLORER_MESSAGE_PARAM)).toBe(longMessage);
    await user.hover(link);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(longMessage);
  });

  it('shows exported and skipped counts, labels the reasons as overlapping, and hides zero reasons', () => {
    renderCard();

    expect(screen.getByText('14,580 would be exported · 1,504 skipped')).toBeInTheDocument();
    const reasons = screen.getByTestId(SKIP_REASONS_TEST_ID);
    console.log('[#547 skip reasons]', reasons.textContent);
    expect(reasons).toHaveTextContent(CENSUS_OVERVIEW_TEXT.skipReasonsPrefix);
    expect(reasons).toHaveTextContent('1,180 not validated');
    expect(reasons).toHaveTextContent('2 missing quadrat, species, genus or family link');
    expect(reasons).not.toHaveTextContent('inactive tree or stem');
    expect(reasons).not.toHaveTextContent('other reason');
  });

  it('hides the reasons line when nothing is skipped', () => {
    renderCard({
      summary: buildSummary({
        exportPreview: {
          exportableCount: 16084,
          skippedCount: 0,
          skipReasons: [
            { kind: 'not-validated', count: 0 },
            { kind: 'other', count: 0 }
          ]
        }
      })
    });
    expect(screen.queryByTestId(SKIP_REASONS_TEST_ID)).toBeNull();
  });

  it('shows the exported-with-unresolved-error line only when it is non-zero', () => {
    renderCard();
    expect(screen.getByText('37 exported rows still have an unresolved error')).toBeInTheDocument();
  });

  it('hides the exported-with-unresolved-error line at zero', () => {
    renderCard({ summary: buildSummary({ exportPreview: { exportedWithUnresolvedErrorCount: 0 } }) });
    expect(screen.queryByText(/still ha(s|ve) an unresolved error/)).toBeNull();
  });

  it('shows the error message with a Retry button when the summary failed', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderCard({ summary: null, errorMessage: CENSUS_NOT_FOUND_MESSAGE });

    expect(screen.getByText(CENSUS_NOT_FOUND_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId(EXPORT_PREVIEW_TEST_ID)).toBeNull();
    await user.click(screen.getByRole('button', { name: CENSUS_OVERVIEW_TEXT.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no numbers while the summary is loading', () => {
    renderCard({ summary: null, isLoading: true });
    expect(screen.queryByTestId(ERROR_OVERVIEW_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(EXPORT_PREVIEW_TEST_ID)).toBeNull();
  });
});
