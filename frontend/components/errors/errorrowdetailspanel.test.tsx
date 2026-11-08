import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CLEAR_VALIDATION_ERRORS_SUCCESS,
  DETAILS_SHEET_TEXT,
  EDIT_LOCK_TOOLTIPS,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL,
  type DetailsPanelRow,
  type ErrorDetailRecord,
  type ErrorExplorerDetailsResponse,
  type ErrorExplorerRow
} from '@/config/errorsexplorer';
import { designTokens } from '@/config/design-tokens';
import ErrorRowDetailsPanel, { type ErrorRowDetailsPanelProps } from './errorrowdetailspanel';

const ROW: DetailsPanelRow = {
  measurementID: 101,
  treeTag: 'T101',
  stemTag: '1',
  quadratName: 'Q1',
  speciesCode: 'SP1',
  measurementDate: '2024-06-01',
  isLinkedToStem: true,
  markedInvalidWithoutLoggedError: false
};
const DETAIL_ROW = { coreMeasurementID: 101, measuredDBH: 123.4, hasContradiction: false, attributes: 'X', rawCodes: 'X' } as unknown as ErrorExplorerRow;
const VALIDATION_DETAILS: ErrorExplorerDetailsResponse = {
  row: DETAIL_ROW,
  allErrors: [
    {
      source: 'validation',
      code: '1',
      message: 'DBH growth exceeds maximum rate of 65 mm',
      fields: ['measuredDBH'],
      comparison: { priorCensusID: 4, priorDBH: 100, priorHOM: 1.3, homChanged: false }
    },
    { source: 'validation', code: '14', message: 'Flagged;Different species', fields: ['attributes'], comparison: null }
  ],
  relatedRows: []
};
const FALLBACK_DETAILS: ErrorExplorerDetailsResponse = {
  row: DETAIL_ROW,
  allErrors: [{ source: 'ingestion', code: FALLBACK_ERROR_CODE, message: FALLBACK_ERROR_MESSAGE, fields: [], comparison: null }],
  relatedRows: []
};
const ERROR_CARD_TEST_ID = 'error-row-details-error-card';
const FALLBACK_LINE_TEST_ID = 'error-row-details-fallback';
const VALIDATION_SOURCE_CHIP_TEST_ID = 'error-source-chip-validation';
const INGESTION_SOURCE_CHIP_TEST_ID = 'error-source-chip-ingestion';

function renderPanel(overrides: Partial<ErrorRowDetailsPanelProps> = {}) {
  const props: ErrorRowDetailsPanelProps = {
    open: true,
    row: ROW,
    errorDetails: VALIDATION_DETAILS,
    status: 'ready',
    onRetry: vi.fn(),
    onClose: vi.fn(),
    canOpenRelatedRow: related => related.inErrorSet,
    onOpenRelatedRow: vi.fn(),
    ...overrides
  };
  render(<ErrorRowDetailsPanel {...props} />);
  return props;
}

