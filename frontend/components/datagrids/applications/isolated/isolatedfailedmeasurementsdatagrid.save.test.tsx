import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import IsolatedFailedMeasurementsDataGrid from './isolatedfailedmeasurementsdatagrid';
import { NO_CHANGES_SAVED_MESSAGE } from '@/components/datagrids/isolateddatagridcommons';

const mocks = vi.hoisted(() => {
  // The commons grid reads this flag at module evaluation time. Keeping all columns
  // mounted makes the real MUI editing assertions deterministic under jsdom.
  const originalE2ETesting = process.env.NEXT_PUBLIC_E2E_TESTING;
  process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
  return {
    triggerRefresh: vi.fn(),
    originalE2ETesting
  };
});

const originalWindowStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
const originalGlobalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const originalBoundingRectDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 26, plotName: 'Rehearsal Plot' }),
  useOrgCensusContext: () => ({ plotCensusNumber: 7, dateRanges: [{ censusID: 19, startDate: '2020-01-01', endDate: '2020-12-31' }] }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing', siteName: 'Test Site' }),
  useQuadratContext: () => undefined
}));

vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({ triggerRefresh: mocks.triggerRefresh })
}));

// setup.ts installs lightweight platform mocks for database definitions. Restore
// the real definition exports because the grid's column visibility map calls them
// while importing the real commons component.
vi.mock('@/lib/db/definitions/views', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => await importOriginal());
vi.mock('@/lib/db/definitions/core', async importOriginal => await importOriginal());

// platform-mocks replaces the mapper factory with a sites-only stub. The real
// autocomplete loader also maps attributes, trees, stems, quadrats, and species;
// preserve their fields for this focused UI harness.
vi.mock('@/config/datamapper', () => ({
  default: {
    getMapper: () => ({
      mapData: (rows: unknown[]) => rows,
      demapData: (rows: unknown[]) => rows
    })
  }
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated' })
}));

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

// These are layout-only decorations. The DataGrid itself remains the real MUI grid.
vi.mock('@/components/client/datagridelements', () => ({ EditToolbar: () => null }));
vi.mock('@/components/datagrids/customgridpagination', () => ({
  default: () => null,
  DEFAULT_PAGE_SIZE_OPTIONS: [50],
  getPersistedGridPageSize: () => 50
}));
vi.mock('@/components/datagrids/infinitegridscrollbridge', () => ({ default: () => null }));
vi.mock('@/components/loading', () => ({
  LoadingBar: () => null,
  ContentSkeleton: () => <div data-testid="grid-skeleton" />
}));
vi.mock('@/components/errorboundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

type FailedRow = {
  id: string;
  failedMeasurementID: number;
  plotID: number;
  censusID: number;
  tag: string;
  stemTag: string;
  spCode: string;
  quadrat: string;
  date: string;
  codes: string;
  dbh: number;
  hom: number;
  x: number;
  y: number;
  description: string;
  failureReasons: string;
  originalFailureReasons: string;
  currentFailureReasons: string;
  lastValidatedAt: null;
};

const originalRow: FailedRow = {
  id: 'failed-row-D26027',
  failedMeasurementID: 48027,
  plotID: 26,
  censusID: 19,
  tag: 'D26027',
  stemTag: '2',
  spCode: 'TYPO26',
  quadrat: '0101',
  date: '2020-06-15',
  codes: 'M',
  dbh: 12.34,
  hom: 1.25,
  x: 8.5,
  y: 12.75,
  description: 'Invalid species code: "TYPO26"',
  failureReasons: 'SpCode invalid',
  originalFailureReasons: 'SpCode invalid',
  currentFailureReasons: 'SpCode invalid',
  lastValidatedAt: null
};

const correctedRow: FailedRow = { ...originalRow, spCode: 'DEMO26', failureReasons: '', currentFailureReasons: '' };

const infoEffect = {
  id: 'species-correction',
  severity: 'info' as const,
  category: 'field' as const,
  title: 'Species correction',
  detail: 'Updates the failed measurement species code.',
  affectedTable: 'failedmeasurements',
  affectedRowCount: 1
};

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as Response;
}

function makePreview(planOverrides: Record<string, unknown> = {}) {
  return {
    dataType: 'failedmeasurements',
    targetID: originalRow.failedMeasurementID,
    fieldChanges: [{ field: 'spCode', from: 'TYPO26', to: 'DEMO26' }],
    effects: [infoEffect],
    maxSeverity: 'warn',
    canApply: true,
    planHash: 'plan-hash-480',
    generatedAt: '2026-09-15T00:00:00.000Z',
    ...planOverrides
  };
}

