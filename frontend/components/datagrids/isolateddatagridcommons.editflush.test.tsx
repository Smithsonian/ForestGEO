// Regression test for #481: a Save-icon click fired within GridEditInputCell's 200ms
// debounce window used to PATCH the pre-keystroke value. Unlike isolateddatagridcommons.test.tsx,
// this file does NOT mock '@mui/x-data-grid' or '@/config/styleddatagrid' - it renders the
// real MUI DataGrid so the real debounce timer (the actual bug mechanism) is exercised. A
// mocked grid cannot reproduce this: the bug lives inside MUI's own editing-state hook.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { GridColDef, GridPreProcessEditCellProps } from '@mui/x-data-grid';

// The component's module-level E2E_DISABLE_VIRTUALIZATION constant is read once at import
// time. It must be true before IsolatedDataGridCommons is imported, or the real DataGrid
// virtualizes rows out of the jsdom DOM and the seeded row never renders.
// Never unset afterward: vitest.config.mts sets poolOptions.threads.isolate: true, so this
// file's module registry (and this env var) is isolated per file and never leaks to others.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
});

import IsolatedDataGridCommons from './isolateddatagridcommons';
// The real preprocessor wired onto stemLocalX/stemLocalY/measuredDBH/measuredHOM in
// production (components/client/datagridcolumns.tsx ~L559-748, reaching the commons via
// isolatedmsvstagingdatagrid.tsx). Using it here - not a hand-rolled stand-in - is what
// makes the third test below pin the real preProcessEditCellProps codepath.
import { preprocessor } from '@/components/client/datagridcolumns';

const mockFetch = vi.fn();
const mockTriggerRefresh = vi.fn();

const TEST_SCHEMA = 'testschema';
// GridEditInputCell's own default when no debounceMs override is passed (see its L~53
// in node_modules/@mui/x-data-grid/components/cell/GridEditInputCell.js).
const MUI_DEFAULT_EDIT_DEBOUNCE_MS = 200;
// Long enough to clear MUI's default debounce (with headroom) even if a regression
// reintroduced it - this is the "normal", not-fast-clicking case.
const PAST_DEBOUNCE_WAIT_MS = MUI_DEFAULT_EDIT_DEBOUNCE_MS + 100;
// Headroom for the render + PATCH round trip the delayed-save test still has to do after
// its PAST_DEBOUNCE_WAIT_MS real-timer wait, on top of CI-load jitter.
const GRID_RENDER_SLACK_MS = 5000;
const DELAYED_SAVE_TEST_TIMEOUT_MS = PAST_DEBOUNCE_WAIT_MS + GRID_RENDER_SLACK_MS;

const ATTRIBUTE_CODE = 'DIR26';
const ORIGINAL_DESCRIPTION = 'Original attribute description';
const EDITED_DESCRIPTION = 'Edited attribute description';
const SEEDED_ROW = { id: 1, code: ATTRIBUTE_CODE, description: ORIGINAL_DESCRIPTION };

const ATTRIBUTE_GRID_COLUMNS: GridColDef[] = [
  { field: 'id', editable: false },
  { field: 'code', editable: true },
  { field: 'description', editable: true }
];

// Mirrors stemLocalX/measuredDBH/measuredHOM in datagridcolumns.tsx: a `type: 'number'`
// column with a real preProcessEditCellProps validator wired in. The gridType/route
// wiring below is still 'attributes' - a stand-in for isolatedmsvstagingdatagrid.tsx's
// measurementssummary grid, which needs a census context this file's mocks don't set up -
// because the MUI-internal codepath under test (setRowEditingEditCellValue's
// preProcessEditCellProps branch, useGridRowEditing.js ~L494-531) is selected purely by
// this column config, not by gridType.
const ORIGINAL_DBH = 10.5;
const EDITED_DBH = 15.25;
const SEEDED_ROW_WITH_DBH = { ...SEEDED_ROW, measuredDBH: ORIGINAL_DBH };
const ATTRIBUTE_GRID_COLUMNS_WITH_DBH: GridColDef[] = [
  ...ATTRIBUTE_GRID_COLUMNS,
  {
    field: 'measuredDBH',
    headerName: 'DBH',
    editable: true,
    type: 'number',
    preProcessEditCellProps: (params: GridPreProcessEditCellProps) => preprocessor(params)
  }
];

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
  const actual = (await importOriginal()) as any;
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
  useQuadratContext: () => ({ quadratID: undefined }),
  useSiteContext: () => ({ schemaName: TEST_SCHEMA, siteName: 'Test Site' })
}));

vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({ triggerRefresh: mockTriggerRefresh })
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated' })
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}));

vi.mock('@/components/errorboundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock('@/components/client/modals/confirmationdialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        Confirm
      </button>
    ) : null
}));

vi.mock('@/components/client/modals/resetviewmodal', () => ({
  default: () => null
}));

// Kept as a mock (rather than the real modal): its own confirm-button wiring is already
// covered by isolateddatagridcommons.test.tsx, and this file's target is MUI's editing
// state, not the confirmation dialog. Confirming here is a single deterministic click.
vi.mock('@/components/datagrids/skipreentrydatamodal', () => ({
  default: ({ row, handleSave }: { row: Record<string, unknown>; handleSave: (row: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => handleSave(row)}>
      Save Changes
    </button>
  )
}));

vi.mock('@/components/client/datagridelements', () => ({
  EditToolbar: () => <div>Toolbar</div>
}));

vi.mock('@mui/x-data-grid-generator', () => ({
  randomId: () => 'new-row-id'
}));

function renderAttributesGrid() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <IsolatedDataGridCommons
        gridType="attributes"
        gridColumns={ATTRIBUTE_GRID_COLUMNS}
        refresh={false}
        setRefresh={vi.fn()}
        dynamicButtons={[]}
        initialRow={{ code: '', description: '' }}
        onDataUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    </SWRConfig>
  );
}

function renderAttributesGridWithDBHColumn() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <IsolatedDataGridCommons
        gridType="attributes"
        gridColumns={ATTRIBUTE_GRID_COLUMNS_WITH_DBH}
        refresh={false}
        setRefresh={vi.fn()}
        dynamicButtons={[]}
        initialRow={{ code: '', description: '', measuredDBH: 0 }}
        onDataUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    </SWRConfig>
  );
}

function mockAttributesFetch(seedRow: Record<string, unknown>) {
  let patchBody: { oldRow: unknown; newRow: Record<string, unknown> } | undefined;
  mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patchBody = JSON.parse(String(init.body));
      return {
        ok: true,
        json: async () => ({ message: 'Update successful', changed: true })
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ output: [seedRow], totalCount: 1, finishedQuery: 'SELECT 1 FROM attributes' })
    } as Response;
  });
  return () => patchBody;
}

// GridActionsCellItem renders its IconButton with an explicit role="menuitem" (see
// node_modules/@mui/x-data-grid/components/cell/GridActionsCellItem.js), not the
// implicit "button" role a plain <button> would otherwise expose. The MUI Joy Tooltip
// wrapping it in getEnhancedCellAction (isolateddatagridcommons.tsx) also overrides the
// accessible name with its own `title` text ("Edit this row" / "Save your changes"),
// not the shorter `label` ("Edit" / "Save") passed to GridActionsCellItem itself.
const EDIT_ACTION_NAME = 'Edit this row';
const SAVE_ACTION_NAME = 'Save your changes';

async function enterEditModeAndGetCellInput(container: HTMLElement, field: string) {
  fireEvent.click(await screen.findByRole('menuitem', { name: EDIT_ACTION_NAME }));

  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME })).toBeInTheDocument();
  });

  const input = container.querySelector<HTMLInputElement>(`[data-field="${field}"] input`);
  expect(input, `the ${field} cell must render a real <input> once the row enters edit mode`).not.toBeNull();
  return input as HTMLInputElement;
}

