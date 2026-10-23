import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpeciesLimitsModal, { SPECIES_LIMITS_SAVE_FAILED_MESSAGE, SPECIES_LIMITS_SAVED_MESSAGE } from './specieslimitsmodal';
import type { SpeciesLimitsRDS, SpeciesRDS } from '@/lib/db/definitions/taxonomies';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

const TEST_SPECIES: SpeciesRDS = { speciesID: 201, speciesName: 'berteriana', speciesCode: 'RUBI04' };
const TEST_LIMITS: SpeciesLimitsRDS[] = [{ speciesLimitID: 1, speciesID: 201, plotID: 1, censusID: 5, limitType: 'DBH', lowerBound: 5, upperBound: 60 }];
const LOWER_LIMIT_LABEL = 'Lower Limit';
const UPPER_LIMIT_LABEL = 'Upper Limit';

const TEST_CONTEXTS = vi.hoisted(() => ({
  site: { schemaName: 'testschema', siteName: 'Test Site' },
  plot: { plotID: 1, plotName: 'Test Plot', defaultDBHUnits: 'cm' },
  census: { plotCensusNumber: 5, dateRanges: [{ censusID: 5 }] }
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => TEST_CONTEXTS.site,
  usePlotContext: () => TEST_CONTEXTS.plot,
  useOrgCensusContext: () => TEST_CONTEXTS.census
}));

function renderSpeciesLimitsModal(
  overrides: { setRefresh?: ReturnType<typeof vi.fn>; handleClose?: ReturnType<typeof vi.fn>; onSaveOutcome?: ReturnType<typeof vi.fn> } = {}
) {
  const setRefresh = overrides.setRefresh ?? vi.fn();
  const handleCloseSpeciesLimitsModal = overrides.handleClose ?? vi.fn();
  const onSaveOutcome = overrides.onSaveOutcome ?? vi.fn();
  render(
    <SpeciesLimitsModal
      openSpeciesLimitsModal
      handleCloseSpeciesLimitsModal={handleCloseSpeciesLimitsModal}
      incomingSpecies={TEST_SPECIES}
      allSpeciesLimits={TEST_LIMITS}
      setRefresh={setRefresh}
      onSaveOutcome={onSaveOutcome}
    />
  );
  return { setRefresh, handleCloseSpeciesLimitsModal, onSaveOutcome };
}

describe('SpeciesLimitsModal - limit inputs (#524 item 4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names each limit input by its visible label', () => {
    renderSpeciesLimitsModal();

    const lowerInput = screen.queryByRole('spinbutton', { name: LOWER_LIMIT_LABEL });
    const upperInput = screen.queryByRole('spinbutton', { name: UPPER_LIMIT_LABEL });
    console.log(
      `[species limits labels] spinbuttons=${JSON.stringify(screen.queryAllByRole('spinbutton').map(input => ({ id: input.id, labelledBy: input.getAttribute('aria-labelledby') })))}`
    );

    expect(lowerInput, 'the lower-limit input must be named "Lower Limit", not by its own id').not.toBeNull();
    expect(upperInput, 'the upper-limit input must be named "Upper Limit", not by its own id').not.toBeNull();
    expect(screen.getByLabelText(LOWER_LIMIT_LABEL)).toBe(lowerInput);
    expect(screen.getByLabelText(UPPER_LIMIT_LABEL)).toBe(upperInput);
  });
});

const EDITED_LOWER_BOUND = 8;
const EDITED_UPPER_BOUND = 70; // inside the initial slider range (-5..110), so the range-reset effect never fires
const SERVER_REJECTION_MESSAGE = 'Species limit rejected by the server';
const HTML_ERROR_PAGE = '<!DOCTYPE html><html><body>Internal Server Error</body></html>';

function editBothLimits() {
  fireEvent.change(screen.getByRole('spinbutton', { name: LOWER_LIMIT_LABEL }), { target: { value: String(EDITED_LOWER_BOUND) } });
  fireEvent.change(screen.getByRole('spinbutton', { name: UPPER_LIMIT_LABEL }), { target: { value: String(EDITED_UPPER_BOUND) } });
}

function expectDraftRetained() {
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', { name: LOWER_LIMIT_LABEL })).toHaveValue(EDITED_LOWER_BOUND);
  expect(screen.getByRole('spinbutton', { name: UPPER_LIMIT_LABEL })).toHaveValue(EDITED_UPPER_BOUND);
}