// `row` defaults to the module-level `originalRow` fixture; pass an arbitrary row for
// scenarios whose failure-reason/rounding math depends on values (e.g. a valid spCode,
// or a >2-decimal persisted dbh/x) that `originalRow` doesn't carry. `onFollowUpFetch`
// lets a single, narrowly-targeted request fail *after* a real mutation (apply/reingest)
// already succeeded, for finalization-partial-save coverage, without disturbing every
// other request the harness serves.
function installNetwork({
  row = originalRow,
  preview = response(makePreview()),
  apply = response({
    updatedIDs: { failedmeasurements: row.failedMeasurementID },
    applyErrors: [],
    editOperationID: 48001,
    validationPending: false
  }),
  refetchedRow = row === originalRow ? correctedRow : row,
  removeOnReingest = false
}: {
  row?: FailedRow;
  preview?: Response | Response[];
  apply?: Response | Response[];
  refetchedRow?: FailedRow;
  removeOnReingest?: boolean;
} = {}) {
  let applied = false;
  let reingested = false;
  let previewAttempt = 0;
  let applyAttempt = 0;
  const fetchSpy = vi.mocked(globalThis.fetch);
  fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/api/edits/preview')) {
      const selectedPreview = Array.isArray(preview) ? preview[Math.min(previewAttempt, preview.length - 1)] : preview;
      previewAttempt += 1;
      return selectedPreview;
    }
    if (url.includes('/api/edits/apply')) {
      const selectedApply = Array.isArray(apply) ? apply[Math.min(applyAttempt, apply.length - 1)] : apply;
      applyAttempt += 1;
      if (selectedApply.ok) applied = true;
      return selectedApply;
    }
    if (url.includes('/api/reingestsinglefailure/')) {
      reingested = true;
      return response({ message: 'reingested' });
    }
    if (url.includes('/api/fetchall/attributes/')) return response([{ code: 'M' }]);
    if (url.includes('/api/fetchall/trees/')) return response([{ treeTag: row.tag }]);
    if (url.includes('/api/fetchall/stems/')) return response([{ stemTag: row.stemTag }]);
    if (url.includes('/api/fetchall/quadrats/')) return response([{ quadratName: '0101' }, { quadratName: '0202' }]);
    if (url.includes('/api/fetchall/species/')) return response([{ speciesCode: 'DEMO26' }]);
    if (url.includes('/api/fixeddata/failedmeasurements/') && method === 'GET') {
      if (removeOnReingest && reingested) return response({ output: [], totalCount: 0, finishedQuery: 'SELECT no remaining failed rows' });
      return response({ output: [applied ? refetchedRow : row], totalCount: 1, finishedQuery: 'SELECT failed row' });
    }
    if (url.includes('/api/fixeddatafilter/')) return response({ output: [refetchedRow], totalCount: 1, finishedQuery: 'SELECT failed row' });

    throw new Error(`Unexpected network request: ${method} ${url}`);
  });

  return { wasReingested: () => reingested };
}

function fetchCalls(): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return vi.mocked(globalThis.fetch).mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
}

function renderGrid(network?: Parameters<typeof installNetwork>[0], componentProps?: React.ComponentProps<typeof IsolatedFailedMeasurementsDataGrid>) {
  // setup.ts's auth mock owns global fetch and resets it in its beforeEach hook;
  // install the scenario after those hooks have completed, immediately before mount.
  const handle = installNetwork(network);
  render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <LocalizationProvider dateAdapter={AdapterMoment}>
        <div style={{ width: 4200, height: 720 }}>
          <IsolatedFailedMeasurementsDataGrid {...componentProps} />
        </div>
      </LocalizationProvider>
    </SWRConfig>
  );
  return handle;
}

function getDataRow() {
  return screen.getByRole('row', { name: /D26027/ });
}

