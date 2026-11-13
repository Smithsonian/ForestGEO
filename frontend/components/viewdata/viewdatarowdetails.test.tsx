import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewDataRowDetails, { type ViewDataRowDetailsProps, type ViewDataSheetTarget } from './viewdatarowdetails';
import {
  CLEAR_MEASUREMENT_ERRORS_CODES,
  CLEAR_NOTHING_TO_CLEAR_MESSAGE,
  CLEAR_UNCONFIRMED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_ENDPOINT,
  CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_SUCCESS,
  DETAILS_SHEET_TEXT,
  ERROR_TYPE_DISPLAY_LABELS,
  formatUnresolvedErrorsHeading,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL
} from '@/config/errorsexplorer';
import { VIEW_DATA_TEXT } from '@/config/viewdata';
import { HTTPResponses } from '@/config/macros';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';

vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 1;
const PAGE_CENSUS_NUMBER = 5;
const ROW_CENSUS_ID = 72;
const MEASUREMENT_ID = 501;
const STORED_MESSAGE = 'Flagged;Different species';
const STORED_LABEL = ERROR_TYPE_DISPLAY_LABELS.get(STORED_MESSAGE) ?? `missing shared label for ${STORED_MESSAGE}`;
const INGESTION_MESSAGE = 'Coordinates drifted from the prior census';
const DETAILS_URL_PREFIX = '/api/errors/explorer/details/';
const REFRESH_VIEWS_PREFIX = '/api/refreshviews';
const MIXED_ERROR_COUNT = 2;
const REMAINING_ERROR_COUNT = 1;
const ERROR_CARD_TEST_ID = 'error-row-details-error-card';
const FALLBACK_LINE_TEST_ID = 'error-row-details-fallback';
const INGESTION_SOURCE_CHIP_TEST_ID = 'error-source-chip-ingestion';
const STATUS_CHIPS_TEST_ID = 'view-data-status-chips';

const baseRow = {
  id: 3,
  coreMeasurementID: MEASUREMENT_ID,
  censusID: ROW_CENSUS_ID,
  treeTag: '010203',
  stemTag: '1',
  speciesCode: 'ACRU',
  speciesName: 'Acer rubrum',
  quadratName: '0102',
  stemLocalX: 1.5,
  measuredDBH: 12.5,
  measurementDate: '2024-06-03',
  attributes: 'A',
  userDefinedFields: 'old tree',
  stemStatuses: 'alive'
};

const detailsResponse = {
  row: {
    ...baseRow,
    id: MEASUREMENT_ID,
    primaryErrorMessage: STORED_MESSAGE,
    errorMessages: [STORED_MESSAGE],
    errorSources: ['validation'],
    errorFields: ['speciesCode'],
    errorCodes: ['7'],
    errorCount: 1,
    hasContradiction: false,
    contradictionTypes: [],
    contradictionType: null,
    contradictionGroupKey: null,
    relatedMeasurementIDs: [],
    isFailedRow: false
  },
  allErrors: [{ source: 'validation', code: '7', message: STORED_MESSAGE, fields: ['speciesCode'], comparison: null }],
  relatedRows: []
};

const mixedDetailsBeforeClear = {
  ...detailsResponse,
  row: { ...detailsResponse.row, errorSources: ['validation', 'ingestion'], errorCodes: ['7', 'COORDINATE_DRIFT'], errorCount: MIXED_ERROR_COUNT },
  allErrors: [
    ...detailsResponse.allErrors,
    { source: 'ingestion', code: 'COORDINATE_DRIFT', message: INGESTION_MESSAGE, fields: ['stemLocalX'], comparison: null }
  ]
};
const mixedDetailsAfterClear = { ...mixedDetailsBeforeClear, allErrors: [mixedDetailsBeforeClear.allErrors[1]] };
const MIXED_TARGET_ROW = {
  ...baseRow,
  measurementStatus: 'unresolvedErrors',
  unresolvedErrorCount: MIXED_ERROR_COUNT,
  primaryErrorMessage: STORED_MESSAGE,
  primaryErrorSource: 'validation'
};

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return { ok: status < HTTPResponses.BAD_REQUEST, status, json: async () => body } as Response;
}

