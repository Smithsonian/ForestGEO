import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeasurementsGridHarness } from './measurementscommons.harness';
import { ALL_TREE_STEM_STATES, STEM_STATE_LABELS, VIEW_DATA_COLUMN_HEADERS, VIEW_DATA_SORTABLE_FIELDS, VIEW_DATA_TEXT } from '@/config/viewdata';
import { HTTPResponses } from '@/config/macros';

const faultBuilds = vi.hoisted(() => ({ calls: 0 }));

const ctx = vi.hoisted(() => {
  const noop = () => undefined;
  return {
    plot: { plotID: 1, plotName: 'Test Plot' },
    census: { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] },
    site: { schemaName: 'testschema', siteName: 'Test Site' },
    loading: { setLoading: noop },
    session: { data: { user: { userStatus: 'field crew' } }, status: 'authenticated' },
    router: { push: noop, replace: noop },
    editPreviewFlow: {
      beginEdit: async () => undefined,
      confirmDialog: async () => undefined,
      cancelDialog: noop,
      cancelPendingOperation: () => 'none' as const,
      dialogState: { open: false, plan: null, busy: false, wasRefreshed: false }
    }
  };
});

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ctx.plot,
  useOrgCensusContext: () => ctx.census,
  useOrgCensusListContext: () => [{ plotCensusNumber: 1, censusIDs: [1] }],
  useSiteContext: () => ctx.site
}));
vi.mock('@/app/contexts/loadingprovider', () => ({ useLoading: () => ctx.loading }));
vi.mock('next-auth/react', () => ({ useSession: () => ctx.session }));
vi.mock('next/navigation', () => ({ useRouter: () => ctx.router }));
vi.mock('@/config/viewdata', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/viewdata')>();
  return {
    ...actual,
    buildRowFieldFaults: (...args: Parameters<typeof actual.buildRowFieldFaults>) => {
      faultBuilds.calls += 1;
      return actual.buildRowFieldFaults(...args);
    }
  };
});
vi.mock('@/config/datamapper', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/timekeeping', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/validations', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/admin', async importOriginal => importOriginal());
vi.mock('@/components/client/clientmacros', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/client/clientmacros')>()),
  loadSelectableOptions: async () => undefined,
  getSelectableOptionsForField: () => []
}));
vi.mock('@/app/hooks/useEditPreviewFlow', async importOriginal => ({
  ...(await importOriginal<typeof import('@/app/hooks/useEditPreviewFlow')>()),
  useEditPreviewFlow: () => ctx.editPreviewFlow
}));
vi.mock('@/components/datagrids/skipreentrydatamodal', () => ({ default: () => <div role="dialog" aria-label="Save confirmation" /> }));

const { MeasurementsSummaryViewGridColumns } = await import('@/components/client/datagridcolumns');

const ROW = {
  id: 1,
  coreMeasurementID: 501,
  censusID: 1,
  treeTag: '010203',
  stemTag: '1',
  speciesCode: 'ACRU',
  speciesName: 'Acer rubrum',
  quadratName: '0102',
  stemLocalX: 1.5,
  stemLocalY: 2.5,
  stemPlotX: 11.5,
  stemPlotY: 12.5,
  measuredDBH: 12.5,
  measuredHOM: 1.3,
  measurementDate: '2024-06-15',
  attributes: 'A',
  description: 'note',
  userDefinedFields: 'old tree',
  measurementStatus: 'passed',
  stemStatuses: 'alive'
};
const SECOND_ROW = { ...ROW, id: 2, coreMeasurementID: 502, treeTag: '010204' };
const EXPECTED_ENTER_WALK = [
  'stemTag',
  'speciesCode',
  'quadratName',
  'stemLocalX',
  'stemLocalY',
  'measuredDBH',
  'measuredHOM',
  'measurementDate',
  'attributes',
  'actions'
];
const ROW_HEIGHT_STYLE = '44px';
const NEXT_MACROTASK_MS = 0;
// One snapshot before the validation-error read lands and one after it replaces the faults.
const FAULT_SNAPSHOTS_PER_ROW = 2;
const ATTRIBUTES_QUERY_MARKER = '.attributes;';
const ATTRIBUTE_ROWS = [{ Code: 'A' }, { Code: 'B' }];
// MUI's actions cell renders its items as menu items, not buttons.
const ACTION_ITEM_ROLE = 'menuitem';

