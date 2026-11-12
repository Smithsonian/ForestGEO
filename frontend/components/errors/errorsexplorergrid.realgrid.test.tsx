import React, { useCallback, useMemo, useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReadScopeKey,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  EDIT_LOCK_TOOLTIPS,
  type ErrorExplorerFilters,
  type ErrorExplorerRow,
  type ErrorsExplorerReadScope,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import { useErrorsExplorerRowEdit } from '@/app/hooks/useerrorsexplorerrowedit';
import { INFINITE_DEFAULT_CHUNK } from '@/components/datagrids/hooks/useinfinitegridrows';
import ErrorsExplorerGrid, { type ErrorsExplorerGridHandle, type ErrorsExplorerGridModels } from './errorsexplorergrid';
import { buildGroupColumnVisibility } from './errorsexplorercolumns';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const READ_SCOPE: ErrorsExplorerReadScope = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, censusIDs: [5] };
const FACET_A: ErrorTypeFacet = {
  source: 'validation',
  code: '1',
  message: 'DBH growth exceeds maximum rate of 65 mm',
  fields: ['measuredDBH'],
  count: 2,
  hasContradiction: false
};
const FACET_B: ErrorTypeFacet = {
  source: 'validation',
  code: '14',
  message: 'Attribute code does not exist in attributes table',
  fields: ['attributes'],
  count: 1,
  hasContradiction: false
};
const GRID_A = 'group:a';
const GRID_B = 'group:b';
const FLAT_GRID = 'flat';
const FLAT_LABEL = 'Measurement Errors';
const FILTER_DEBOUNCE_MS = 150;
const INFINITY_GLYPH = '∞';

function makeRow(id: number, overrides: Partial<ErrorExplorerRow> = {}): ErrorExplorerRow {
  return {
    id,
    coreMeasurementID: id,
    plotID: 1,
    censusID: 5,
    treeTag: `T${id}`,
    stemTag: '1',
    speciesCode: 'SP1',
    quadratName: 'Q1',
    measurementDate: '2024-06-01',
    measuredDBH: 10,
    measuredHOM: 1.3,
    stemLocalX: 1,
    stemLocalY: 2,
    primaryErrorMessage: FACET_A.message,
    errorMessages: [FACET_A.message],
    errorSources: ['validation'],
    errorFields: ['measuredDBH'],
    errorCodes: ['1'],
    errorCount: 1,
    totalErrorCount: 1,
    hasContradiction: false,
    contradictionTypes: [],
    contradictionType: null,
    contradictionGroupKey: null,
    relatedMeasurementIDs: [],
    isFailedRow: false,
    priorDBH: null,
    dbhChangePercent: null,
    ...overrides
  } as ErrorExplorerRow;
}

const ROWS_BY_CODE: Record<string, ErrorExplorerRow[]> = { '1': [makeRow(101), makeRow(102)], '14': [makeRow(201, { errorCodes: ['14'] })] };

function queryBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/api/errors/explorer/query'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function Harness({
  canEditRows = true,
  canEditSpeciesCode = false,
  filters = DEFAULT_ERROR_EXPLORER_FILTERS,
  onModelsChangeSpy
}: {
  canEditRows?: boolean;
  canEditSpeciesCode?: boolean;
  filters?: ErrorExplorerFilters;
  onModelsChangeSpy?: (gridKey: string, models: ErrorsExplorerGridModels) => void;
}) {
  const grids = useRef(new Map<string, ErrorsExplorerGridHandle>());
  const readScopeKey = buildReadScopeKey(READ_SCOPE);
  const rowEdit = useErrorsExplorerRowEdit({
    readScope: READ_SCOPE,
    readScopeKey,
    refreshAllReads: async () => {
      await Promise.allSettled([...grids.current.values()].map(grid => grid.refresh()));
    },
    patchRowEverywhere: row => grids.current.forEach(grid => grid.patchRow(row)),
    showPageAlert: () => undefined
  });
  const [models, setModels] = useState<Record<string, ErrorsExplorerGridModels>>({
    [GRID_A]: { sortModel: [], filterModel: { items: [] }, columnVisibilityModel: buildGroupColumnVisibility(FACET_A) },
    [GRID_B]: { sortModel: [], filterModel: { items: [] }, columnVisibilityModel: buildGroupColumnVisibility(FACET_B) }
  });
  const register = useCallback((gridKey: string, handle: ErrorsExplorerGridHandle | null) => {
    if (handle) grids.current.set(gridKey, handle);
    else grids.current.delete(gridKey);
  }, []);
  const common = useMemo(
    () => ({
      variant: 'group' as const,
      readScope: READ_SCOPE,
      readScopeKey,
      filters,
      canEditRows,
      canEditSpeciesCode,
      codeOptions: [],
      censusList: undefined,
      rowEdit,
      onOpenDetails: () => undefined,
      registerGrid: register,
      errorLabelFor: (row: ErrorExplorerRow) => row.errorMessages[0] ?? ''
    }),
    [readScopeKey, filters, canEditRows, canEditSpeciesCode, rowEdit, register]
  );
  return (
    <>
      {[
        [GRID_A, FACET_A],
        [GRID_B, FACET_B]
      ].map(([gridKey, facet]) => (
        <section key={gridKey as string} aria-label={`grid ${gridKey as string}`}>
          <ErrorsExplorerGrid
            {...common}
            gridKey={gridKey as string}
            ariaLabel={`${(facet as ErrorTypeFacet).code} rows`}
            errorType={facet as ErrorTypeFacet}
            faultedFieldsFor={() => new Set((facet as ErrorTypeFacet).fields)}
            models={models[gridKey as string]}
            onModelsChange={next => {
              onModelsChangeSpy?.(gridKey as string, next);
              setModels(previous => ({ ...previous, [gridKey as string]: next }));
            }}
          />
        </section>
      ))}
    </>
  );
}