async function enterSpeciesAndOpenSave({ selectSuggestion = true }: { selectSuggestion?: boolean } = {}) {
  const user = userEvent.setup();
  const row = getDataRow();
  await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
  await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

  const speciesInput = within(row).getAllByRole('combobox')[2] as HTMLInputElement;
  await user.click(speciesInput);
  await user.clear(speciesInput);
  await user.type(speciesInput, 'DEMO26');
  if (selectSuggestion) {
    await waitFor(() => expect(screen.getByRole('option', { name: 'DEMO26' })).toBeInTheDocument());
    await user.click(screen.getByRole('option', { name: 'DEMO26' }));
  } else {
    // Exercise the freeSolo typed-input path: MUI commits the typed value when
    // focus leaves the species editor without selecting an option.
    await user.tab();
    await waitFor(() => expect(speciesInput).toHaveValue('DEMO26'));
  }

  // These values are observed from the real row editor before confirmation. They
  // catch MUI row assembly/preprocessing dropping unchanged values.
  expect(within(row).getAllByRole('combobox')[0]).toHaveValue('D26027');
  expect(within(row).getAllByRole('combobox')[1]).toHaveValue('2');
  expect(within(row).getAllByRole('combobox')[2]).toHaveValue('DEMO26');
  expect(within(row).getAllByRole('combobox')[3]).toHaveValue('0101');
  // The codes editor is a multiple autocomplete: its input is intentionally
  // empty while the existing code remains rendered as a chip.
  expect(within(row).getByText('M')).toBeInTheDocument();

  const xInput = row.querySelector('[data-field="x"] input') as HTMLInputElement | null;
  const yInput = row.querySelector('[data-field="y"] input') as HTMLInputElement | null;
  const dateInput = row.querySelector('[data-field="date"] input') as HTMLInputElement | null;
  expect(xInput).not.toBeNull();
  expect(yInput).not.toBeNull();
  expect(dateInput).not.toBeNull();
  expect(xInput?.value).toBe('8.50');
  expect(yInput?.value).toBe('12.75');
  expect(dateInput?.value).toMatch(/2020/);

  await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
  await user.click(await screen.findByRole('button', { name: 'Save Changes' }));
  return user;
}

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = TestResizeObserver;
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  HTMLElement.prototype.getBoundingClientRect = function () {
    const width = Number.parseFloat(this.style.width) || 5000;
    const height = Number.parseFloat(this.style.height) || 600;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };

  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear(),
    key: index => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    }
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});