function target(row: Record<string, unknown> | null, coreMeasurementID = MEASUREMENT_ID): ViewDataSheetTarget {
  return { coreMeasurementID, censusID: ROW_CENSUS_ID, gridRow: row };
}

function baseProps(): ViewDataRowDetailsProps {
  return {
    target: target({ ...baseRow, measurementStatus: 'passed' }),
    schema: SCHEMA,
    plotID: PLOT_ID,
    plotCensusNumber: PAGE_CENSUS_NUMBER,
    canEditRows: true,
    isAnyRowEditing: false,
    isDeleteGuarded: false,
    faultedFields: new Set(),
    onClose: vi.fn(),
    onOpenRelatedRow: vi.fn(),
    onEditRow: vi.fn(),
    onDeleteRow: vi.fn(async () => undefined),
    onCleared: vi.fn(async () => undefined),
    refreshState: 'current',
    onRefreshStateChange: vi.fn(),
    notify: vi.fn()
  };
}

function renderDetails(overrides: Partial<ViewDataRowDetailsProps> = {}) {
  const props: ViewDataRowDetailsProps = { ...baseProps(), ...overrides };
  const view = render(<ViewDataRowDetails {...props} />);
  return { props, view };
}

const fetchedUrls = () => fetchMock.mock.calls.map(call => String(call[0]));
const clearCalls = () => fetchMock.mock.calls.filter(call => String(call[0]) === CLEAR_VALIDATION_ERRORS_ENDPOINT);
const notifyCalls = (notify: ViewDataRowDetailsProps['notify']) => (notify as ReturnType<typeof vi.fn>).mock.calls;
const INVALID_NO_LOG_TARGET = () => target({ ...baseRow, measurementStatus: 'invalidNoLog' });
const button = (name: string) => screen.getByRole('button', { name });
const disabledState = () => ({
  edit: button(DETAILS_SHEET_TEXT.editThisRow).hasAttribute('disabled'),
  clear: screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })?.hasAttribute('disabled') ?? 'not offered',
  deleteRow: button(VIEW_DATA_TEXT.deleteMeasurement).hasAttribute('disabled')
});