/** One flat grid; `gated` stands in for the row-edit hook's pending-rebuild gate so the grid's own gating is what runs. */
function FlatHarness({ gated }: { gated: boolean }) {
  const readScopeKey = buildReadScopeKey(READ_SCOPE);
  const realRowEdit = useErrorsExplorerRowEdit({
    readScope: READ_SCOPE,
    readScopeKey,
    refreshAllReads: async () => undefined,
    patchRowEverywhere: () => undefined,
    showPageAlert: () => undefined
  });
  const rowEdit = { ...realRowEdit, isReadScopeGated: gated };
  const [models, setModels] = useState<ErrorsExplorerGridModels>({ sortModel: [], filterModel: { items: [] }, columnVisibilityModel: {} });
  return (
    <ErrorsExplorerGrid
      gridKey={FLAT_GRID}
      ariaLabel={FLAT_LABEL}
      variant="flat"
      readScope={READ_SCOPE}
      readScopeKey={readScopeKey}
      filters={DEFAULT_ERROR_EXPLORER_FILTERS}
      models={models}
      onModelsChange={setModels}
      canEditRows
      canEditSpeciesCode={false}
      codeOptions={[]}
      faultedFieldsFor={() => new Set()}
      errorLabelFor={row => row.primaryErrorMessage}
      censusList={undefined}
      rowEdit={rowEdit}
      onOpenDetails={() => undefined}
      registerGrid={() => undefined}
    />
  );
}

/** customgridpagination.test.tsx's way into the ∞ option of the rows-per-page select. */
async function switchFlatGridToInfinite() {
  const sizeButtons = screen.getAllByLabelText('Rows per page');
  const sizeButton = sizeButtons[sizeButtons.length - 1];
  fireEvent.mouseDown(sizeButton);
  fireEvent.click(sizeButton);
  const options = await screen.findAllByRole('option');
  const infinite = options.find(option => option.textContent?.includes(INFINITY_GLYPH));
  if (!infinite) throw new Error(`No ${INFINITY_GLYPH} option. Options: ${options.map(option => option.textContent).join(', ')}`);
  fireEvent.click(infinite);
}

function grid(label: string) {
  return within(screen.getByRole('grid', { name: label }));
}

function cell(label: string, rowID: number, field: string): HTMLElement {
  const row = screen.getByRole('grid', { name: label }).querySelector(`[data-id="${rowID}"]`);
  const found = row?.querySelector(`[data-field="${field}"]`);
  if (!found) throw new Error(`No cell ${field} in row ${rowID} of ${label}`);
  return found as HTMLElement;
}