function jsonResponse(status: HTTPResponses, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SpeciesLimitsModal - save outcome (#524 item 10)', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    expect(alertSpy, 'the modal must never fall back to window.alert').not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('200: reports saved, refreshes, then closes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(HTTPResponses.OK, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { setRefresh, handleCloseSpeciesLimitsModal, onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    console.log(`[species limits 200] outcome=${JSON.stringify(onSaveOutcome.mock.calls)} refresh=${JSON.stringify(setRefresh.mock.calls)}`);
    expect(onSaveOutcome).toHaveBeenCalledWith({ status: 'saved', message: SPECIES_LIMITS_SAVED_MESSAGE });
    expect(setRefresh).toHaveBeenCalledWith(true);
    expect(handleCloseSpeciesLimitsModal).toHaveBeenCalledTimes(1);
  });

  it('500 with a JSON { error } body: reports that text and keeps the dialog and the edited values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(HTTPResponses.INTERNAL_SERVER_ERROR, { error: SERVER_REJECTION_MESSAGE }))
    );
    const { setRefresh, handleCloseSpeciesLimitsModal, onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    console.log(`[species limits 500 json] outcome=${JSON.stringify(onSaveOutcome.mock.calls)}`);
    expect(onSaveOutcome).toHaveBeenCalledWith({ status: 'failed', message: SERVER_REJECTION_MESSAGE });
    expect(setRefresh).not.toHaveBeenCalled();
    expect(handleCloseSpeciesLimitsModal).not.toHaveBeenCalled();
    expectDraftRetained();
  });

  it('500 with an HTML body: reports the fallback message and keeps the edited values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(HTML_ERROR_PAGE, { status: HTTPResponses.INTERNAL_SERVER_ERROR }))
    );
    const { setRefresh, onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    console.log(`[species limits 500 html] outcome=${JSON.stringify(onSaveOutcome.mock.calls)}`);
    expect(onSaveOutcome).toHaveBeenCalledWith({ status: 'failed', message: SPECIES_LIMITS_SAVE_FAILED_MESSAGE });
    expect(setRefresh).not.toHaveBeenCalled();
    expectDraftRetained();
  });

  it('rejected fetch: reports the fallback message, logs the error and keeps the edited values', async () => {
    const networkFailure = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(networkFailure))
    );
    const { setRefresh, onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    console.log(`[species limits rejected] outcome=${JSON.stringify(onSaveOutcome.mock.calls)} logged=${JSON.stringify(vi.mocked(ailogger.error).mock.calls)}`);
    expect(onSaveOutcome).toHaveBeenCalledWith({ status: 'failed', message: SPECIES_LIMITS_SAVE_FAILED_MESSAGE });
    expect(ailogger.error).toHaveBeenCalledWith(expect.any(String), networkFailure);
    expect(setRefresh).not.toHaveBeenCalled();
    expectDraftRetained();
  });

  it('retry: a 500 then a 200 sends the same edited values twice, then closes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(HTTPResponses.INTERNAL_SERVER_ERROR, { error: SERVER_REJECTION_MESSAGE }))
      .mockResolvedValueOnce(jsonResponse(HTTPResponses.OK, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { handleCloseSpeciesLimitsModal, onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(2));

    const sentRows = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).newRow);
    console.log(`[species limits retry] sent newRows=${JSON.stringify(sentRows)} outcomes=${JSON.stringify(onSaveOutcome.mock.calls)}`);
    expect(sentRows).toHaveLength(2);
    expect(sentRows[1]).toEqual(sentRows[0]);
    expect(sentRows[1]).toMatchObject({ lowerBound: EDITED_LOWER_BOUND, upperBound: EDITED_UPPER_BOUND });
    expect(onSaveOutcome).toHaveBeenLastCalledWith({ status: 'saved', message: SPECIES_LIMITS_SAVED_MESSAGE });
    expect(handleCloseSpeciesLimitsModal).toHaveBeenCalledTimes(1);
  });

  it('ignores a second Save click while the first request is in flight, and allows Save again once a failure is reported', async () => {
    let resolveFirstRequest: (response: Response) => void = () => {};
    const firstRequest = new Promise<Response>(resolve => {
      resolveFirstRequest = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(firstRequest).mockResolvedValueOnce(jsonResponse(HTTPResponses.OK, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { onSaveOutcome } = renderSpeciesLimitsModal();

    editBothLimits();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    console.log(`[species limits double click] fetch calls while in flight=${fetchMock.mock.calls.length}`);
    expect(fetchMock, 'a second click during the in-flight save must not send a second request').toHaveBeenCalledTimes(1);

    resolveFirstRequest(jsonResponse(HTTPResponses.INTERNAL_SERVER_ERROR, { error: SERVER_REJECTION_MESSAGE }));
    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaveOutcome).toHaveBeenCalledTimes(2));
    console.log(`[species limits double click] fetch calls after retry=${fetchMock.mock.calls.length}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
