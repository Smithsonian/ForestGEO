import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import MultilineAttributesDataGrid from '@/components/datagrids/applications/multiline/multilineattributesdatagrid';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';

vi.mock('@/lib/db/definitions/views', () => ({
  getAllTaxonomiesViewHCs: () => ({}),
  getAllViewFullTableViewsHCs: () => ({}),
  getMeasurementsSummaryViewHCs: () => ({}),
  getStemTaxonomiesViewHCs: () => ({})
}));
vi.mock('@/lib/db/definitions/zones', () => ({
  getQuadratHCs: () => ({})
}));
vi.mock('@/lib/db/definitions/personnel', () => ({
  getPersonnelHCs: () => ({})
}));
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/definitions/core')>();
  return {
    ...actual,
    getCoreMeasurementsHCs: () => ({}),
    getFailedMeasurementsHCs: () => ({})
  };
});
vi.mock('@/lib/db/definitions/taxonomies', () => ({
  getSpeciesLimitsHCs: () => ({})
}));
vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useOrgCensusContext: () => ({ plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] }),
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));

const NEW_ATTRIBUTE_CODE = 'ATTR100';
const FIRST_EDITABLE_FIELD = 'code';

function getDataRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.MuiDataGrid-row'));
}

function getCodeEditorInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`.MuiDataGrid-row [data-field="${FIRST_EDITABLE_FIELD}"] input`);
}

function describeGridState(): string {
  const rows = getDataRows().map(row => row.textContent);
  return `rows=${JSON.stringify(rows)} codeEditorPresent=${getCodeEditorInput() !== null} activeElement=${document.activeElement?.tagName}`;
}

async function addNewRowAndWaitForEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  await user.click(screen.getByRole('button', { name: /New Row/ }));
  await waitFor(() => expect(getCodeEditorInput(), `code editor never opened: ${describeGridState()}`).not.toBeNull());
  await waitFor(() => expect(document.activeElement, `editor not focused: ${describeGridState()}`).toBe(getCodeEditorInput()));
  return getCodeEditorInput() as HTMLInputElement;
}

describe('IsolatedMultilineDataGridCommons new-row editing (#529)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error');
    render(<MultilineAttributesDataGrid setChangesSubmitted={vi.fn()} setIsSubmittingChanges={vi.fn()} />);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("opens the new row's first editable cell in edit mode with focus, and Enter commits it back to view mode", async () => {
    const user = userEvent.setup();
    const codeInput = await addNewRowAndWaitForEditor(user);
    await user.type(codeInput, `${NEW_ATTRIBUTE_CODE}{enter}`);

    await waitFor(() => expect(getCodeEditorInput(), `cell stayed in edit mode after Enter: ${describeGridState()}`).toBeNull());
    expect(getDataRows(), describeGridState()).toHaveLength(1);
    expect(getDataRows()[0].querySelector(`[data-field="${FIRST_EDITABLE_FIELD}"]`)?.textContent).toBe(NEW_ATTRIBUTE_CODE);
    expect(consoleErrorSpy.mock.calls.map(call => String(call[0]))).toEqual([]);
  });

  it.each(['', NEW_ATTRIBUTE_CODE])('discards a new row with draft code %j using a real click, then opens a fresh editor', async draftCode => {
    const user = userEvent.setup();
    const codeInput = await addNewRowAndWaitForEditor(user);
    if (draftCode) await user.type(codeInput, draftCode);

    await user.click(screen.getByRole('button', { name: /Discard all changes/ }));
    await waitFor(() => expect(getDataRows(), `discarded row still rendered: ${describeGridState()}`).toHaveLength(0));
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();

    const secondCodeInput = await addNewRowAndWaitForEditor(user);
    expect(getDataRows(), describeGridState()).toHaveLength(1);
    expect(secondCodeInput.value, describeGridState()).toBe('');
    await user.type(secondCodeInput, `${NEW_ATTRIBUTE_CODE}{enter}`);
    await waitFor(() => expect(getCodeEditorInput()).toBeNull());
    expect(getDataRows(), describeGridState()).toHaveLength(1);
    expect(getDataRows()[0].querySelector(`[data-field="${FIRST_EDITABLE_FIELD}"]`)?.textContent).toBe(NEW_ATTRIBUTE_CODE);
    expect(consoleErrorSpy.mock.calls.map(call => String(call[0]))).toEqual([]);
  });

  it('restores edits to a saved row while removing an unsaved new row', async () => {
    const user = userEvent.setup();
    const codeInput = await addNewRowAndWaitForEditor(user);
    await user.type(codeInput, `${NEW_ATTRIBUTE_CODE}{enter}`);
    await waitFor(() => expect(getCodeEditorInput()).toBeNull());
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(screen.getByRole('button', { name: /Finalize Changes/ })).toBeEnabled();

    await user.dblClick(getDataRows()[0].querySelector<HTMLElement>(`[data-field="${FIRST_EDITABLE_FIELD}"]`)!);
    await waitFor(() => expect(getCodeEditorInput()).not.toBeNull());
    await user.clear(getCodeEditorInput()!);
    await user.type(getCodeEditorInput()!, 'CHANGED{enter}');
    await waitFor(() => expect(getCodeEditorInput()).toBeNull());

    const newCodeInput = await addNewRowAndWaitForEditor(user);
    await user.type(newCodeInput, 'UNSAVED');
    await user.click(screen.getByRole('button', { name: /Discard all changes/ }));

    await waitFor(() => expect(getDataRows(), describeGridState()).toHaveLength(1));
    expect(getDataRows()[0].querySelector(`[data-field="${FIRST_EDITABLE_FIELD}"]`)?.textContent).toBe(NEW_ATTRIBUTE_CODE);
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Finalize Changes/ })).toBeEnabled();
    expect(consoleErrorSpy.mock.calls.map(call => String(call[0]))).toEqual([]);
  });
});