describe('ErrorRowDetailsPanel (shared, P5-3, P5-5)', () => {
  it('renders the header from the row alone, with no error section and no optional slot', () => {
    renderPanel({ errorDetails: undefined, onEditRow: undefined, onClearValidationErrors: undefined });
    const sheet = screen.getByTestId('error-row-details-sheet');
    console.log('[view-errors sheet header]', sheet.textContent);
    expect(within(sheet).getByRole('heading', { name: 'Measurement 101' })).toBeInTheDocument();
    expect(within(sheet).getByText('Tree T101 · Stem 1')).toBeInTheDocument();
    expect(within(sheet).getByText('Quadrat Q1 · SP1 · 2024-06-01')).toBeInTheDocument();
    expect(within(sheet).queryByText(/unresolved error/)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow })).toBeNull();
    expect(within(sheet).queryByTestId('details-header-extras')).toBeNull();
  });

  it('stacks the sheet above the fixed app header, so the header cannot cover the sheet title and Close button on narrow screens', () => {
    renderPanel();
    const sheetRoot = screen.getByTestId('error-row-details-sheet').closest('[role="presentation"]') as HTMLElement;
    const sheetZIndex = Number(getComputedStyle(sheetRoot).zIndex);
    console.log(`[view-errors sheet z-index] sheet root z-index ${sheetZIndex}, app header z-index ${designTokens.zIndex.header}`);
    expect(sheetRoot, 'the Drawer root that carries the stacking context').not.toBeNull();
    expect(sheetZIndex).toBeGreaterThan(designTokens.zIndex.header);
  });

  it('labels each error, adds the DBH fact line and the Attributes link', () => {
    renderPanel({ priorCensusNumberFor: () => 3 });
    const cards = screen.getAllByTestId(ERROR_CARD_TEST_ID);
    console.log('[view-errors sheet cards]', JSON.stringify(cards.map(card => card.textContent)));
    expect(cards, 'one card per error').toHaveLength(VALIDATION_DETAILS.allErrors.length);
    for (const card of cards) expect(within(card).getByTestId(VALIDATION_SOURCE_CHIP_TEST_ID)).toHaveTextContent(DETAILS_SHEET_TEXT.validationChip);
    expect(screen.queryByTestId(FALLBACK_LINE_TEST_ID)).toBeNull();
    expect(screen.getByText('2 unresolved errors')).toBeInTheDocument();
    expect(screen.getByText('Different species')).toBeInTheDocument();
    expect(screen.getByText('DBH went from 100.00 in Census 3 to 123.40, a change of +23.4%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: DETAILS_SHEET_TEXT.openAttributes })).toHaveAttribute('href', '/fixeddatainput/attributes');
  });

  it('shows the fallback line for a linked row flagged by status, and offers Clear', () => {
    renderPanel({ row: { ...ROW, markedInvalidWithoutLoggedError: true }, errorDetails: undefined, onClearValidationErrors: vi.fn() });
    expect(screen.getByTestId(FALLBACK_LINE_TEST_ID)).toHaveTextContent(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(screen.queryByTestId(ERROR_CARD_TEST_ID), 'no card for the fallback (D-h)').toBeNull();
    expect(screen.queryByText(/unresolved error/)).toBeNull();
    expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeEnabled();
  });

  it('shows the fallback line for an unlinked row whose fetched errors hold only the fallback, and no Clear', () => {
    renderPanel({ row: { ...ROW, isLinkedToStem: false }, errorDetails: FALLBACK_DETAILS, onClearValidationErrors: vi.fn() });
    expect(screen.getByTestId(FALLBACK_LINE_TEST_ID)).toHaveTextContent(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(screen.queryByTestId(INGESTION_SOURCE_CHIP_TEST_ID), 'the fallback has no source chip (D-h)').toBeNull();
    expect(screen.queryByText('Ingestion')).toBeNull();
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
  });

  it('drops the fallback line and Clear once refetched details say the cleared fallback row is resolved (P2-5)', () => {
    renderPanel({
      row: { ...ROW, markedInvalidWithoutLoggedError: true },
      errorDetails: { row: null, allErrors: [], relatedRows: [] },
      notice: CLEAR_VALIDATION_ERRORS_SUCCESS,
      onClearValidationErrors: vi.fn()
    });
    const sheet = screen.getByTestId('error-row-details-sheet');
    console.log('[view-errors sheet after clear]', sheet.textContent);
    expect(within(sheet).getByRole('heading', { name: 'Measurement 101' })).toBeInTheDocument();
    expect(within(sheet).getByText(DETAILS_SHEET_TEXT.rowResolved)).toBeInTheDocument();
    expect(within(sheet).queryByText(MARKED_INVALID_NO_ERROR_LOGGED_LABEL), 'a stale grid-row flag must not outvote fetched details').toBeNull();
    expect(within(sheet).queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
  });

  it.each([
    ['code 20', [{ source: 'validation', code: '20', message: 'Species mismatch from previous census', fields: ['speciesCode'], comparison: null }]],
    [
      'codes 20 and 21',
      [
        { source: 'validation', code: '20', message: 'Species mismatch from previous census', fields: [], comparison: null },
        { source: 'validation', code: '21', message: 'Previous census stem missing', fields: [], comparison: null }
      ]
    ]
  ] satisfies Array<[string, ErrorDetailRecord[]]>)('offers no Clear for a linked row whose only validation errors are %s', (_label, allErrors) => {
    renderPanel({ errorDetails: { row: DETAIL_ROW, allErrors, relatedRows: [] }, onClearValidationErrors: vi.fn() });
    console.log('[view-errors sheet only ingestion stage codes]', _label, screen.getByTestId('error-row-details-sheet').textContent);
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeNull();
  });

  it('offers Clear for a linked row that has another validation error beside code 20', () => {
    renderPanel({
      errorDetails: {
        row: DETAIL_ROW,
        allErrors: [
          ...VALIDATION_DETAILS.allErrors,
          { source: 'validation', code: '20', message: 'Species mismatch from previous census', fields: [], comparison: null }
        ],
        relatedRows: []
      },
      onClearValidationErrors: vi.fn()
    });
    expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeEnabled();
  });

  it('shows Clear for a linked row with a validation error, disabled with a reason while locked', async () => {
    renderPanel({ onClearValidationErrors: vi.fn(), clearValidationErrorsDisabledReason: EDIT_LOCK_TOOLTIPS.editing });
    expect(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).toBeDisabled();
  });

  it('shows a page notice, loading, error with Retry, and a resolved row', async () => {
    const { rerender } = render(
      <ErrorRowDetailsPanel open row={ROW} status="loading" onRetry={vi.fn()} onClose={vi.fn()} canOpenRelatedRow={() => true} onOpenRelatedRow={vi.fn()} />
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    const onRetry = vi.fn();
    rerender(
      <ErrorRowDetailsPanel open row={ROW} status="error" onRetry={onRetry} onClose={vi.fn()} canOpenRelatedRow={() => true} onOpenRelatedRow={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <ErrorRowDetailsPanel
        open
        row={ROW}
        errorDetails={{ row: null, allErrors: [], relatedRows: [] }}
        status="ready"
        notice={CLEAR_VALIDATION_ERRORS_SUCCESS}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        canOpenRelatedRow={() => true}
        onOpenRelatedRow={vi.fn()}
      />
    );
    expect(screen.getByText(CLEAR_VALIDATION_ERRORS_SUCCESS)).toBeInTheDocument();
    expect(screen.getByText(DETAILS_SHEET_TEXT.rowResolved)).toBeInTheDocument();
  });

  it('closes from its Close button', async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: DETAILS_SHEET_TEXT.closeDetails }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('renders the optional slots only when passed', () => {
    renderPanel({ headerExtras: <span data-testid="details-header-extras">chips</span>, footerActions: <button type="button">Delete</button> });
    expect(screen.getByTestId('details-header-extras')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
