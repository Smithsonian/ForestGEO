// Regression test for #481: a Save-icon click fired within GridEditInputCell's 200ms
// debounce window used to PATCH the pre-keystroke value. Unlike isolateddatagridcommons.test.tsx,
// this file does NOT mock '@mui/x-data-grid' or '@/config/styleddatagrid' - it renders the
// real MUI DataGrid so the real debounce timer (the actual bug mechanism) is exercised. A
// mocked grid cannot reproduce this: the bug lives inside MUI's own editing-state hook.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

// The component's module-level E2E_DISABLE_VIRTUALIZATION constant is read once at import
// time. It must be true before IsolatedDataGridCommons is imported, or the real DataGrid
// virtualizes rows out of the jsdom DOM and the seeded row never renders.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
});

import IsolatedDataGridCommons from './isolateddatagridcommons';

const mockFetch = vi.fn();
const mockTriggerRefresh = vi.fn();

const ATTRIBUTE_CODE = 'DIR26';
const ORIGINAL_DESCRIPTION = 'Original attribute description';
const EDITED_DESCRIPTION = 'Edited attribute description';
const SEEDED_ROW = { id: 1, code: ATTRIBUTE_CODE, description: ORIGINAL_DESCRIPTION };

const ATTRIBUTE_GRID_COLUMNS = [
  { field: 'id', editable: false },
  { field: 'code', editable: true },
  { field: 'description', editable: true }
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
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
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

function mockAttributesFetch(patchResponse: { changed?: boolean } = { changed: true }) {
  let patchBody: { oldRow: unknown; newRow: Record<string, unknown> } | undefined;
  mockFetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patchBody = JSON.parse(String(init.body));
      return {
        ok: true,
        json: async () => ({ message: 'Update successful', ...patchResponse })
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ output: [SEEDED_ROW], totalCount: 1, finishedQuery: 'SELECT 1 FROM attributes' })
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

async function enterEditModeAndGetDescriptionInput(container: HTMLElement) {
  fireEvent.click(await screen.findByRole('menuitem', { name: EDIT_ACTION_NAME }));

  await waitFor(() => {
    expect(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME })).toBeInTheDocument();
  });

  const input = container.querySelector<HTMLInputElement>('[data-field="description"] input');
  expect(input, 'the description cell must render a real <input> once the row enters edit mode').not.toBeNull();
  return input as HTMLInputElement;
}

describe('IsolatedDataGridCommons - real MUI edit-cell debounce (#481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PATCHes the just-typed value when Save is clicked inside GridEditInputCell's 200ms debounce window", async () => {
    const getPatchBody = mockAttributesFetch({ changed: true });
    const { container } = renderAttributesGrid();

    await waitFor(() => {
      expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeInTheDocument();
    });
    const input = await enterEditModeAndGetDescriptionInput(container);

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

    expect(String(mockFetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0])).toContain('/api/fixeddata/attributes/testschema/code');
    expect(body?.newRow.description, 'a Save click in the same tick as the keystroke must still PATCH the typed value, not the pre-edit value').toBe(
      EDITED_DESCRIPTION
    );
  });

  it('still PATCHes the typed value when Save is clicked well after the debounce window elapses (normal case)', async () => {
    const getPatchBody = mockAttributesFetch({ changed: true });
    const { container } = renderAttributesGrid();

    await waitFor(() => {
      expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeInTheDocument();
    });

    const input = await enterEditModeAndGetDescriptionInput(container);

    fireEvent.change(input, { target: { value: EDITED_DESCRIPTION } });

    // Real timers: let MUI's (now-zero, but this proves the non-regression case regardless
    // of the debounce value) internal timer machinery run its course before saving.
    await new Promise(resolve => setTimeout(resolve, 300));

    fireEvent.click(screen.getByRole('menuitem', { name: SAVE_ACTION_NAME }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const patchCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
    });

    const body = getPatchBody();
    console.log('PATCH body (delayed Save, well past the debounce window):', JSON.stringify(body));

    expect(body?.newRow.description, 'a Save click well after the debounce window must PATCH the typed value').toBe(EDITED_DESCRIPTION);
  }, 10000);
});