const BULKCRUD_ENDPOINT = '/api/bulkcrud';
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
const BULKCRUD_FAILURE_MESSAGE = 'Attribute code ATTR100 already exists';

function createDeferredResponse() {
  let resolveResponse: (response: Response) => void = () => {};
  const promise = new Promise<Response>(resolve => {
    resolveResponse = resolve;
  });
  return { promise, resolveResponse };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Manual Input Form while Finalize Changes is in flight (#511)', () => {
  let deferredBulkcrud: ReturnType<typeof createDeferredResponse>;
  let fetchSpy: MockInstance<typeof fetch>;
  let handleCloseManualEntryForm: ReturnType<typeof vi.fn<() => void>>;

  function bulkcrudCallCount(): number {
    return fetchSpy.mock.calls.filter(([input]) => String(input).includes(BULKCRUD_ENDPOINT)).length;
  }

  function describeSubmitState(): string {
    const closeButton = screen.queryByRole('button', { name: 'close' });
    const finalizeButton = screen.queryByRole('button', { name: /Finalize Changes/ });
    return `closeDisabled=${closeButton?.hasAttribute('disabled')} finalizeDisabled=${finalizeButton?.hasAttribute('disabled')} bulkcrudCalls=${bulkcrudCallCount()} closeCalls=${handleCloseManualEntryForm.mock.calls.length}`;
  }

  async function saveOneRowAndFinalize(user: ReturnType<typeof userEvent.setup>) {
    const codeInput = await addNewRowAndWaitForEditor(user);
    await user.type(codeInput, `${NEW_ATTRIBUTE_CODE}{enter}`);
    await waitFor(() => expect(getCodeEditorInput()).toBeNull());
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await user.click(screen.getByRole('button', { name: /Finalize Changes/ }));
  }

  beforeEach(() => {
    deferredBulkcrud = createDeferredResponse();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes(BULKCRUD_ENDPOINT)) return deferredBulkcrud.promise;
      return Promise.resolve(jsonResponse(HTTP_STATUS_OK, {}));
    });
    handleCloseManualEntryForm = vi.fn<() => void>();
    render(<MultilineModal isManualEntryFormOpen handleCloseManualEntryForm={handleCloseManualEntryForm} formType="attributes" />);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('disables Close and Finalize until the submission succeeds, then closes the form once', async () => {
    const user = userEvent.setup();
    await saveOneRowAndFinalize(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'close' }), describeSubmitState()).toBeDisabled());
    expect(screen.getByRole('button', { name: /Finalize Changes/ }), describeSubmitState()).toBeDisabled();
    expect(handleCloseManualEntryForm, describeSubmitState()).not.toHaveBeenCalled();

    await act(async () => deferredBulkcrud.resolveResponse(jsonResponse(HTTP_STATUS_OK, { success: true })));

    await waitFor(() => expect(handleCloseManualEntryForm, describeSubmitState()).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'close' }), describeSubmitState()).toBeEnabled();
  });

  it('re-enables Close and keeps the form open with the server error when the submission fails', async () => {
    const user = userEvent.setup();
    await saveOneRowAndFinalize(user);
    await waitFor(() => expect(screen.getByRole('button', { name: 'close' }), describeSubmitState()).toBeDisabled());

    await act(async () => deferredBulkcrud.resolveResponse(jsonResponse(HTTP_STATUS_INTERNAL_SERVER_ERROR, { error: BULKCRUD_FAILURE_MESSAGE })));

    await waitFor(() => expect(screen.getByRole('button', { name: 'close' }), describeSubmitState()).toBeEnabled());
    expect(screen.getByText(BULKCRUD_FAILURE_MESSAGE), describeSubmitState()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finalize Changes/ }), describeSubmitState()).toBeEnabled();
    expect(handleCloseManualEntryForm, describeSubmitState()).not.toHaveBeenCalled();
  });
});
