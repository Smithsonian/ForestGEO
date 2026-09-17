import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import IsolatedFailedMeasurementsDataGrid from './isolatedfailedmeasurementsdatagrid';

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

function installNetwork({
  preview = response(makePreview()),
  apply = response({
    updatedIDs: { failedmeasurements: originalRow.failedMeasurementID },
    applyErrors: [],
    editOperationID: 48001,
    validationPending: false
  }),
  refetchedRow = correctedRow,
  removeOnReingest = false
}: {
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
    if (url.includes('/api/fetchall/trees/')) return response([{ treeTag: 'D26027' }]);
    if (url.includes('/api/fetchall/stems/')) return response([{ stemTag: '2' }]);
    if (url.includes('/api/fetchall/quadrats/')) return response([{ quadratName: '0101' }]);
    if (url.includes('/api/fetchall/species/')) return response([{ speciesCode: 'DEMO26' }]);
    if (url.includes('/api/fixeddata/failedmeasurements/') && method === 'GET') {
      if (removeOnReingest && reingested) return response({ output: [], totalCount: 0, finishedQuery: 'SELECT no remaining failed rows' });
      return response({ output: [applied ? refetchedRow : originalRow], totalCount: 1, finishedQuery: 'SELECT failed row' });
    }
    if (url.includes('/api/fixeddatafilter/')) return response({ output: [refetchedRow], totalCount: 1, finishedQuery: 'SELECT failed row' });

    throw new Error(`Unexpected network request: ${method} ${url}`);
  });
}

function fetchCalls(): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return vi.mocked(globalThis.fetch).mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
}

function renderGrid(network?: Parameters<typeof installNetwork>[0]) {
  // setup.ts's auth mock owns global fetch and resets it in its beforeEach hook;
  // install the scenario after those hooks have completed, immediately before mount.
  installNetwork(network);
  return render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, dedupingInterval: 0 }}>
      <LocalizationProvider dateAdapter={AdapterMoment}>
        <div style={{ width: 4200, height: 720 }}>
          <IsolatedFailedMeasurementsDataGrid />
        </div>
      </LocalizationProvider>
    </SWRConfig>
  );
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
});