afterAll(() => {
  const restoreDescriptor = (target: object, property: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else delete (target as Record<string, unknown>)[property];
  };
  restoreDescriptor(window, 'localStorage', originalWindowStorageDescriptor);
  restoreDescriptor(globalThis, 'localStorage', originalGlobalStorageDescriptor);
  restoreDescriptor(globalThis, 'ResizeObserver', originalResizeObserverDescriptor);
  restoreDescriptor(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
  restoreDescriptor(HTMLElement.prototype, 'getBoundingClientRect', originalBoundingRectDescriptor);
  if (mocks.originalE2ETesting === undefined) delete process.env.NEXT_PUBLIC_E2E_TESTING;
  else process.env.NEXT_PUBLIC_E2E_TESTING = mocks.originalE2ETesting;
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
});

describe('failed measurement correction with the real MUI grid', () => {
  it.each([
    { field: 'spCode', canonicalField: 'SpCode', value: 'DEMO26', mode: 'selection' },
    { field: 'spCode', canonicalField: 'SpCode', value: 'NEW26', mode: 'typed blur' },
    { field: 'quadrat', canonicalField: 'Quadrat', value: '0202', mode: 'selection' },
    { field: 'quadrat', canonicalField: 'Quadrat', value: '0303', mode: 'typed blur' }
  ])('saves the latest $field via $mode when Save immediately follows the autocomplete commit (#481)', async ({ field, canonicalField, value, mode }) => {
    const persistedRow = { ...originalRow, [field]: value };
    renderGrid({
      preview: response(makePreview({ fieldChanges: [{ field, from: originalRow[field as keyof FailedRow], to: value }] })),
      refetchedRow: persistedRow
    });
    const user = userEvent.setup();
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i }));

    const row = getDataRow();
    const cell = row.querySelector(`[data-field="${field}"]`) as HTMLElement;
    const input = within(cell).getByRole('combobox');
    await user.click(input);
    fireEvent.change(input, { target: { value } });

    // No await or timer advance between the autocomplete commit and Save. A real
    // pointer click on Save blurs a typed freeSolo input before its click handler;
    // an option click commits through onChange. Both must update MUI's row now.
    if (mode === 'selection') {
      fireEvent.click(screen.getByRole('option', { name: value }));
    } else {
      fireEvent.blur(input);
    }
    fireEvent.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    const previews = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previews).toHaveLength(1);
    expect(JSON.parse(String(previews[0][1]?.body))).toMatchObject({ targetID: originalRow.failedMeasurementID, newRow: { [canonicalField]: value } });
    expect(JSON.parse(String(previews[0][1]?.body)).newRow).toEqual({ [canonicalField]: value });
    await user.click(await screen.findByTestId('edit-preview-apply'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(getDataRow()).getByText(value)).toBeInTheDocument();
    expect(within(getDataRow()).getByText('D26027')).toBeInTheDocument();
    expect(within(getDataRow()).getByText('M')).toBeInTheDocument();
    expect(fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/apply') && init?.method === 'POST')).toHaveLength(1);
    expect(fetchCalls().some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(screen.getByText('Row successfully updated!')).toBeInTheDocument();
  });

  it.each([
    { mode: 'autocomplete selection', selectSuggestion: true },
    { mode: 'typed value committed by blur', selectSuggestion: false }
  ])('previews and applies only the species correction via $mode, preserving the row values', async ({ selectSuggestion }) => {
    renderGrid();
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());

    const user = await enterSpeciesAndOpenSave({ selectSuggestion });
    const previewRequest = fetchCalls().find(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previewRequest).toBeDefined();
    const previewBody = JSON.parse(String(previewRequest?.[1]?.body));
    expect(previewBody).toMatchObject({ schema: 'forestgeo_testing', plotID: 26, censusID: 19, dataType: 'failedmeasurements', targetID: 48027 });
    // Edit-plan canonicalization uses the server field spelling for SpeciesCode.
    expect(previewBody.newRow).toEqual({ SpCode: 'DEMO26' });
    expect(previewBody.newRow).not.toHaveProperty('id');
    expect(previewBody.newRow).not.toHaveProperty('failedMeasurementID');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('edit-preview-field-spCode')).toBeInTheDocument();
    await user.click(screen.getByTestId('edit-preview-apply'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const row = getDataRow();
    expect(within(row).getByText('DEMO26')).toBeInTheDocument();
    expect(within(row).getByText('D26027')).toBeInTheDocument();
    expect(within(row).getByText('0101')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('M')).toBeInTheDocument();
    expect(within(row).getByText('2020-06-15')).toBeInTheDocument();
    expect(within(row).getByText('8.50')).toBeInTheDocument();
    expect(within(row).getByText('12.75')).toBeInTheDocument();
    expect(within(row).getByText('12.34')).toBeInTheDocument();
    expect(within(row).getByText('1.25')).toBeInTheDocument();

    const applyRequests = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/apply') && init?.method === 'POST');
    expect(applyRequests).toHaveLength(1);
    expect(fetchCalls().some(([url, init]) => String(url).includes('/api/fixeddata/failedmeasurements/') && init?.method && init.method !== 'GET')).toBe(false);
    expect(screen.getByText('Row successfully updated!')).toBeInTheDocument();
  });

  it('keeps the edit retryable after preview rejection without applying or reporting success', async () => {
    renderGrid({ preview: [response({ message: 'preview rejected' }, false, 422), response(makePreview())] });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());

    const initialUser = await enterSpeciesAndOpenSave();
    await waitFor(() => expect(screen.getByText(/Error:.*preview rejected/i)).toBeInTheDocument());
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();
    await initialUser.click(within(getDataRow()).getByRole('menuitem', { name: /Cancel your changes/i }));
    await waitFor(() => expect(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i })).toBeInTheDocument());
    const retryUser = await enterSpeciesAndOpenSave();
    await retryUser.click(screen.getByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/preview'))).toHaveLength(2);
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(1);
  });

  it('does not apply after cancellation and can retry the same correction once', async () => {
    renderGrid();
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = await enterSpeciesAndOpenSave();
    await user.click(screen.getByTestId('edit-preview-cancel'));
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(0);
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();

    // The rejected preview leaves the row in edit mode. Cancel that local MUI
    // edit, then prove the same failed row can be edited and saved again.
    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Cancel your changes/i }));
    await waitFor(() => expect(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i })).toBeInTheDocument());
    const retryUser = await enterSpeciesAndOpenSave();
    await retryUser.click(screen.getByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(1);
  });

  it('does not report success when apply rejects and allows a subsequent retry', async () => {
    const applyFailure = response({ message: 'apply rejected' }, false, 503);
    renderGrid({
      apply: [
        applyFailure,
        response({
          updatedIDs: { failedmeasurements: originalRow.failedMeasurementID },
          applyErrors: [],
          editOperationID: 48002,
          validationPending: false
        })
      ]
    });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = await enterSpeciesAndOpenSave();

    await user.click(screen.getByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText(/Error:.*apply rejected/i)).toBeInTheDocument());
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(1);
    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Cancel your changes/i }));
    await waitFor(() => expect(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i })).toBeInTheDocument());
    const retryUser = await enterSpeciesAndOpenSave();
    await retryUser.click(screen.getByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(2);
  });

  it('removes a fully corrected failed row after successful reingestion', async () => {
    renderGrid({ removeOnReingest: true });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = await enterSpeciesAndOpenSave();
    await user.click(screen.getByTestId('edit-preview-apply'));

    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/edits/apply'))).toHaveLength(1);
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('row', { name: /D26027/ })).not.toBeInTheDocument());
  });

  it('reports a no-change save without any preview/apply/reingest/PATCH when the row is saved unmodified with failures remaining (Opus A1)', async () => {
    renderGrid();
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toBe(false);
    expect(fetchCalls().some(([, init]) => init?.method === 'PATCH')).toBe(false);

    await waitFor(() => expect(screen.getByText(NO_CHANGES_SAVED_MESSAGE)).toBeInTheDocument());
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();
  });

  it('runs reingestion and reports success when the diff is empty and the row already has no failure reasons (Opus A1, legitimate reingest)', async () => {
    const validRow: FailedRow = { ...originalRow, spCode: 'DEMO26', failureReasons: '', currentFailureReasons: '' };
    const handle = renderGrid({ row: validRow });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    await waitFor(() => expect(handle.wasReingested()).toBe(true));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
  });

  it('skips preview/apply/reingest and shows a rounding hint for a rounded-only DBH no-op (Opus A2)', async () => {
    // The persisted value carries 3 decimals; EditMeasurements always displays/edits at 2.
    // Focusing and blurring without further typing round-trips 1.234 -> "1.23" -> 1.23,
    // a no-op at the server's 2-decimal precision. spCode stays invalid so the row still
    // fails after the no-op, exercising the empty-diff-with-reasons branch (not the
    // legitimate-reingest branch above).
    const roundedRow: FailedRow = { ...originalRow, dbh: 1.234 };
    renderGrid({ row: roundedRow });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    const dbhInput = row.querySelector('[data-field="dbh"] input') as HTMLInputElement;
    expect(dbhInput.value).toBe('1.23');
    await user.click(dbhInput);
    await user.tab();

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toBe(false);
    await waitFor(() => expect(screen.getByText(/DBH rounded to the existing value/i)).toBeInTheDocument());
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();
  });

  it('runs exactly one reingestion and reports a truthful recovery message (not "other edits applied") for a rounded-only no-op on an otherwise-clean row (Codex review round 2, A1/A2 wording)', async () => {
    // Unlike the DBH case above, spCode is already valid here: the rounded DBH edit is
    // the ONLY thing the user touched, and the row has zero remaining failure reasons -
    // so this falls through to the legitimate-reingest branch (hasEffectiveDiff false,
    // reasons.length === 0), not the empty-diff-with-reasons early return. No field edit
    // is ever applied, so the success text must describe recovery/reingestion, not "other
    // edits applied" (there were none).
    const roundedCleanRow: FailedRow = { ...originalRow, spCode: 'DEMO26', dbh: 1.234, failureReasons: '', currentFailureReasons: '' };
    const handle = renderGrid({ row: roundedCleanRow });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    const dbhInput = row.querySelector('[data-field="dbh"] input') as HTMLInputElement;
    expect(dbhInput.value).toBe('1.23');
    await user.click(dbhInput);
    await user.tab();

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    await waitFor(() => expect(handle.wasReingested()).toBe(true));
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/DBH rounded to the existing value.*resubmitted for reingestion/is)).toBeInTheDocument());
    expect(screen.queryByText(/other edits applied/i)).not.toBeInTheDocument();
  });

  it('restores the rounded-away X value before computing failure reasons, so a rounded no-op never blocks reingestion of an otherwise-clean row (Codex review round 2, effective-row reasons)', async () => {
    // Persisted X is -1.004 - a real, valid coordinate that happens to sit just past the
    // "-1" sentinel computeFailureReasons treats as missing data. EditMeasurements always
    // displays/edits at 2 decimals ("-1.00"); blurring without typing commits that
    // rounded value directly (-1, not 0, so EditMeasurements' null-for-zero branch never
    // applies) - a rounded no-op at 2 decimals (-1.004 -> "-1.00" -> -1) whose raw
    // committed value is exactly the sentinel, -1, even though nothing was actually
    // cleared. Computing failure reasons from that pre-restoration value would read
    // `x: -1` and manufacture a spurious "Missing X", blocking reingestion of a row that
    // is otherwise entirely valid. Reasons must be computed from the effective row (X
    // restored to -1.004) instead.
    const roundedCleanRow: FailedRow = { ...originalRow, spCode: 'DEMO26', x: -1.004, failureReasons: '', currentFailureReasons: '' };
    const handle = renderGrid({ row: roundedCleanRow });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    const xInput = row.querySelector('[data-field="x"] input') as HTMLInputElement;
    expect(xInput.value).toBe('-1.00');
    await user.click(xInput);
    await user.tab();

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    await waitFor(() => expect(handle.wasReingested()).toBe(true));
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/X rounded to the existing value.*resubmitted for reingestion/is)).toBeInTheDocument());
    expect(screen.queryByText(/No changes were saved/i)).not.toBeInTheDocument();
  });

  it('reports a partial save (not success, not a silent full failure) when reingestion succeeds but a follow-up finalization step fails (Codex review round 2, reingest-as-completed-mutation)', async () => {
    // No field edit at all - spCode is already valid, so this exercises the same
    // legitimate-reingest branch as the "Opus A1, legitimate reingest" case above. The
    // failure is injected narrowly via `onRowReingested` (a caller-supplied finalization
    // step invoked after the reingest HTTP call already succeeded), rather than any
    // network call, to isolate exactly the finalization window this fix covers.
    const validRow: FailedRow = { ...originalRow, spCode: 'DEMO26', failureReasons: '', currentFailureReasons: '' };
    const finalizationError = new Error('finalization callback failed');
    const onRowReingested = vi.fn(() => {
      throw finalizationError;
    });
    const handle = renderGrid({ row: validRow }, { onRowReingested });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/preview'))).toBe(false);
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    await waitFor(() => expect(handle.wasReingested()).toBe(true));
    expect(fetchCalls().filter(([url]) => String(url).includes('/api/reingestsinglefailure/'))).toHaveLength(1);

    // Partial save: the reingest already happened (persisted work preserved), so this
    // must be reported as an error alongside that fact - not a silent "Row successfully
    // updated!" and not an undifferentiated "could not be saved" that denies the
    // completed mutation.
    await waitFor(() => expect(screen.getByText(/Changes were saved, but.*finalization callback failed/i)).toBeInTheDocument());
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();
  });

  it('applies only the effective field and carries a rounding hint when a rounded DBH no-op is combined with a real spCode correction (Opus A1+A2)', async () => {
    const roundedRow: FailedRow = { ...originalRow, dbh: 1.234 };
    const correctedRoundedRow: FailedRow = { ...roundedRow, spCode: 'DEMO26', failureReasons: '', currentFailureReasons: '' };
    renderGrid({
      row: roundedRow,
      preview: response(makePreview({ fieldChanges: [{ field: 'spCode', from: 'TYPO26', to: 'DEMO26' }] })),
      refetchedRow: correctedRoundedRow
    });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));
    await waitFor(() => expect(within(row).getAllByRole('combobox').length).toBeGreaterThan(0));

    const dbhInput = row.querySelector('[data-field="dbh"] input') as HTMLInputElement;
    expect(dbhInput.value).toBe('1.23');
    await user.click(dbhInput);
    await user.tab();

    const speciesInput = within(row).getAllByRole('combobox')[2] as HTMLInputElement;
    await user.click(speciesInput);
    await user.clear(speciesInput);
    await user.type(speciesInput, 'DEMO26');
    await waitFor(() => expect(screen.getByRole('option', { name: 'DEMO26' })).toBeInTheDocument());
    await user.click(screen.getByRole('option', { name: 'DEMO26' }));

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    const previews = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previews).toHaveLength(1);
    // Only the effective field (SpCode) reaches the diff - the rounded DBH no-op is excluded.
    expect(JSON.parse(String(previews[0][1]?.body)).newRow).toEqual({ SpCode: 'DEMO26' });

    await user.click(await screen.findByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/apply') && init?.method === 'POST')).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/Row successfully updated!.*DBH rounded to the existing value/s)).toBeInTheDocument());
  });

  it('rejects a clear-indicator clear of spCode as an invalid clear and allows a corrected retry (Opus A3)', async () => {
    renderGrid({ preview: [response({ error: 'invalid clear', field: 'SpCode' }, false, 422), response(makePreview())] });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));

    const cell = row.querySelector('[data-field="spCode"]') as HTMLElement;
    const speciesInput = within(cell).getByRole('combobox');
    // Joy's Autocomplete clear indicator is styled `visibility: hidden` until the field
    // is focused - focus it first, as a real user would before clicking Clear, then
    // query the button by its accessible role/name.
    await user.click(speciesInput);
    await user.click(within(cell).getByRole('button', { name: 'Clear' }));

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    const previews = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previews).toHaveLength(1);
    expect(JSON.parse(String(previews[0][1]?.body)).newRow).toEqual({ SpCode: '' });

    await waitFor(() => expect(screen.getByText(/Error:.*invalid clear/i)).toBeInTheDocument());
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();

    // Retryable: cancel the rejected clear, then successfully correct the species code.
    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Cancel your changes/i }));
    await waitFor(() => expect(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i })).toBeInTheDocument());
    const retryUser = await enterSpeciesAndOpenSave();
    await retryUser.click(await screen.findByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
  });

  it('rejects a keyboard-cleared spCode (select-all + delete, then blur) as an invalid clear and allows a corrected retry (Opus A3)', async () => {
    renderGrid({ preview: [response({ error: 'invalid clear', field: 'SpCode' }, false, 422), response(makePreview())] });
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    const user = userEvent.setup();
    const row = getDataRow();
    await user.click(within(row).getByRole('menuitem', { name: /Edit this row/i }));

    const cell = row.querySelector('[data-field="spCode"]') as HTMLElement;
    const speciesInput = within(cell).getByRole('combobox') as HTMLInputElement;
    await user.click(speciesInput);
    await user.clear(speciesInput);

    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    const previews = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previews).toHaveLength(1);
    expect(JSON.parse(String(previews[0][1]?.body)).newRow).toEqual({ SpCode: '' });

    await waitFor(() => expect(screen.getByText(/Error:.*invalid clear/i)).toBeInTheDocument());
    expect(fetchCalls().some(([url]) => String(url).includes('/api/edits/apply'))).toBe(false);
    expect(screen.queryByText('Row successfully updated!')).not.toBeInTheDocument();

    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Cancel your changes/i }));
    await waitFor(() => expect(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i })).toBeInTheDocument());
    const retryUser = await enterSpeciesAndOpenSave();
    await retryUser.click(await screen.findByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.getByText('Row successfully updated!')).toBeInTheDocument());
  });

  it('saves the latest typed dbh value when a real pointer click on Save immediately follows typing (no explicit blur)', async () => {
    const persistedRow: FailedRow = { ...originalRow, dbh: 15.5 };
    renderGrid({
      preview: response(makePreview({ fieldChanges: [{ field: 'dbh', from: originalRow.dbh, to: 15.5 }] })),
      refetchedRow: persistedRow
    });
    const user = userEvent.setup();
    await waitFor(() => expect(getDataRow()).toBeInTheDocument());
    await user.click(within(getDataRow()).getByRole('menuitem', { name: /Edit this row/i }));

    const row = getDataRow();
    const dbhInput = row.querySelector('[data-field="dbh"] input') as HTMLInputElement;
    await user.click(dbhInput);
    await user.clear(dbhInput);
    await user.type(dbhInput, '15.50');

    // No explicit tab/blur: a real pointer click on the Save menu item must itself move
    // focus off the dbh input before its own click handler runs.
    await user.click(within(row).getByRole('menuitem', { name: /Save your changes/i }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    const previews = fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/preview') && init?.method === 'POST');
    expect(previews).toHaveLength(1);
    expect(JSON.parse(String(previews[0][1]?.body)).newRow).toEqual({ DBH: 15.5 });

    await user.click(await screen.findByTestId('edit-preview-apply'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchCalls().filter(([url, init]) => String(url).includes('/api/edits/apply') && init?.method === 'POST')).toHaveLength(1);
  });
});
