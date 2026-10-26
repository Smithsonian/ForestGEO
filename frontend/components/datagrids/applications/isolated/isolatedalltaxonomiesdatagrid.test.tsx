import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import IsolatedAllTaxonomiesViewDataGrid from './isolatedalltaxonomiesdatagrid';
import { SPECIES_LIMITS_SAVED_MESSAGE } from '@/components/client/modals/specieslimitsmodal';
import { HTTPResponses } from '@/config/macros';

const SPECIES_LIMITS_LIST_PATH_PREFIX = '/api/specieslimits/';
const SPECIES_LIMITS_WRITE_PATH_PREFIX = '/api/fixeddata/specieslimits/';
const SERVER_REJECTION_MESSAGE = 'Species limit rejected by the server';

const TEST_FIXTURES = vi.hoisted(() => ({
  speciesRow: { id: 201, speciesID: 201, speciesName: 'berteriana', speciesCode: 'RUBI04' },
  limits: [{ speciesLimitID: 1, speciesID: 201, plotID: 1, censusID: 5, limitType: 'DBH', lowerBound: 5, upperBound: 60 }],
  site: { schemaName: 'testschema', siteName: 'Test Site' },
  plot: { plotID: 1, plotName: 'Test Plot', defaultDBHUnits: 'cm' },
  census: { plotCensusNumber: 5, dateRanges: [{ censusID: 5 }] }
}));

// Same module setup as isolatedfailedmeasurementsdatagrid.test.tsx: the column modules need the
// real definitions, and the grid itself is replaced.
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: () => <div>Mock DataGrid</div>,
  GridColDef: {},
  GridRenderEditCellParams: {},
  getGridNumericOperators: () => [],
  useGridApiRef: () => ({ current: {} })
}));
// platform-mocks.ts stubs these with (almost) empty modules; datagridcolumns.tsx reads core exports at load time.
vi.mock('@/lib/db/definitions/core', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/views', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/zones', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/personnel', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => importOriginal());
vi.mock('@/lib/db/definitions/unifiedchangelog', async importOriginal => importOriginal());
vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => TEST_FIXTURES.site,
  usePlotContext: () => TEST_FIXTURES.plot,
  useOrgCensusContext: () => TEST_FIXTURES.census
}));
vi.mock('@/components/client/clientmacros', () => ({
  standardizeGridColumns: (columns: GridColDef[]) => columns,
  selectableAutocomplete: () => <div>Mock Autocomplete</div>,
  loadSelectableOptions: vi.fn(),
  selectableOptionKeyForField: (field: string) => field
}));
vi.mock('@/components/uploadsystemhelpers/uploadparentmodal', () => ({ default: () => null }));
vi.mock('@/components/datagrids/applications/multiline/multilinemodal', () => ({ default: () => null }));
vi.mock('@/components/datagrids/isolateddatagridcommons', () => ({
  default: function MockIsolatedDataGridCommons({ gridColumns }: { gridColumns: GridColDef[] }) {
    const speciesLimitsColumn = gridColumns.find(column => column.field === 'speciesLimits');
    return <div data-testid="species-limits-cell">{speciesLimitsColumn?.renderCell?.({ row: TEST_FIXTURES.speciesRow } as GridRenderCellParams)}</div>;
  }
}));

function stubSpeciesLimitsApi(writeResponse: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(SPECIES_LIMITS_LIST_PATH_PREFIX)) {
      return new Response(JSON.stringify(TEST_FIXTURES.limits), { status: HTTPResponses.OK });
    }
    if (url.startsWith(SPECIES_LIMITS_WRITE_PATH_PREFIX)) return writeResponse();
    throw new Error(`[isolatedalltaxonomiesdatagrid test] unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openSpeciesLimitsAndSave() {
  fireEvent.click(await screen.findByRole('button', { name: /species limits/i }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('IsolatedAllTaxonomiesViewDataGrid - species limits save notification (#524 item 10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the saved message in its own Snackbar after a 200', async () => {
    const fetchMock = stubSpeciesLimitsApi(() => new Response(JSON.stringify({}), { status: HTTPResponses.OK }));
    render(<IsolatedAllTaxonomiesViewDataGrid />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await openSpeciesLimitsAndSave();

    const notice = await screen.findByText(SPECIES_LIMITS_SAVED_MESSAGE);
    console.log(`[alltaxonomies 200] snackbar text=${JSON.stringify(notice.textContent)} dialogOpen=${screen.queryByRole('dialog') !== null}`);
    expect(notice).toBeInTheDocument();
  });

  it('shows the server message while the dialog is still open after a 500', async () => {
    stubSpeciesLimitsApi(
      () =>
        new Response(JSON.stringify({ error: SERVER_REJECTION_MESSAGE }), {
          status: HTTPResponses.INTERNAL_SERVER_ERROR,
          headers: { 'Content-Type': 'application/json' }
        })
    );
    render(<IsolatedAllTaxonomiesViewDataGrid />);

    await openSpeciesLimitsAndSave();

    const notice = await screen.findByText(SERVER_REJECTION_MESSAGE);
    console.log(`[alltaxonomies 500] snackbar text=${JSON.stringify(notice.textContent)} dialogOpen=${screen.queryByRole('dialog') !== null}`);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