describe('IsolatedDataGridCommons - real MUI edit-cell debounce (#481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as any;
  });

  it("PATCHes the just-typed value when Save is clicked inside GridEditInputCell's 200ms debounce window", async () => {
    const getPatchBody = mockAttributesFetch(SEEDED_ROW);
    const { container } = renderAttributesGrid();

    await waitFor(() => {
      expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeInTheDocument();
    });
    const input = await enterEditModeAndGetCellInput(container, 'description');

    // No await, no timer advance between these two calls: this is the user's fast-click
    // window the bug lived in. If MUI's default 200ms debounce is still in effect, the
    // Save click below reads the grid's internal editing state before the keystroke has
    // been written into it.
    fireEvent.change(input, { target: { value: EDITED_DESCRIPTION } });
    fireEvent.click(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
    });

    const body = getPatchBody();
    console.log('PATCH body (fast-click, same tick as the keystroke):', JSON.stringify(body));

    expect(String(mockFetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0])).toContain(`/api/fixeddata/attributes/${TEST_SCHEMA}/code`);
    expect(body?.newRow.description, 'a Save click in the same tick as the keystroke must still PATCH the typed value, not the pre-edit value').toBe(
      EDITED_DESCRIPTION
    );
  });

  it(
    'still PATCHes the typed value when Save is clicked well after the debounce window elapses (normal case)',
    async () => {
      const getPatchBody = mockAttributesFetch(SEEDED_ROW);
      const { container } = renderAttributesGrid();

      await waitFor(() => {
        expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeInTheDocument();
      });

      const input = await enterEditModeAndGetCellInput(container, 'description');

      fireEvent.change(input, { target: { value: EDITED_DESCRIPTION } });

      // Real timers: let MUI's (now-zero, but this proves the non-regression case regardless
      // of the debounce value) internal timer machinery run its course before saving.
      await new Promise(resolve => setTimeout(resolve, PAST_DEBOUNCE_WAIT_MS));

      fireEvent.click(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME }));
      fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
        expect(patchCalls).toHaveLength(1);
      });

      const body = getPatchBody();
      console.log('PATCH body (delayed Save, well past the debounce window):', JSON.stringify(body));

      expect(body?.newRow.description, 'a Save click well after the debounce window must PATCH the typed value').toBe(EDITED_DESCRIPTION);
    },
    DELAYED_SAVE_TEST_TIMEOUT_MS
  );

  it('PATCHes the typed number when Save is clicked on a preProcessEditCellProps column inside the debounce window', async () => {
    // stemLocalX/stemLocalY/measuredDBH/measuredHOM (datagridcolumns.tsx ~L684-748) all
    // wire preProcessEditCellProps: params => preprocessor(params). That column config
    // makes setRowEditingEditCellValue take a DIFFERENT branch than the first test above
    // (useGridRowEditing.js ~L494-531): the typed value is written via
    // updateOrDeleteFieldState inside the `new Promise` executor, ahead of MUI's
    // Promise.resolve(...).then(...) continuation (preprocessor itself is synchronous;
    // MUI is what defers applying its result), instead of the unconditional synchronous
    // write the no-preProcessEditCellProps branch uses. Nothing else in this suite
    // exercises that branch - this pins that it is ALSO fixed by EDIT_CELL_DEBOUNCE_MS=0,
    // not just the plain-column branch.
    const getPatchBody = mockAttributesFetch(SEEDED_ROW_WITH_DBH);
    const { container } = renderAttributesGridWithDBHColumn();

    // Query the gridcell directly rather than screen.getByText(String(ORIGINAL_DBH)):
    // the default numeric colDef (gridNumericColDef.js) formats cell values with
    // Number.prototype.toLocaleString(), which is locale-sensitive and need not match a
    // plain String() of the number. [role="gridcell"] excludes the "DBH" column header,
    // which also carries data-field="measuredDBH".
    await waitFor(() => {
      const dbhCell = container.querySelector('[role="gridcell"][data-field="measuredDBH"]');
      expect(dbhCell, 'the measuredDBH cell must render before editing starts').not.toBeNull();
      expect(dbhCell?.textContent).toBe(ORIGINAL_DBH.toLocaleString());
    });
    const input = await enterEditModeAndGetCellInput(container, 'measuredDBH');

    // Same fast-click shape as the first test: no await, no timer advance, between the
    // keystroke and the Save click.
    fireEvent.change(input, { target: { value: String(EDITED_DBH) } });
    fireEvent.click(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
    });

    const body = getPatchBody();
    console.log('PATCH body (fast-click on a preProcessEditCellProps column):', JSON.stringify(body));

    expect(
      body?.newRow.measuredDBH,
      'a Save click in the same tick as the keystroke must PATCH the typed number even on a preProcessEditCellProps column, not the pre-edit value'
    ).toBe(EDITED_DBH);
  });
});