describe('ErrorsExplorerGrid with the real DataGrid', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/errors/explorer/query')) {
        const body = JSON.parse(String(init?.body));
        const rows = ROWS_BY_CODE[body.errorType?.code ?? '1'] ?? [];
        return new Response(JSON.stringify({ rows, totalRows: rows.length }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('opens a row by double-click and by Enter for an editor (P1-2)', async () => {
    render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    fireEvent.doubleClick(cell('1 rows', 101, 'treeTag'));
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag').querySelector('input')).not.toBeNull());
    fireEvent.keyDown(cell('1 rows', 101, 'treeTag'), { key: 'Escape' });
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag').querySelector('input')).toBeNull());
    act(() => cell('1 rows', 102, 'treeTag').focus());
    fireEvent.keyDown(cell('1 rows', 102, 'treeTag'), { key: 'Enter' });
    await waitFor(() => expect(cell('1 rows', 102, 'treeTag').querySelector('input')).not.toBeNull());
  });

  it('opens nothing for a read-only user, whose Actions column shows only Details', async () => {
    render(<Harness canEditRows={false} />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    fireEvent.doubleClick(cell('1 rows', 101, 'treeTag'));
    expect(cell('1 rows', 101, 'treeTag').querySelector('input')).toBeNull();
    const actions = within(cell('1 rows', 101, 'actions'))
      .getAllByRole('menuitem')
      .map(item => item.getAttribute('aria-label'));
    console.log('[view-errors real grid read-only actions]', JSON.stringify(actions));
    expect(actions).toEqual(['Details']);
  });

  it("keeps a non-admin's Species read-only while the row is open", async () => {
    render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    fireEvent.doubleClick(cell('1 rows', 101, 'treeTag'));
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag').querySelector('input')).not.toBeNull());
    expect(cell('1 rows', 101, 'speciesCode').querySelector('input')).toBeNull();
  });

  it('refuses a second row in another grid while one is open, with the lock tooltip on its Edit', async () => {
    render(<Harness />);
    await waitFor(() => expect(cell('14 rows', 201, 'treeTag')).toBeInTheDocument());
    await userEvent.click(within(cell('1 rows', 101, 'actions')).getByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag').querySelector('input')).not.toBeNull());
    fireEvent.doubleClick(cell('14 rows', 201, 'treeTag'));
    expect(cell('14 rows', 201, 'treeTag').querySelector('input')).toBeNull();
    const otherEdit = within(cell('14 rows', 201, 'actions')).getByRole('menuitem', { name: 'Edit' });
    expect(otherEdit).toHaveAttribute('aria-disabled', 'true');
    expect(otherEdit).toHaveAttribute('title', EDIT_LOCK_TOOLTIPS.editing);
  });

  it('sends a header sort and a column-menu filter to the server with page 0 (D-a)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    fetchMock.mockClear();
    await user.click(grid('1 rows').getByRole('columnheader', { name: /Tree Tag/ }));
    await waitFor(() => expect(queryBodies(fetchMock).at(-1)?.sortModel).toEqual([{ field: 'treeTag', sort: 'asc' }]));
    expect(queryBodies(fetchMock).at(-1)?.page).toBe(0);
    await user.click(grid('1 rows').getByRole('button', { name: 'Tree Tag column menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Filter/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Value' }), 'T10');
    await waitFor(() => expect(queryBodies(fetchMock).at(-1)?.columnFilters).toEqual([{ field: 'treeTag', operator: 'contains', value: 'T10' }]), {
      timeout: FILTER_DEBOUNCE_MS * 10
    });
    expect(queryBodies(fetchMock).at(-1)?.page).toBe(0);
  });

  it('sends Prior DBH "is empty" without a value and Change "> 20" with a number (P2-10)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, 'priorDBH')).toBeInTheDocument());
    await user.click(grid('1 rows').getByRole('button', { name: 'Prior DBH column menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Filter/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Operator' }));
    await user.click(await screen.findByRole('option', { name: 'is empty' }));
    await waitFor(() => expect(queryBodies(fetchMock).at(-1)?.columnFilters).toEqual([{ field: 'priorDBH', operator: 'isEmpty' }]));
    await user.keyboard('{Escape}');
    await user.click(grid('1 rows').getByRole('button', { name: 'Change column menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Filter/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Operator' }));
    await user.click(await screen.findByRole('option', { name: '>' }));
    await user.type(await screen.findByRole('spinbutton', { name: 'Value' }), '20');
    await waitFor(() => expect(queryBodies(fetchMock).at(-1)?.columnFilters).toEqual([{ field: 'dbhChangePercent', operator: '>', value: 20 }]), {
      timeout: FILTER_DEBOUNCE_MS * 10
    });
  });

  it('renders a column-menu button on every visible header, and the Actions menu has no Hide, sort or filter item (P2-11)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    const headers = grid('1 rows').getAllByRole('columnheader');
    for (const header of headers)
      expect(within(header).queryByRole('button', { name: /column menu$/ }), header.getAttribute('data-field') ?? '').not.toBeNull();
    await user.click(grid('1 rows').getByRole('button', { name: 'Actions column menu' }));
    const items = (await screen.findAllByRole('menuitem')).map(item => item.textContent);
    console.log('[view-errors actions menu]', JSON.stringify(items));
    expect(items.some(text => /Hide/.test(text ?? ''))).toBe(false);
    expect(items.some(text => /Sort|Filter/.test(text ?? ''))).toBe(false);
    expect(items.some(text => /Manage columns/.test(text ?? ''))).toBe(true);
  });

  it('removes sort and filter from the owning grid while locked, closes an open filter panel, and ignores API filter changes (P2-15)', async () => {
    const user = userEvent.setup();
    const modelsChanged = vi.fn();
    render(<Harness onModelsChangeSpy={modelsChanged} />);
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag')).toBeInTheDocument());
    await user.click(grid('1 rows').getByRole('button', { name: 'Tree Tag column menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Filter/ }));
    expect(await screen.findByRole('textbox', { name: 'Value' }), 'the filter panel is open right before the edit starts').toBeVisible();
    fireEvent.doubleClick(cell('1 rows', 101, 'treeTag'));
    await waitFor(() => expect(cell('1 rows', 101, 'treeTag').querySelector('input')).not.toBeNull());
    expect(screen.queryByRole('textbox', { name: 'Value' }), 'the filter panel closed when the lock started').toBeNull();
    await user.hover(within(grid('1 rows').getByRole('columnheader', { name: /Tree Tag/ })).getByText('Tree Tag'));
    expect(await screen.findByRole('tooltip'), 'MUI shows the description as the header title tooltip').toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
    await user.unhover(within(grid('1 rows').getByRole('columnheader', { name: /Tree Tag/ })).getByText('Tree Tag'));
    await user.click(grid('1 rows').getByRole('button', { name: 'Tree Tag column menu' }));
    const items = (await screen.findAllByRole('menuitem')).map(item => item.textContent ?? '');
    expect(items.some(text => /Sort|Filter/.test(text))).toBe(false);
    expect(items.some(text => /Hide|Manage columns/.test(text))).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByTestId(`errors-grid-${GRID_A}`).querySelector('[data-testid="custom-grid-pagination"]')).toHaveAttribute(
      'title',
      EDIT_LOCK_TOOLTIPS.editing
    );
    const gridApi = (window as unknown as { __errorsGridApi?: Record<string, { setFilterModel: (model: unknown) => void } | undefined> }).__errorsGridApi?.[
      GRID_A
    ];
    expect(gridApi, 'the test-only grid API handle for the owning grid').toBeDefined();
    fetchMock.mockClear();
    modelsChanged.mockClear();
    act(() => {
      gridApi!.setFilterModel({ items: [{ field: 'treeTag', operator: 'contains', value: 'x' }] });
    });
    await new Promise(resolve => setTimeout(resolve, FILTER_DEBOUNCE_MS * 2));
    console.log('[view-errors locked api filter]', JSON.stringify({ queries: queryBodies(fetchMock), modelsChanged: modelsChanged.mock.calls }));
    expect(queryBodies(fetchMock), 'no query while the owning grid is locked').toHaveLength(0);
    expect(modelsChanged, 'the locked grid reports no model change').not.toHaveBeenCalled();
    expect((cell('1 rows', 101, 'treeTag').querySelector('input') as HTMLInputElement).value, 'the typed values are still in the row').toBe('T101');
  });

  it.each([
    ['a fixed-width column', 'measuredDBH'],
    ['a flex column', 'treeTag']
  ])('keeps the resized width of %s when the page re-renders with a new columns array', async (_columnKind, resizedField) => {
    const RESIZED_WIDTH = 333;
    const SEARCH_THAT_RERENDERS = 'T';
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(cell('1 rows', 101, resizedField)).toBeInTheDocument());
    const api = (
      window as unknown as {
        __errorsGridApi: Record<
          string,
          { setColumnWidth: (field: string, width: number) => void; getColumn: (field: string) => { width?: number; flex?: number; computedWidth: number } }
        >;
      }
    ).__errorsGridApi[GRID_A];
    const columnBefore = api.getColumn(resizedField);
    const widthBefore = columnBefore.computedWidth;
    const flexBefore = columnBefore.flex;

    act(() => api.setColumnWidth(resizedField, RESIZED_WIDTH));
    await waitFor(() => expect(api.getColumn(resizedField).width).toBe(RESIZED_WIDTH));

    rerender(<Harness filters={{ ...DEFAULT_ERROR_EXPLORER_FILTERS, quickSearch: SEARCH_THAT_RERENDERS }} />);
    await waitFor(() => expect(queryBodies(fetchMock).at(-1)?.filters.quickSearch).toBe(SEARCH_THAT_RERENDERS));
    await waitFor(() => expect(cell('1 rows', 101, resizedField)).toBeInTheDocument());

    const columnAfter = api.getColumn(resizedField);
    console.log(
      `[errors grid] ${resizedField} before resize: computedWidth ${widthBefore}, flex ${flexBefore}; after re-render: ` +
        `computedWidth ${columnAfter.computedWidth}, width ${columnAfter.width}, flex ${columnAfter.flex} (resized to ${RESIZED_WIDTH})`
    );
    expect(widthBefore, 'the default width differs from the resized one, so the assertion below can fail').not.toBe(RESIZED_WIDTH);
    expect(columnAfter.computedWidth).toBe(RESIZED_WIDTH);
  });

  it('gates the flat infinite reads: drops an in-flight response, sends nothing while gated, reads once when the gate lifts (P2-2, A3)', async () => {
    const user = userEvent.setup();
    const heldInfiniteReads: Array<(rows: ErrorExplorerRow[]) => void> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/api/errors/explorer/query')) return new Response('{}', { status: 200 });
      const body = JSON.parse(String(init?.body));
      if (body.pageSize !== INFINITE_DEFAULT_CHUNK)
        return new Response(JSON.stringify({ rows: ROWS_BY_CODE['1'], totalRows: ROWS_BY_CODE['1'].length }), { status: 200 });
      return new Promise<Response>(resolve => {
        heldInfiniteReads.push(rows => resolve(new Response(JSON.stringify({ rows, totalRows: rows.length }), { status: 200 })));
      });
    });
    const { rerender } = render(<FlatHarness gated={false} />);
    await waitFor(() => expect(cell(FLAT_LABEL, 101, 'treeTag')).toBeInTheDocument());
    await switchFlatGridToInfinite();
    await waitFor(() => expect(heldInfiniteReads).toHaveLength(1));

    rerender(<FlatHarness gated />);
    await act(async () => heldInfiniteReads[0]([makeRow(901)]));
    const flatGrid = screen.getByRole('grid', { name: FLAT_LABEL });
    console.log(
      '[view-errors flat gate in-flight]',
      JSON.stringify({ rowIDs: Array.from(flatGrid.querySelectorAll('[data-id]'), row => row.getAttribute('data-id')) })
    );
    expect(flatGrid.querySelector('[data-id="901"]'), 'a response that lands after the gate closed is dropped').toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry loading more rows' }), 'a gated read is not an infinite load failure').toBeNull();

    fetchMock.mockClear();
    await user.click(grid(FLAT_LABEL).getByRole('columnheader', { name: /Tree Tag/ }));
    await new Promise(resolve => setTimeout(resolve, FILTER_DEBOUNCE_MS * 2));
    console.log('[view-errors flat gate gated]', JSON.stringify({ queries: queryBodies(fetchMock), held: heldInfiniteReads.length }));
    expect(queryBodies(fetchMock), 'no request of any kind while gated, a sort included').toHaveLength(0);
    expect(heldInfiniteReads).toHaveLength(1);

    rerender(<FlatHarness gated={false} />);
    await waitFor(() => expect(heldInfiniteReads).toHaveLength(2));
    const infiniteBodies = queryBodies(fetchMock).filter(body => body.pageSize === INFINITE_DEFAULT_CHUNK);
    console.log('[view-errors flat gate lift]', JSON.stringify(infiniteBodies));
    expect(infiniteBodies, 'lifting the gate re-reads the infinite list once').toHaveLength(1);
    expect(infiniteBodies[0].sortModel).toEqual([{ field: 'treeTag', sort: 'asc' }]);
    await act(async () => heldInfiniteReads[1]([makeRow(902)]));
    await waitFor(() => expect(cell(FLAT_LABEL, 902, 'treeTag')).toBeInTheDocument());
  });
});