function respond(body: unknown): Response {
  return { ok: true, status: HTTPResponses.OK, json: async () => body } as Response;
}

const cellOf = (rowIndex: number, field: string) =>
  document.querySelector(`.MuiDataGrid-row[data-rowindex="${rowIndex}"] [data-field="${field}"]`) as HTMLElement;
const cell = (field: string) => cellOf(0, field);
const focusedField = () => (document.activeElement?.closest('[data-field]') as HTMLElement | null)?.getAttribute('data-field');

async function renderRealGrid(userStatus: string, rows: Array<Record<string, unknown>> = [ROW]) {
  ctx.session.data.user.userStatus = userStatus;
  render(
    <div style={{ width: 2400, height: 600 }}>
      <MeasurementsGridHarness initialRows={rows} gridColumns={MeasurementsSummaryViewGridColumns} />
    </div>
  );
  await waitFor(() => expect(document.querySelector('.MuiDataGrid-row')).not.toBeNull());
}

let currentRows: Array<Record<string, unknown>> = [ROW];
let stemStateFilterRequests: number[] = [];
let quadratFilterRequests: number[] = [];
const FILTER_SETTLE_MS = 600;

describe('MeasurementsCommons on the real DataGrid', () => {
  beforeEach(() => {
    currentRows = [ROW];
    stemStateFilterRequests = [];
    quadratFilterRequests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/fixeddatafilter/')) {
          const requestedFilter = JSON.parse(String(init?.body ?? '{}')).filterModel;
          const isStemStateFiltered = (requestedFilter?.tss?.length ?? ALL_TREE_STEM_STATES.length) < ALL_TREE_STEM_STATES.length;
          stemStateFilterRequests.push(isStemStateFiltered ? 1 : 0);
          const isQuadratFiltered = (requestedFilter?.items ?? []).some((item: { field: string }) => item.field === 'quadratName');
          quadratFilterRequests.push(isQuadratFiltered ? 1 : 0);
          if (isQuadratFiltered) return respond({ output: [{ ...ROW, quadratName: '' }], totalCount: 1 });
          return isStemStateFiltered ? respond({ output: [], totalCount: 0 }) : respond({ output: currentRows, totalCount: currentRows.length });
        }
        if (url.startsWith('/api/validations/validationerrordisplay')) return respond({ failed: [] });
        if (url === '/api/query') return respond(String(init?.body ?? '').includes(ATTRIBUTES_QUERY_MARKER) ? ATTRIBUTE_ROWS : [{ CountValid: 1 }]);
        return respond({});
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.census = { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] };
  });

  it('field crew: Actions first, Edit and Details per row, Tree Tag opens on double-click, Species does not', async () => {
    const user = userEvent.setup();
    await renderRealGrid('field crew');
    const headers = Array.from(document.querySelectorAll('[role="columnheader"]')).map(header => header.getAttribute('data-field'));
    console.log('[real grid] headers', JSON.stringify(headers));
    expect(headers[0]).toBe('actions');
    expect(
      within(document.querySelector('[role="columnheader"][data-field="actions"]') as HTMLElement).getByText(VIEW_DATA_TEXT.actionsHeader)
    ).toBeInTheDocument();
    expect(screen.getByRole(ACTION_ITEM_ROLE, { name: VIEW_DATA_TEXT.editRow })).toBeInTheDocument();
    expect(screen.getByRole(ACTION_ITEM_ROLE, { name: VIEW_DATA_TEXT.detailsFor('010203', '1') })).toBeInTheDocument();
    await user.dblClick(cell('speciesCode'));
    expect(cell('speciesCode').querySelector('input')).toBeNull();
    await user.dblClick(cell('treeTag'));
    await waitFor(() => expect(cell('treeTag').querySelector('input')).not.toBeNull());
  });

  it('puts no aria-pressed on the row action menu items, before or after the details sheet opens (axe aria-allowed-attr)', async () => {
    const user = userEvent.setup();
    await renderRealGrid('field crew');
    const detailsItem = screen.getByRole(ACTION_ITEM_ROLE, { name: VIEW_DATA_TEXT.detailsFor('010203', '1') });
    const actionItemsBeforeOpen = screen.getAllByRole(ACTION_ITEM_ROLE);
    console.log('[real grid] action items before open', JSON.stringify(actionItemsBeforeOpen.map(item => item.getAttributeNames())));
    for (const item of actionItemsBeforeOpen) expect(item.getAttributeNames(), `${item.getAttribute('aria-label')} before open`).not.toContain('aria-pressed');
    await user.click(detailsItem);
    await screen.findByTestId('error-row-details-sheet');
    console.log('[real grid] Details item after open', JSON.stringify(detailsItem.getAttributeNames()));
    expect(detailsItem.getAttributeNames(), 'Details after the sheet opened').not.toContain('aria-pressed');
  });

  it('pending: a Details-only column and no way into edit mode', async () => {
    const user = userEvent.setup();
    await renderRealGrid('pending');
    expect(
      within(document.querySelector('[role="columnheader"][data-field="actions"]') as HTMLElement).getByText(VIEW_DATA_TEXT.detailsHeader)
    ).toBeInTheDocument();
    expect(screen.queryByRole(ACTION_ITEM_ROLE, { name: VIEW_DATA_TEXT.editRow })).not.toBeInTheDocument();
    await user.dblClick(cell('treeTag'));
    expect(cell('treeTag').querySelector('input')).toBeNull();
  });

  it('one-row lock (A23): while row 1 is edited, double-clicking or typing into row 2 opens no editor', async () => {
    const user = userEvent.setup();
    currentRows = [ROW, SECOND_ROW];
    await renderRealGrid('field crew', currentRows);
    await user.dblClick(cellOf(0, 'treeTag'));
    await waitFor(() => expect(cellOf(0, 'treeTag').querySelector('input')).not.toBeNull());
    await user.dblClick(cellOf(1, 'treeTag'));
    const afterDoubleClick = {
      row1Editing: Boolean(cellOf(0, 'treeTag').querySelector('input')),
      row2Editor: Boolean(cellOf(1, 'treeTag').querySelector('input'))
    };
    cellOf(1, 'stemTag').focus();
    await user.keyboard('7');
    const afterTyping = { row2StemTagEditor: Boolean(cellOf(1, 'stemTag').querySelector('input')), row2StemTagText: cellOf(1, 'stemTag').textContent };
    console.log('[real grid] one-row lock', JSON.stringify({ afterDoubleClick, afterTyping }));
    expect(afterDoubleClick).toEqual({ row1Editing: true, row2Editor: false });
    expect(afterTyping).toEqual({ row2StemTagEditor: false, row2StemTagText: '1' });
  });

  it('global: Enter walks the visible editable cells in column order, then Save, then opens the save confirmation', async () => {
    const user = userEvent.setup();
    await renderRealGrid('global');
    await user.dblClick(cell('treeTag'));
    await waitFor(() => expect(cell('treeTag').querySelector('input')).not.toBeNull());
    const walk: Array<string | null | undefined> = [];
    for (let step = 0; step < EXPECTED_ENTER_WALK.length; step++) {
      await user.keyboard('{Enter}');
      await waitFor(() => expect(focusedField()).toBe(EXPECTED_ENTER_WALK[step]));
      walk.push(focusedField());
    }
    console.log('[real grid] enter walk', JSON.stringify(walk));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Save confirmation' })).toBeInTheDocument();
  });

  it('Codes editor: Enter picks the highlighted option while its list is open, and walks on to Actions once it is closed', async () => {
    const user = userEvent.setup();
    await renderRealGrid('global');
    await user.dblClick(cell('treeTag'));
    await waitFor(() => expect(cell('attributes').querySelector('input')).not.toBeNull());
    await user.click(cell('attributes').querySelector('input') as HTMLElement);
    await user.keyboard('{ArrowDown}');
    const listWasOpen = await screen.findByRole('listbox');
    expect(within(listWasOpen).getByRole('option', { name: 'B' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const afterPick = { focusedField: focusedField(), chips: Array.from(cell('attributes').querySelectorAll('.MuiChip-root')).map(chip => chip.textContent) };
    console.log('[real grid] codes editor after picking with Enter', JSON.stringify(afterPick));
    expect(afterPick).toEqual({ focusedField: 'attributes', chips: ['A', 'B'] });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(focusedField()).toBe('actions'));
  });

  it("builds a row's field faults once per row, not once per cell", async () => {
    faultBuilds.calls = 0;
    await renderRealGrid('field crew');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/validations/validationerrordisplay'))).toBe(true));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, NEXT_MACROTASK_MS));
    });
    const renderedDataCells = document.querySelectorAll('.MuiDataGrid-row [role="gridcell"]:not([data-field="actions"])').length;
    console.log('[real grid] field fault builds', JSON.stringify({ builds: faultBuilds.calls, renderedDataCells }));
    expect(renderedDataCells).toBeGreaterThan(FAULT_SNAPSHOTS_PER_ROW);
    expect(faultBuilds.calls).toBeLessThanOrEqual(FAULT_SNAPSHOTS_PER_ROW);
  });

  it('A25 (covers Task 19): a census change with the Save Changes confirmation open leaves no row in edit mode on the real grid', async () => {
    const user = userEvent.setup();
    const grid = () => (
      <div style={{ width: 2400, height: 600 }}>
        <MeasurementsGridHarness initialRows={[ROW]} gridColumns={MeasurementsSummaryViewGridColumns} />
      </div>
    );
    ctx.session.data.user.userStatus = 'field crew';
    const { rerender } = render(grid());
    await waitFor(() => expect(document.querySelector('.MuiDataGrid-row')).not.toBeNull());
    await user.dblClick(cell('treeTag'));
    await waitFor(() => expect(cell('treeTag').querySelector('input')).not.toBeNull());
    await user.click(screen.getByRole(ACTION_ITEM_ROLE, { name: VIEW_DATA_TEXT.saveRow }));
    expect(await screen.findByRole('dialog', { name: 'Save confirmation' })).toBeInTheDocument();
    ctx.census = { plotCensusNumber: 2, dateRanges: [{ censusID: 2 }] };
    rerender(grid());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save confirmation' })).not.toBeInTheDocument());
    // Let MUI's processRowUpdate continuation (useGridRowEditing.js:452-458) run before looking.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, NEXT_MACROTASK_MS));
    });
    const observed = {
      editingRows: document.querySelectorAll('.MuiDataGrid-row--editing').length,
      treeTagEditor: Boolean(cell('treeTag')?.querySelector('input'))
    };
    console.log('[real grid] after a census change with the save confirmation open', JSON.stringify(observed));
    expect(observed).toEqual({ editingRows: 0, treeTagEditor: false });
  });

  it('a filter that matches no rows keeps its filter item and shows the no-match overlay', async () => {
    const user = userEvent.setup();
    await renderRealGrid('field crew');
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.filtersButton }));
    const panel = await waitFor(() => {
      const found = document.querySelector('.MuiDataGrid-panel') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const valueSelect = within(panel).getAllByRole('combobox').at(-1) as HTMLElement;
    await user.click(valueSelect);
    await user.click(await screen.findByRole('option', { name: STEM_STATE_LABELS['old tree'] }));
    await waitFor(() => expect(stemStateFilterRequests.some(count => count > 0)).toBe(true), { timeout: 3000 });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, FILTER_SETTLE_MS));
    });
    const observed = {
      stemStateFilterRequests: [...stemStateFilterRequests],
      filterCountChip: screen.queryByTestId('view-data-filter-count')?.textContent ?? null,
      overlay: screen.queryByTestId('view-data-empty-state')?.textContent ?? null,
      headers: Array.from(document.querySelectorAll('[role="columnheader"]')).map(header => header.getAttribute('data-field'))
    };
    console.log('[real grid] a filter with no matching rows', JSON.stringify(observed));
    expect(observed.filterCountChip).toBe('1');
    expect(observed.overlay).toContain(VIEW_DATA_TEXT.emptyFiltered);
    expect(observed.headers).toEqual(expect.arrayContaining(['stemState', 'treeTag', 'speciesCode', 'measuredDBH']));
    expect(stemStateFilterRequests.at(-1)).toBe(1);
  });

  it('a filter whose own column is blank on every returned row keeps that column and its filter item', async () => {
    const user = userEvent.setup();
    await renderRealGrid('field crew');
    await user.click(screen.getByRole('button', { name: VIEW_DATA_TEXT.filtersButton }));
    const panel = await waitFor(() => {
      const found = document.querySelector('.MuiDataGrid-panel') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const [fieldSelect, operatorSelect] = within(panel).getAllByRole('combobox');
    await user.click(fieldSelect);
    await user.click(await screen.findByRole('option', { name: VIEW_DATA_COLUMN_HEADERS.quadratName }));
    await user.click(operatorSelect);
    await user.click(await screen.findByRole('option', { name: 'is empty' }));
    await waitFor(() => expect(quadratFilterRequests.some(count => count > 0)).toBe(true), { timeout: 3000 });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, FILTER_SETTLE_MS));
    });
    const observed = {
      quadratFilterRequests: [...quadratFilterRequests],
      filterCountChip: screen.queryByTestId('view-data-filter-count')?.textContent ?? null,
      headers: Array.from(document.querySelectorAll('[role="columnheader"]')).map(header => header.getAttribute('data-field')),
      rowCount: document.querySelectorAll('.MuiDataGrid-row').length
    };
    console.log('[real grid] a filter on a column that is blank in every returned row', JSON.stringify(observed));
    expect(observed.filterCountChip).toBe('1');
    expect(observed.headers).toContain('quadratName');
    expect(quadratFilterRequests.at(-1)).toBe(1);
    expect(observed.rowCount).toBe(1);
  });

  it('shows a column-menu button on every visible sortable header and none on Actions', async () => {
    await renderRealGrid('field crew');
    const observed = Array.from(document.querySelectorAll('[role="columnheader"]')).map(header => ({
      field: header.getAttribute('data-field'),
      hasMenu: Boolean(header.querySelector('.MuiDataGrid-menuIcon button'))
    }));
    console.log('[real grid] header menus', JSON.stringify(observed));
    for (const header of observed) {
      if ((VIEW_DATA_SORTABLE_FIELDS as readonly string[]).includes(header.field ?? '')) expect(header).toEqual({ field: header.field, hasMenu: true });
    }
    expect(observed.find(header => header.field === 'actions')?.hasMenu).toBe(false);
  });

  it('renders 44 px rows with one line of text per data cell', async () => {
    await renderRealGrid('field crew');
    const row = document.querySelector('.MuiDataGrid-row') as HTMLElement;
    expect(row.style.minHeight).toBe(ROW_HEIGHT_STYLE);
    const multiLineCells = Array.from(row.querySelectorAll('[role="gridcell"]'))
      .filter(gridCell => gridCell.getAttribute('data-field') !== 'attributes' && gridCell.getAttribute('data-field') !== 'measurementStatus')
      .filter(gridCell => gridCell.querySelectorAll('p').length > 1)
      .map(gridCell => gridCell.getAttribute('data-field'));
    expect(multiLineCells).toEqual([]);
  });
});
