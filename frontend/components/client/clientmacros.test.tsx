import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { loadSelectableOptions, selectableAutocomplete } from './clientmacros';

const { getMapperSpy } = vi.hoisted(() => ({
  getMapperSpy: vi.fn(() => ({
    mapData: (rows: any[]) => rows
  }))
}));

vi.mock('@/config/datamapper', () => ({
  default: { getMapper: getMapperSpy }
}));

describe('loadSelectableOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes selectable option strings before storing autocomplete options', async () => {
    const fetchMock = vi.fn(async (endpoint: string) => {
      let rows: any[] = [];
      if (endpoint.includes('/api/fetchall/attributes/')) {
        rows = [{ code: 'A1' }, { code: 'A1' }];
      } else if (endpoint.includes('/api/fetchall/trees/')) {
        rows = [{ treeTag: 'T1' }, { treeTag: 'T1' }];
      } else if (endpoint.includes('/api/fetchall/stems/')) {
        rows = [{ stemTag: 'S1' }, { stemTag: 'S1' }];
      } else if (endpoint.includes('/api/fetchall/quadrats/')) {
        rows = [{ quadratName: 'Q1' }, { quadratName: 'Q1' }];
      } else if (endpoint.includes('/api/fetchall/species/')) {
        rows = [{ speciesCode: 'CRATSN' }, { speciesCode: 'CRATSN' }, { speciesCode: 'RUBI04' }];
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const previousOptions = { treeTag: [], stemTag: [], quadratName: [], speciesCode: [], codes: [] };
    let nextOptions = previousOptions;
    const setSelectableOpts = vi.fn((updater: (prev: typeof previousOptions) => typeof previousOptions) => {
      nextOptions = updater(previousOptions);
    });

    await loadSelectableOptions({ schemaName: 'myschema' } as any, { plotID: 42 } as any, { plotCensusNumber: 3 } as any, setSelectableOpts as any);

    expect(nextOptions).toMatchObject({
      treeTag: ['T1'],
      stemTag: ['S1'],
      quadratName: ['Q1'],
      speciesCode: ['CRATSN', 'RUBI04'],
      codes: ['A1']
    });
  });
});

// #481 follow-up (Opus review finding A3): the autocomplete editor's onChange used to
// only commit truthy values, so clearing a cell (clear indicator, or emptying a
// freeSolo input) never reached MUI's editing state. The row silently kept its old
// value, producing an empty diff and a false "Row successfully updated!" toast. These
// tests pin the fixed commit semantics directly against the real @mui/joy Autocomplete,
// not a mock, since the bug lived in how its onChange reasons ('clear' / null) were
// filtered.
describe('selectableAutocomplete', () => {
  function buildParams(overrides: { id?: number; field?: string; value?: any } = {}) {
    const setEditCellValue = vi.fn();
    const params = {
      id: overrides.id ?? 1,
      field: overrides.field ?? 'spCode',
      value: overrides.value,
      api: { setEditCellValue }
    };
    return { params, setEditCellValue };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('single-value freeSolo field (e.g. spCode)', () => {
    const column = { field: 'spCode' } as GridColDef;
    const selectableOpts = { speciesCode: ['DEMO26', 'OTHER'] };

    it('commits "" when the clear indicator is clicked', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      // The clear indicator button is rendered but `visibility: hidden` (via ownerState.focused)
      // until the field is focused - matching the real editing flow, where a cell is only
      // active once it has focus.
      fireEvent.focus(input);
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'spCode', value: '' });
    });

    it('commits "" (not the deleted partial text) when the input is emptied and blurred', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      const { rerender } = render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'DEMO26X' } });
      fireEvent.change(input, { target: { value: '' } });
      // Model the grid's controlled value flow: the row's editing state (and so
      // `params.value`) only updates once the grid re-renders the editor with the
      // just-committed value, before the field is blurred.
      rerender(selectableAutocomplete({ ...params, value: '' }, column, selectableOpts));
      fireEvent.blur(input);

      expect(setEditCellValue).not.toHaveBeenCalledWith({ id: 1, field: 'spCode', value: 'DEMO26X' });
      // The FINAL commit, not merely any commit in the sequence, must be '' - a later
      // call overwriting it (e.g. a resurrected suggestion) must fail this assertion.
      expect(setEditCellValue).toHaveBeenLastCalledWith({ id: 1, field: 'spCode', value: '' });
    });

    // #481 follow-up round 2 (Codex review): MUI's own blur handler auto-selects
    // whichever option `autoHighlight` left highlighted - even for an empty query -
    // whenever the popup happens to be open (e.g. because the cell was clicked into,
    // which opens it), regardless of whether the visible input reads empty. This only
    // reproduces once the popup is genuinely open before the clear - a plain
    // fireEvent.change without a preceding mousedown never opens it.
    it('commits "" - not a highlighted suggestion resurrected on blur - after the popup is opened and the input is cleared', () => {
      const { params, setEditCellValue } = buildParams({ value: 'TYPO26' });
      const singleOptionOpts = { speciesCode: ['DEMO26'] };
      const { rerender } = render(selectableAutocomplete(params, column, singleOptionOpts));
      const input = screen.getByRole('combobox');

      // A real mousedown-driven click opens the popup and lets autoHighlight point at
      // the sole option; a plain `fireEvent.change` alone never opens it.
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: '' } });
      // Model the grid's controlled value flow, exactly like the previous test.
      rerender(selectableAutocomplete({ ...params, value: '' }, column, singleOptionOpts));
      fireEvent.blur(input);

      expect(setEditCellValue).toHaveBeenLastCalledWith({ id: 1, field: 'spCode', value: '' });
      expect(setEditCellValue).not.toHaveBeenLastCalledWith({ id: 1, field: 'spCode', value: 'DEMO26' });
    });

    // Codex review diagnostic: a real DataGrid feeds the just-committed value straight
    // back in as `params.value` on the same render pass, not via a manually-triggered
    // `rerender` in a later test tick. This harness models that controlled round-trip
    // so the assertion can check the visible input text, not only the committed
    // payload - the two diverged under the pre-fix implementation (payload '', display
    // still showing the resurrected option).
    it('clears both the committed value and the visible input after the popup is opened, cleared, and blurred', () => {
      const commit = vi.fn();

      function Harness() {
        const [value, setValue] = React.useState('DEMO26');
        const params = {
          id: 1,
          field: 'spCode',
          value,
          api: {
            setEditCellValue: (p: any) => {
              commit(p);
              setValue(p.value);
            }
          }
        };
        return selectableAutocomplete(params, column, selectableOpts);
      }

      render(<Harness />);
      const input = screen.getByRole('combobox');

      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      expect(commit).toHaveBeenLastCalledWith({ id: 1, field: 'spCode', value: '' });
      expect(input).toHaveValue('');
    });

    it('retains an explicitly selected option after a prior clear (resets the stale clear marker)', () => {
      const commit = vi.fn();

      function Harness() {
        const [value, setValue] = React.useState('DEMO26');
        const params = {
          id: 1,
          field: 'spCode',
          value,
          api: {
            setEditCellValue: (p: any) => {
              commit(p);
              setValue(p.value);
            }
          }
        };
        return selectableAutocomplete(params, column, selectableOpts);
      }

      render(<Harness />);
      const input = screen.getByRole('combobox');

      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(screen.getByRole('option', { name: 'OTHER' }));
      fireEvent.blur(input);

      expect(commit).toHaveBeenLastCalledWith({ id: 1, field: 'spCode', value: 'OTHER' });
      expect(input).toHaveValue('OTHER');
    });

    it('commits the option value when an option is selected (regression)', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'OTHER' } });
      fireEvent.click(screen.getByRole('option', { name: 'OTHER' }));

      expect(setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'spCode', value: 'OTHER' });
    });

    it('commits a typed freeSolo value on blur (regression)', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'NEWVAL' } });
      fireEvent.blur(input);

      expect(setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'spCode', value: 'NEWVAL' });
    });

    it('never commits mid-typing partial text', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'NEW' } });

      expect(setEditCellValue).not.toHaveBeenCalled();
    });

    it('does not re-commit when the value prop resets after a prior commit (no feedback loop)', () => {
      const { params, setEditCellValue } = buildParams({ value: 'DEMO26' });
      const { rerender } = render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'OTHER' } });
      fireEvent.click(screen.getByRole('option', { name: 'OTHER' }));
      expect(setEditCellValue).toHaveBeenCalledTimes(1);

      // Simulate the grid feeding the just-committed value back in as `params.value`,
      // the way MUI re-renders the edit cell after `setEditCellValue`. Joy's Autocomplete
      // fires onInputChange (not onChange) with reason 'reset' when this happens - it must
      // not cause another setEditCellValue call.
      rerender(selectableAutocomplete({ ...params, value: 'OTHER' }, column, selectableOpts));

      expect(setEditCellValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple codes field', () => {
    const column = { field: 'codes' } as GridColDef;
    const selectableOpts = { codes: ['A', 'B', 'C'] };

    it('commits the remaining ";"-joined string when a chip is removed, and "" when the last chip is removed', () => {
      const { params, setEditCellValue } = buildParams({ field: 'codes', value: 'A;B' });
      const { rerender } = render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      // Backspace on an empty search input removes the last chip - this is the same
      // gesture MUI's own Autocomplete uses for tag deletion via the keyboard. The
      // `value` prop is controlled by the grid (params.value), so - just like the real
      // grid re-rendering the editor after `setEditCellValue` - the test must feed the
      // committed value back in before the next chip-removal gesture is exercised.
      fireEvent.keyDown(input, { key: 'Backspace' });
      expect(setEditCellValue).toHaveBeenLastCalledWith({ id: 1, field: 'codes', value: 'A' });

      rerender(selectableAutocomplete({ ...params, value: 'A' }, column, selectableOpts));
      fireEvent.keyDown(input, { key: 'Backspace' });
      expect(setEditCellValue).toHaveBeenLastCalledWith({ id: 1, field: 'codes', value: '' });
    });

    it('never commits a partial search string typed into the codes input', () => {
      const { params, setEditCellValue } = buildParams({ field: 'codes', value: 'A' });
      render(selectableAutocomplete(params, column, selectableOpts));
      const input = screen.getByRole('combobox');

      fireEvent.change(input, { target: { value: 'B' } });

      expect(setEditCellValue).not.toHaveBeenCalled();
    });
  });
});
