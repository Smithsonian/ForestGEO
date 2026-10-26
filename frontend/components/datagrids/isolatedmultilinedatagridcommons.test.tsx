import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MultilineAttributesDataGrid from '@/components/datagrids/applications/multiline/multilineattributesdatagrid';

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
    render(<MultilineAttributesDataGrid setChangesSubmitted={vi.fn()} />);
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