describe('ViewDataRowDetails', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) return json(HTTPResponses.OK, detailsResponse);
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return json(HTTPResponses.OK, { clearedErrorCount: 1 });
      return json(HTTPResponses.OK, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes no details request for a passed row and lists every measurement field with dashes for blanks', () => {
    renderDetails();
    const section = screen.getByTestId('view-data-measurement-section');
    console.log('[row details] measurement section', section.textContent, 'fetched', JSON.stringify(fetchedUrls()));
    expect(fetchedUrls()).toEqual([]);
    expect(within(section).getByText('Acer rubrum')).toBeInTheDocument();
    expect(within(section).getByTestId('measurement-field-stemPlotX')).toHaveTextContent('—');
    expect(within(section).getByTestId('measurement-field-stemStatus')).toHaveTextContent('Alive');
    expect(within(section).getByTestId('measurement-field-measuredDBH')).toHaveTextContent('12.50');
  });

  it('fetches details with the row census for an error row and links to View Errors with the stored message', async () => {
    renderDetails({
      target: target({
        ...baseRow,
        measurementStatus: 'unresolvedErrors',
        unresolvedErrorCount: 1,
        primaryErrorMessage: STORED_MESSAGE,
        primaryErrorSource: 'validation'
      })
    });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(1))).toBeInTheDocument();
    const detailsUrl = fetchedUrls().find(url => url.startsWith(DETAILS_URL_PREFIX)) ?? '';
    console.log('[row details] details url', detailsUrl, 'label', STORED_LABEL);
    expect(screen.getAllByText(STORED_LABEL).length).toBeGreaterThanOrEqual(1);
    expect(detailsUrl).toBe(`${DETAILS_URL_PREFIX}${MEASUREMENT_ID}?schema=${SCHEMA}&plotID=${PLOT_ID}&censusID=${ROW_CENSUS_ID}`);
    const link = screen.getByRole('link', { name: VIEW_DATA_TEXT.openViewErrors });
    expect(decodeURIComponent((link.getAttribute('href') ?? '').replace(/\+/g, ' '))).toContain(`message=${STORED_MESSAGE}`);
  });

  it('shows the fallback line without a request for invalidNoLog, clears it through the route, re-reads without a client rebuild, then says so once', async () => {
    const user = userEvent.setup();
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET() });
    expect(screen.getByTestId(FALLBACK_LINE_TEST_ID)).toHaveTextContent(MARKED_INVALID_NO_ERROR_LOGGED_LABEL);
    expect(within(screen.getByTestId(STATUS_CHIPS_TEST_ID)).getByText(MARKED_INVALID_NO_ERROR_LOGGED_LABEL)).toBeInTheDocument();
    expect(screen.queryByTestId(ERROR_CARD_TEST_ID), 'no error card for the fallback (D-h)').toBeNull();
    expect(fetchedUrls()).toEqual([]);
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    const clearCall = clearCalls()[0];
    console.log('[row details] clear request', JSON.stringify(clearCall?.[1]), 'notify', JSON.stringify(notifyCalls(props.notify)));
    expect(JSON.parse(String(clearCall?.[1]?.body))).toEqual({ schema: SCHEMA, plotID: PLOT_ID, censusID: ROW_CENSUS_ID, measurementID: MEASUREMENT_ID });
    expect(props.onCleared).toHaveBeenCalledTimes(1);
    expect(fetchedUrls().some(url => url.startsWith(REFRESH_VIEWS_PREFIX))).toBe(false);
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_VALIDATION_ERRORS_SUCCESS, 'success']]);
  });

  it('posts the outcome only after the re-read has settled, so the grid count snackbar cannot replace it', async () => {
    const user = userEvent.setup();
    let finishReread: () => void = () => undefined;
    const onCleared = vi.fn(() => new Promise<void>(resolve => (finishReread = resolve)));
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));
    const beforeReread = notifyCalls(props.notify).length;
    finishReread();
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    console.log('[row details] notify before / after the re-read', beforeReread, JSON.stringify(notifyCalls(props.notify)));
    expect(beforeReread).toBe(0);
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_VALIDATION_ERRORS_SUCCESS, 'success']]);
  });

  it.each([
    ['a lost response', () => Promise.reject(new TypeError('Failed to fetch'))],
    [
      'the unknown-commit code',
      async () => json(HTTPResponses.INTERNAL_SERVER_ERROR, { code: TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, error: CLEAR_UNCONFIRMED_MESSAGE })
    ],
    [
      'an unreadable 2xx body',
      async () =>
        ({
          ok: true,
          status: HTTPResponses.OK,
          json: async () => {
            throw new SyntaxError('bad json');
          }
        }) as unknown as Response
    ]
  ])('treats %s as unconfirmed: re-reads, ends with the unconfirmed message only, and never sends a second clear', async (_label, clearAnswer) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === CLEAR_VALIDATION_ERRORS_ENDPOINT ? clearAnswer() : json(HTTPResponses.OK, {})
    );
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET() });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    console.log('[row details] unconfirmed', JSON.stringify({ notify: notifyCalls(props.notify), clearCalls: clearCalls().length }));
    expect(props.onCleared).toHaveBeenCalledTimes(1);
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_UNCONFIRMED_MESSAGE, 'error']]);
    expect(clearCalls()).toHaveLength(1);
  });

  it('an unconfirmed clear whose re-read fails still ends with the unconfirmed message, never "cleared", and keeps Retry refresh', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === CLEAR_VALIDATION_ERRORS_ENDPOINT ? Promise.reject(new TypeError('Failed to fetch')) : json(HTTPResponses.OK, {})
    );
    const onCleared = vi.fn().mockRejectedValueOnce(new Error('counts query failed'));
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
    console.log('[row details] unconfirmed + failed re-read', JSON.stringify(notifyCalls(props.notify)));
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_UNCONFIRMED_MESSAGE, 'error']]);
    expect(notifyCalls(props.notify).flat()).not.toContain(VIEW_DATA_TEXT.clearRefreshFailed);
  });

  it('a cleared clear whose grid re-read fails says the rows may be out of date (no success), keeps Edit, Clear and Delete disabled, and re-enables them after Retry refresh', async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn().mockRejectedValueOnce(new Error('counts query failed')).mockResolvedValueOnce(undefined);
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
    const afterFailure = disabledState();
    console.log('[row details] after a failed re-read', JSON.stringify({ afterFailure, notify: notifyCalls(props.notify) }));
    expect(notifyCalls(props.notify)).toEqual([[VIEW_DATA_TEXT.clearRefreshFailed, 'error']]);
    expect(afterFailure).toEqual({ edit: true, clear: true, deleteRow: true });
    await user.hover(button(DETAILS_SHEET_TEXT.clearValidationErrors).parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(VIEW_DATA_TEXT.refreshBeforeClearing);
    await user.click(button(VIEW_DATA_TEXT.retryRefresh));
    await waitFor(() => expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).not.toBeInTheDocument());
    console.log('[row details] after Retry refresh', JSON.stringify({ state: disabledState(), notify: notifyCalls(props.notify) }));
    expect(onCleared).toHaveBeenCalledTimes(2);
    expect(button(DETAILS_SHEET_TEXT.editThisRow)).toBeEnabled();
    expect(notifyCalls(props.notify)).toHaveLength(1);
    expect(clearCalls()).toHaveLength(1);
  });

  it('a failed Retry refresh reports the neutral text', async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn().mockRejectedValue(new Error('counts query failed'));
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await user.click(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh }));
    await waitFor(() => expect(notifyCalls(props.notify)).toHaveLength(2));
    console.log('[row details] failed retry', JSON.stringify(notifyCalls(props.notify)));
    expect(notifyCalls(props.notify)[1]).toEqual([VIEW_DATA_TEXT.rowsRefreshFailed, 'error']);
  });

  it('re-fetches the open sheet after clearing a mixed validation + ingestion row and shows only the ingestion error left', async () => {
    const user = userEvent.setup();
    let detailsReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) {
        detailsReads += 1;
        return json(HTTPResponses.OK, detailsReads === 1 ? mixedDetailsBeforeClear : mixedDetailsAfterClear);
      }
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return json(HTTPResponses.OK, { clearedErrorCount: 1 });
      return json(HTTPResponses.OK, {});
    });
    const { props } = renderDetails({ target: target(MIXED_TARGET_ROW) });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(MIXED_ERROR_COUNT))).toBeInTheDocument();
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByText(formatUnresolvedErrorsHeading(REMAINING_ERROR_COUNT))).toBeInTheDocument();
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    const sheet = screen.getByTestId('error-row-details-sheet');
    console.log('[row details] mixed row after clear', JSON.stringify({ detailsReads, notify: notifyCalls(props.notify), text: sheet.textContent }));
    expect(detailsReads).toBe(2);
    const remainingCards = within(sheet).getAllByTestId(ERROR_CARD_TEST_ID);
    expect(remainingCards, 'one card left: the ingestion error').toHaveLength(REMAINING_ERROR_COUNT);
    expect(within(remainingCards[0]).getByText(INGESTION_MESSAGE)).toBeInTheDocument();
    expect(within(remainingCards[0]).getByTestId(INGESTION_SOURCE_CHIP_TEST_ID)).toHaveTextContent(DETAILS_SHEET_TEXT.ingestionChip);
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).not.toBeInTheDocument();
    expect(props.onCleared).toHaveBeenCalledTimes(1);
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_VALIDATION_ERRORS_SUCCESS, 'success']]);
  });

  it('stage 7 F3: an off-page mixed row keeps its last known error status after a Clear, because the ingestion error is still there', async () => {
    const user = userEvent.setup();
    let detailsReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) {
        detailsReads += 1;
        return json(HTTPResponses.OK, detailsReads === 1 ? mixedDetailsBeforeClear : mixedDetailsAfterClear);
      }
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return json(HTTPResponses.OK, { clearedErrorCount: 1 });
      return json(HTTPResponses.OK, {});
    });
    renderDetails({ target: { coreMeasurementID: MEASUREMENT_ID, censusID: ROW_CENSUS_ID, gridRow: null, lastKnownRow: MIXED_TARGET_ROW } });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(MIXED_ERROR_COUNT))).toBeInTheDocument();
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByText(formatUnresolvedErrorsHeading(REMAINING_ERROR_COUNT))).toBeInTheDocument();
    const chipsText = screen.getByTestId(STATUS_CHIPS_TEST_ID).textContent;
    console.log('[row details] off-page mixed row after clear', JSON.stringify({ chipsText, detailsReads }));
    expect(chipsText).not.toContain(VIEW_DATA_TEXT.validationPending);
    expect(screen.getByTestId('view-data-measurement-section')).toBeInTheDocument();
  });

  it('stage 7 F3: an off-page last known row fills the Measurement section and still offers no Edit or Delete', () => {
    renderDetails({
      target: { coreMeasurementID: MEASUREMENT_ID, censusID: ROW_CENSUS_ID, gridRow: null, lastKnownRow: { ...baseRow, measurementStatus: 'passed' } }
    });
    const observed = {
      measurementSection: screen.queryByTestId('view-data-measurement-section') !== null,
      stemStatus: screen.queryByTestId('measurement-field-stemStatus')?.textContent ?? null,
      disabled: disabledState()
    };
    console.log('[row details] off-page last known row', JSON.stringify(observed));
    expect(observed.measurementSection).toBe(true);
    expect(observed.stemStatus).toContain('Alive');
    expect(observed.disabled).toEqual({ edit: true, clear: 'not offered', deleteRow: true });
  });

  it('stage 7 F6: a sheet closed while the grid re-read is pending still posts the outcome and clears the refresh requirement when it ends', async () => {
    const user = userEvent.setup();
    let finishReread: () => void = () => undefined;
    const onCleared = vi.fn(() => new Promise<void>(resolve => (finishReread = resolve)));
    const { props, view } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(notifyCalls(props.notify)).toEqual([]);
    finishReread();
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    console.log(
      '[row details] closed during the re-read',
      JSON.stringify({ notify: notifyCalls(props.notify), refreshStates: (props.onRefreshStateChange as ReturnType<typeof vi.fn>).mock.calls })
    );
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_VALIDATION_ERRORS_SUCCESS, 'success']]);
    expect(props.onRefreshStateChange).toHaveBeenLastCalledWith('current');
  });

  it('stage 7 F6: a sheet closed while the details re-read is pending ends the re-read with the outcome', async () => {
    const user = userEvent.setup();
    let detailsReads = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) {
        detailsReads += 1;
        return detailsReads === 1 ? Promise.resolve(json(HTTPResponses.OK, detailsResponse)) : new Promise<Response>(() => undefined);
      }
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return Promise.resolve(json(HTTPResponses.OK, { clearedErrorCount: 1 }));
      return Promise.resolve(json(HTTPResponses.OK, {}));
    });
    const { props, view } = renderDetails({ target: target({ ...baseRow, measurementStatus: 'unresolvedErrors', unresolvedErrorCount: 1 }) });
    await user.click(await screen.findByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors }));
    await waitFor(() => expect(detailsReads).toBe(2));
    expect(notifyCalls(props.notify)).toEqual([]);
    view.unmount();
    console.log('[row details] closed while awaiting details', JSON.stringify({ detailsReads, notify: notifyCalls(props.notify) }));
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_VALIDATION_ERRORS_SUCCESS, 'success']]);
    expect(props.onRefreshStateChange).toHaveBeenLastCalledWith('current');
  });

  it('stage 7 F6: reports a failed re-read as refresh-required, and a sheet opened while one is required starts locked behind Retry refresh', async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn().mockRejectedValueOnce(new Error('counts query failed')).mockResolvedValueOnce(undefined);
    const first = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
    expect(first.props.onRefreshStateChange).toHaveBeenLastCalledWith('stale');
    first.view.unmount();
    const reopened = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared, refreshState: 'stale' });
    const afterReopen = disabledState();
    console.log('[row details] opened while a re-read is required', JSON.stringify({ afterReopen }));
    expect(afterReopen).toEqual({ edit: true, clear: true, deleteRow: true });
    await user.click(button(VIEW_DATA_TEXT.retryRefresh));
    await waitFor(() => expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).not.toBeInTheDocument());
    expect(reopened.props.onRefreshStateChange).toHaveBeenLastCalledWith('current');
    expect(button(DETAILS_SHEET_TEXT.clearValidationErrors)).toBeEnabled();
  });

  it('stage 7 F6: tells the page a re-read is under way from the moment Clear starts it, not only when it ends', async () => {
    const user = userEvent.setup();
    let finishReread: () => void = () => undefined;
    const onCleared = vi.fn(() => new Promise<void>(resolve => (finishReread = resolve)));
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));
    const reportedWhilePending = (props.onRefreshStateChange as ReturnType<typeof vi.fn>).mock.calls;
    console.log('[row details] refresh states reported while the re-read is pending', JSON.stringify(reportedWhilePending));
    expect(reportedWhilePending).toEqual([['refreshing']]);
    finishReread();
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    expect((props.onRefreshStateChange as ReturnType<typeof vi.fn>).mock.calls).toEqual([['refreshing'], ['current']]);
  });

  it('stage 7 F6: an open sheet follows the page as a re-read it did not start becomes pending, fails and is retried', async () => {
    const user = userEvent.setup();
    const onCleared = vi.fn(async () => undefined);
    const { props, view } = renderDetails({ target: INVALID_NO_LOG_TARGET(), onCleared });
    const observed: Record<string, unknown> = { current: disabledState() };
    view.rerender(<ViewDataRowDetails {...props} refreshState="refreshing" />);
    observed.refreshing = { ...disabledState(), retryOffered: screen.queryByRole('button', { name: VIEW_DATA_TEXT.retryRefresh }) !== null };
    await user.hover(button(DETAILS_SHEET_TEXT.clearValidationErrors).parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(VIEW_DATA_TEXT.refreshingAfterClear);
    view.rerender(<ViewDataRowDetails {...props} refreshState="stale" />);
    observed.stale = { ...disabledState(), retryOffered: screen.queryByRole('button', { name: VIEW_DATA_TEXT.retryRefresh }) !== null };
    view.rerender(<ViewDataRowDetails {...props} refreshState="current" />);
    observed.currentAgain = disabledState();
    console.log('[row details] following the page refresh state', JSON.stringify(observed));
    expect(observed).toEqual({
      current: { edit: false, clear: false, deleteRow: false },
      refreshing: { edit: true, clear: true, deleteRow: true, retryOffered: false },
      stale: { edit: true, clear: true, deleteRow: true, retryOffered: true },
      currentAgain: { edit: false, clear: false, deleteRow: false }
    });
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('P3-2: when the details re-read fails while the grid re-read succeeds, Edit and Delete stay disabled behind Retry refresh and Clear is not offered', async () => {
    const user = userEvent.setup();
    let detailsReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) {
        detailsReads += 1;
        if (detailsReads === 2) return json(HTTPResponses.INTERNAL_SERVER_ERROR, { error: 'details failed' });
        return json(HTTPResponses.OK, detailsReads === 1 ? mixedDetailsBeforeClear : mixedDetailsAfterClear);
      }
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return json(HTTPResponses.OK, { clearedErrorCount: 1 });
      return json(HTTPResponses.OK, {});
    });
    const { props } = renderDetails({ target: target(MIXED_TARGET_ROW) });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(MIXED_ERROR_COUNT))).toBeInTheDocument();
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
    const afterDetailsFailure = disabledState();
    console.log('[row details] details re-read failed', JSON.stringify({ detailsReads, afterDetailsFailure, notify: notifyCalls(props.notify) }));
    expect(props.onCleared).toHaveBeenCalledTimes(1);
    expect(afterDetailsFailure).toEqual({ edit: true, clear: 'not offered', deleteRow: true });
    expect(notifyCalls(props.notify)).toEqual([[VIEW_DATA_TEXT.clearRefreshFailed, 'error']]);
    await user.click(button(VIEW_DATA_TEXT.retryRefresh));
    expect(await screen.findByText(formatUnresolvedErrorsHeading(REMAINING_ERROR_COUNT))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).not.toBeInTheDocument());
    console.log('[row details] after Retry refresh', JSON.stringify({ detailsReads, state: disabledState() }));
    expect(detailsReads).toBe(3);
    expect(button(DETAILS_SHEET_TEXT.editThisRow)).toBeEnabled();
  });

  it('reports a refused clear with the shared failure text and does not re-read', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async () =>
      json(HTTPResponses.LOCKED, { error: 'An upload or validation run is active for this census', code: CLEAR_MEASUREMENT_ERRORS_CODES.scopeBusy })
    );
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET() });
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith(CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE, 'error'));
    expect(props.onCleared).not.toHaveBeenCalled();
  });

  it('R2: a 409 NOTHING_TO_CLEAR from a stale sheet says nothing was left to clear, not the failure text, and re-reads the grid and the sheet once', async () => {
    const user = userEvent.setup();
    const resolvedDetails = { row: null, allErrors: [], relatedRows: [] };
    let detailsReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(DETAILS_URL_PREFIX)) {
        detailsReads += 1;
        return json(HTTPResponses.OK, detailsReads === 1 ? detailsResponse : resolvedDetails);
      }
      if (url === CLEAR_VALIDATION_ERRORS_ENDPOINT) return json(HTTPResponses.CONFLICT, { code: CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear });
      return json(HTTPResponses.OK, {});
    });
    const { props } = renderDetails({
      target: target({
        ...baseRow,
        measurementStatus: 'unresolvedErrors',
        unresolvedErrorCount: 1,
        primaryErrorMessage: STORED_MESSAGE,
        primaryErrorSource: 'validation'
      })
    });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(1))).toBeInTheDocument();
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    await waitFor(() => expect(props.notify).toHaveBeenCalled());
    console.log(
      '[row details] nothing to clear',
      JSON.stringify({
        detailsReads,
        clearCalls: clearCalls().length,
        notify: notifyCalls(props.notify),
        sheet: screen.getByTestId('error-row-details-sheet').textContent
      })
    );
    expect(props.onCleared).toHaveBeenCalledTimes(1);
    expect(detailsReads, 'the stale sheet is read again').toBe(2);
    expect(screen.getByText(DETAILS_SHEET_TEXT.rowResolved)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).not.toBeInTheDocument();
    expect(notifyCalls(props.notify)).toEqual([[CLEAR_NOTHING_TO_CLEAR_MESSAGE, 'error']]);
    expect(clearCalls(), 'never a second clear').toHaveLength(1);
    expect(button(DETAILS_SHEET_TEXT.editThisRow)).toBeEnabled();
  });

  it('confirms a delete inline and respects the delete guard', async () => {
    const user = userEvent.setup();
    const { props } = renderDetails();
    await user.click(button(VIEW_DATA_TEXT.deleteMeasurement));
    expect(screen.getByText(VIEW_DATA_TEXT.deleteConfirmTitle('010203', '1', PAGE_CENSUS_NUMBER))).toBeInTheDocument();
    expect(screen.getByText(VIEW_DATA_TEXT.deleteConfirmBody(PAGE_CENSUS_NUMBER))).toBeInTheDocument();
    await user.click(button(VIEW_DATA_TEXT.deleteKeep));
    expect(screen.queryByText(VIEW_DATA_TEXT.deleteConfirmBody(PAGE_CENSUS_NUMBER))).not.toBeInTheDocument();
    await user.click(button(VIEW_DATA_TEXT.deleteMeasurement));
    await user.click(button(VIEW_DATA_TEXT.deleteConfirm));
    expect(props.onDeleteRow).toHaveBeenCalledWith(MEASUREMENT_ID);
  });

  it('disables Delete while the delete guard is active', () => {
    renderDetails({ isDeleteGuarded: true });
    expect(button(VIEW_DATA_TEXT.deleteMeasurement)).toBeDisabled();
  });

  it('R2-P2-8: with the Delete confirmation open, Clear and Edit this row are disabled with the reason and send nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const { props } = renderDetails({ target: INVALID_NO_LOG_TARGET() });
    await user.click(button(VIEW_DATA_TEXT.deleteMeasurement));
    const clear = button(DETAILS_SHEET_TEXT.clearValidationErrors);
    const observed = { clearDisabled: clear.hasAttribute('disabled'), editDisabled: button(DETAILS_SHEET_TEXT.editThisRow).hasAttribute('disabled') };
    await user.click(clear);
    await user.hover(clear.parentElement as HTMLElement);
    const tooltip = await screen.findByRole('tooltip');
    console.log('[row details] confirmation open', JSON.stringify({ ...observed, tooltip: tooltip.textContent, clearCalls: clearCalls().length }));
    expect(observed).toEqual({ clearDisabled: true, editDisabled: true });
    expect(tooltip).toHaveTextContent(VIEW_DATA_TEXT.deleteInProgress);
    expect(clearCalls()).toHaveLength(0);
    expect(props.onDeleteRow).not.toHaveBeenCalled();
  });

  it('R2-P2-8: an open Delete confirmation collapses when a lock appears, and after a failed clear refresh Delete stays disabled with its reason', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const onCleared = vi.fn().mockRejectedValueOnce(new Error('counts query failed'));
    const props: ViewDataRowDetailsProps = { ...baseProps(), target: INVALID_NO_LOG_TARGET(), onCleared };
    const { rerender } = render(<ViewDataRowDetails {...props} />);
    await user.click(button(VIEW_DATA_TEXT.deleteMeasurement));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(<ViewDataRowDetails {...props} isAnyRowEditing />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const collapsedWhileEditing = {
      confirmButton: screen.queryByRole('button', { name: VIEW_DATA_TEXT.deleteConfirm }),
      deleteDisabled: button(VIEW_DATA_TEXT.deleteMeasurement).hasAttribute('disabled')
    };
    rerender(<ViewDataRowDetails {...props} />);
    await user.click(button(DETAILS_SHEET_TEXT.clearValidationErrors));
    expect(await screen.findByRole('button', { name: VIEW_DATA_TEXT.retryRefresh })).toBeInTheDocument();
    const deleteAfterFailure = button(VIEW_DATA_TEXT.deleteMeasurement);
    await user.click(deleteAfterFailure);
    await user.hover(deleteAfterFailure.parentElement as HTMLElement);
    const tooltip = await screen.findByRole('tooltip');
    console.log(
      '[row details] delete locks',
      JSON.stringify({
        collapsedWhileEditing: { ...collapsedWhileEditing, confirmButton: Boolean(collapsedWhileEditing.confirmButton) },
        deleteDisabled: deleteAfterFailure.hasAttribute('disabled'),
        tooltip: tooltip.textContent,
        confirmOpen: Boolean(screen.queryByRole('alertdialog'))
      })
    );
    expect(collapsedWhileEditing).toEqual({ confirmButton: null, deleteDisabled: true });
    expect(deleteAfterFailure).toBeDisabled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(tooltip).toHaveTextContent(VIEW_DATA_TEXT.refreshBeforeClearing);
    expect(props.onDeleteRow).not.toHaveBeenCalled();
  });

  it('disables Edit this row with the lock tooltip while another row is being edited, and calls onEditRow otherwise', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ViewDataRowDetails {...{ ...baseProps(), isAnyRowEditing: true }} />);
    const locked = button(DETAILS_SHEET_TEXT.editThisRow);
    expect(locked).toBeDisabled();
    await user.hover(locked.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(VIEW_DATA_TEXT.editLockTooltip);
    unmount();
    const onEditRow = vi.fn();
    render(<ViewDataRowDetails {...{ ...baseProps(), onEditRow }} />);
    await user.click(button(DETAILS_SHEET_TEXT.editThisRow));
    expect(onEditRow).toHaveBeenCalledWith(MEASUREMENT_ID);
  });

  it('gives a pending user no Edit, Clear or Delete', () => {
    renderDetails({ canEditRows: false, target: INVALID_NO_LOG_TARGET() });
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.editThisRow })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DETAILS_SHEET_TEXT.clearValidationErrors })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VIEW_DATA_TEXT.deleteMeasurement })).not.toBeInTheDocument();
  });

  it('[D1] builds an off-page related row from details.row, without a Stem status line, and disables Edit with the off-page tooltip', async () => {
    const user = userEvent.setup();
    renderDetails({ target: target(null, MEASUREMENT_ID) });
    expect(await screen.findByText(formatUnresolvedErrorsHeading(1))).toBeInTheDocument();
    const section = screen.getByTestId('view-data-measurement-section');
    expect(within(section).getByText('Acer rubrum')).toBeInTheDocument();
    expect(within(section).queryByTestId('measurement-field-stemStatus')).not.toBeInTheDocument();
    const edit = button(DETAILS_SHEET_TEXT.editThisRow);
    expect(edit).toBeDisabled();
    await user.hover(edit.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(VIEW_DATA_TEXT.offPageRowTooltip);
  });
});
