import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import type { ContradictionType, ErrorExplorerFilters, ErrorExplorerRow } from '@/config/errorsexplorer';
import { ERROR_EXPLORER_STATEMENT_LABELS, readStatementLabel } from '@/app/api/errors/explorer/errorsetsql';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  FIXTURE_HOOK_TIMEOUT_MS,
  replaceFixture,
  type ExplorerFixture,
  type FixtureDatabase,
  type FixtureCensus,
  type FixtureErrorType,
  type FixtureLog,
  type FixtureMeasurement,
  type FixtureValidation
} from './helpers/errorsexplorerfixtures';

const ROUTES_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errroutes`;
const QUERY_ROUTE_URL = 'http://localhost/api/errors/explorer/query';
const FACETS_ROUTE_URL = 'http://localhost/api/errors/explorer/facets';
const DETAILS_ROUTE_URL = 'http://localhost/api/errors/explorer/details';
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const QUERY_PAGE = 0;
const QUERY_PAGE_SIZE = 25;

const PLOT_ID = 5;
const CENSUS_ID = 7;
const PLOT_CENSUS_NUMBER = 1;
const UPLOAD_FILE_ID = 'file-1';
const UPLOAD_BATCH_ID = 'batch-1';
const DECOY_CENSUS_ID = 8;
const DECOY_PLOT_CENSUS_NUMBER = 2;
const UPLOAD_BATCH_ID_OF_DUPLICATE_ONLY_ROW = 'batch-2';
const FIRST_MEASUREMENT_ID = 101;
const SECOND_MEASUREMENT_ID = 102;
const DUPLICATE_ONLY_MEASUREMENT_ID = 103;
const DECOY_MEASUREMENT_ID = 301;
const FAILED_MEASUREMENT_ID = 201;
const RESOLVED_MEASUREMENT_ID = 202;
const MEASUREMENT_WITH_TWO_ERRORS = 201;

const VALIDATION_DUPLICATE_TAG_ID = 5;
const VALIDATION_SAME_BATCH_ID = 21;
const VALIDATION_DBH_OUTLIER_ID = 5;

const FIRST_RAW_CODES = 'MX,I';
const SECOND_RAW_CODES = 'A';
const FIRST_DESCRIPTION = 'row 101';
const SECOND_DESCRIPTION = 'row 102';
const DUPLICATE_ONLY_DESCRIPTION = 'row 103';
const RESOLVED_DESCRIPTION = 'row 202';
const SECOND_SPECIES_CODE = 'SP2';
const DUPLICATE_TAG_STEM: ContradictionType = 'duplicate_tag_stem';
const SAME_BATCH_CONFLICT: ContradictionType = 'same_batch_conflict';

const DUPLICATE_TAG_MESSAGE = 'Duplicate tree/stem tag';
const SAME_BATCH_MESSAGE = 'Same-batch species conflict';
const DUPLICATE_TAG_INGESTION_MESSAGE = 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch';
const CATALOG_MESSAGE_OVERRIDDEN_BY_VALIDATION = 'Catalog text that the validation description replaces';
const INVALID_SPECIES_MESSAGE = 'Invalid species code: "SYNSSP"';
const INVALID_SPECIES_DESCRIPTION = 'Invalid species code: "SYNSSP" not found in database';
const DBH_OUTLIER_MESSAGE = 'DBH outlier';
const FIRST_TWO_ERRORS_MESSAGE = 'Invalid species reference';
const SECOND_TWO_ERRORS_MESSAGE = 'Coordinate drift exceeds allowed threshold';

const DECIMAL_SCALE_SUFFIX = '.000000';
const DETAIL_STEM_LOCAL_X = 12;
const DETAIL_STEM_LOCAL_Y = 22;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  executedSql: [] as string[]
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'integration-runner@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const { runQueryDispatch } = await vi.importActual<typeof import('../setup/runquerydispatch')>('../setup/runquerydispatch');
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      sharedState.executedSql.push(query);
      return runQueryDispatch(sharedState.connection, query, params);
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

const ACTIVE_COUNT_SQL_MARKER = 'SELECT COUNT(*) AS n';
const ACTIVE_COUNT_KIND = 'active-count';
const UNLABELLED_KIND = 'unlabelled';

function executedKinds(): string[] {
  return sharedState.executedSql.map(sql => readStatementLabel(sql) ?? (sql.includes(ACTIVE_COUNT_SQL_MARKER) ? ACTIVE_COUNT_KIND : UNLABELLED_KIND)).sort();
}

const UNSEARCHED_FACET_KINDS = [ERROR_EXPLORER_STATEMENT_LABELS.catalog, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags, ACTIVE_COUNT_KIND].sort();

const NO_FILTERS: ErrorExplorerFilters = {
  source: 'all',
  exactMessages: [],
  affectedFields: [],
  contradictionOnly: false,
  contradictionTypes: [],
  quickSearch: ''
};

interface MeasurementOverrides extends Partial<FixtureMeasurement> {
  coreMeasurementID: number;
}

function firstMeasurement(overrides: Partial<FixtureMeasurement> = {}): FixtureMeasurement {
  return buildMeasurement({
    coreMeasurementID: FIRST_MEASUREMENT_ID,
    treeID: 11,
    coreStemGUID: 21,
    summaryStemGUID: 21,
    speciesID: 31,
    speciesName: 'Species 1',
    speciesCode: 'SP1',
    quadratName: 'Q1',
    stemLocalX: 10,
    stemLocalY: 20,
    measurementDate: '2026-01-01',
    measuredDBH: 5.1,
    measuredHOM: 1.3,
    description: FIRST_DESCRIPTION,
    rawCodes: FIRST_RAW_CODES,
    ...overrides
  });
}

function secondMeasurement(overrides: Partial<FixtureMeasurement> = {}): FixtureMeasurement {
  return buildMeasurement({
    coreMeasurementID: SECOND_MEASUREMENT_ID,
    treeID: 12,
    coreStemGUID: 22,
    summaryStemGUID: 22,
    speciesID: 32,
    speciesName: 'Species 2',
    speciesCode: SECOND_SPECIES_CODE,
    quadratName: 'Q2',
    stemLocalX: 12,
    stemLocalY: 22,
    measurementDate: '2026-01-02',
    measuredDBH: 6.2,
    measuredHOM: 1.4,
    description: SECOND_DESCRIPTION,
    rawCodes: SECOND_RAW_CODES,
    ...overrides
  });
}

function buildMeasurement(overrides: MeasurementOverrides): FixtureMeasurement {
  return {
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    isActive: true,
    coreIsValidated: false,
    summaryIsValidated: false,
    treeTag: 'TREE-1',
    stemTag: 'A',
    quadratID: 1,
    subspeciesName: null,
    stemPlotX: null,
    stemPlotY: null,
    attributes: null,
    userDefinedFields: null,
    uploadFileID: UPLOAD_FILE_ID,
    uploadBatchID: UPLOAD_BATCH_ID,
    coreStemGUID: null,
    summaryStemGUID: null,
    treeID: null,
    speciesID: null,
    speciesName: null,
    speciesCode: null,
    quadratName: null,
    measurementDate: null,
    measuredDBH: null,
    measuredHOM: null,
    stemLocalX: null,
    stemLocalY: null,
    description: null,
    rawCodes: null,
    ...overrides
  };
}

async function readSuccessfulBody(response: Response): Promise<ReturnType<typeof JSON.parse>> {
  const responseText = await response.text();
  expect(response.status, `route answered ${response.status} with body: ${responseText}`).toBe(HTTPResponses.OK);
  return JSON.parse(responseText);
}

function duplicateOnlyMeasurement(): FixtureMeasurement {
  return firstMeasurement({
    coreMeasurementID: DUPLICATE_ONLY_MEASUREMENT_ID,
    treeID: 13,
    coreStemGUID: 23,
    summaryStemGUID: 23,
    uploadBatchID: UPLOAD_BATCH_ID_OF_DUPLICATE_ONLY_ROW,
    description: DUPLICATE_ONLY_DESCRIPTION,
    userDefinedFields: {}
  });
}

function unresolvedLog(measurementID: number, errorID: number): FixtureLog {
  return { measurementID, errorID, isResolved: false };
}

function fixtureOf(
  parts: Pick<ExplorerFixture, 'errorTypes' | 'validations' | 'measurements' | 'logs'> & { extraCensuses?: FixtureCensus[] }
): ExplorerFixture {
  const { extraCensuses = [], ...fixtureParts } = parts;
  return {
    plotIDs: [PLOT_ID],
    censuses: [{ censusID: CENSUS_ID, plotID: PLOT_ID, plotCensusNumber: PLOT_CENSUS_NUMBER }, ...extraCensuses],
    ...fixtureParts
  };
}

const DUPLICATE_TAG_VALIDATION: FixtureValidation = {
  validationID: VALIDATION_DUPLICATE_TAG_ID,
  procedureName: 'Validation 5',
  description: DUPLICATE_TAG_MESSAGE,
  criteria: 'treeTag;stemTag'
};
const SAME_BATCH_VALIDATION: FixtureValidation = {
  validationID: VALIDATION_SAME_BATCH_ID,
  procedureName: '',
  description: SAME_BATCH_MESSAGE,
  criteria: ''
};
const DUPLICATE_TAG_VALIDATION_ERROR: FixtureErrorType = {
  errorID: 1,
  source: 'validation',
  code: String(VALIDATION_DUPLICATE_TAG_ID),
  message: CATALOG_MESSAGE_OVERRIDDEN_BY_VALIDATION
};
const SAME_BATCH_VALIDATION_ERROR: FixtureErrorType = {
  errorID: 2,
  source: 'validation',
  code: String(VALIDATION_SAME_BATCH_ID),
  message: CATALOG_MESSAGE_OVERRIDDEN_BY_VALIDATION
};
const DUPLICATE_TAG_INGESTION_ERROR: FixtureErrorType = {
  errorID: 3,
  source: 'ingestion',
  code: 'DUPLICATE_TAG_CONFLICT',
  message: DUPLICATE_TAG_INGESTION_MESSAGE
};

/**
 * 101 and 102 share TREE-1/A (duplicate group) and one upload batch with two species (same-batch group).
 * 103 shares TREE-1/A too but sits in another upload batch, so it joins only the duplicate group.
 */
function contradictingPairFixture(options: {
  userDefinedFields: Record<string, unknown>;
  firstRowIngestionError: boolean;
  withDuplicateOnlyRow: boolean;
}): ExplorerFixture {
  return fixtureOf({
    errorTypes: [DUPLICATE_TAG_VALIDATION_ERROR, SAME_BATCH_VALIDATION_ERROR, DUPLICATE_TAG_INGESTION_ERROR],
    validations: [DUPLICATE_TAG_VALIDATION, SAME_BATCH_VALIDATION],
    measurements: [
      firstMeasurement({ userDefinedFields: options.userDefinedFields }),
      secondMeasurement({ userDefinedFields: options.userDefinedFields }),
      ...(options.withDuplicateOnlyRow ? [duplicateOnlyMeasurement()] : [])
    ],
    logs: [
      unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
      ...(options.firstRowIngestionError ? [unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_INGESTION_ERROR.errorID)] : []),
      unresolvedLog(SECOND_MEASUREMENT_ID, SAME_BATCH_VALIDATION_ERROR.errorID),
      ...(options.withDuplicateOnlyRow ? [unresolvedLog(DUPLICATE_ONLY_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID)] : [])
    ]
  });
}

function queryRequest(schema: string, filters: ErrorExplorerFilters): NextRequest {
  return new NextRequest(QUERY_ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, plotID: PLOT_ID, censusID: CENSUS_ID, page: QUERY_PAGE, pageSize: QUERY_PAGE_SIZE, filters })
  });
}

function facetsRequest(schema: string, filters: ErrorExplorerFilters): NextRequest {
  return new NextRequest(FACETS_ROUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, plotID: PLOT_ID, censusID: CENSUS_ID, filters })
  });
}

function detailsRequest(schema: string, measurementID: number, activeContradictionType?: string): NextRequest {
  const search = new URLSearchParams({ schema, plotID: String(PLOT_ID), censusID: String(CENSUS_ID) });
  if (activeContradictionType) search.set('activeContradictionType', activeContradictionType);
  return new NextRequest(`${DETAILS_ROUTE_URL}/${measurementID}?${search.toString()}`);
}

describe('errors explorer route behaviour on real MySQL', () => {
  let fixtureDatabase: FixtureDatabase | null = null;

  const connection = () => (fixtureDatabase as FixtureDatabase).setupConnection;
  const schema = () => (fixtureDatabase as FixtureDatabase).database;

  const fixtureSession = createFixtureDatabaseSession(ROUTES_DATABASE);

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
    sharedState.connection = fixtureDatabase.explorerConnection;
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe('POST /api/errors/explorer/query', () => {
    it('returns grouped row-centric error data with contradiction links', async () => {
      await replaceFixture(
        connection(),
        contradictingPairFixture({ userDefinedFields: { treestemstate: 'old tree' }, firstRowIngestionError: true, withDuplicateOnlyRow: false })
      );
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(queryRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      const body = await readSuccessfulBody(response);
      console.log('[query contradiction links]', JSON.stringify({ totalRows: body.totalRows, summary: body.summary, firstRow: body.rows[0] }));

      expect(body.totalRows).toBe(2);
      expect(body.rows[0]).toMatchObject({
        coreMeasurementID: FIRST_MEASUREMENT_ID,
        rawCodes: FIRST_RAW_CODES,
        hasContradiction: true,
        contradictionType: DUPLICATE_TAG_STEM
      });
      expect(body.rows[0].contradictionTypes).toEqual(expect.arrayContaining([DUPLICATE_TAG_STEM, SAME_BATCH_CONFLICT]));
      expect(body.rows[0].errorMessages).toContain(DUPLICATE_TAG_MESSAGE);
      expect(body.rows[0].errorSources).toEqual(expect.arrayContaining(['validation', 'ingestion']));
      expect(body.rows[0].relatedMeasurementIDs).toEqual([SECOND_MEASUREMENT_ID]);
      expect(body.summary.contradictions).toBe(2);
      expect(body.summary.duplicateTagStem).toBe(2);
      expect(body.summary.sameBatchConflict).toBe(2);
    });

    it('surfaces overlapping contradiction rows in same-batch filters', async () => {
      await replaceFixture(
        connection(),
        contradictingPairFixture({ userDefinedFields: { treestemstate: 'old tree' }, firstRowIngestionError: false, withDuplicateOnlyRow: true })
      );
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(queryRequest(schema(), { ...NO_FILTERS, contradictionOnly: true, contradictionTypes: [SAME_BATCH_CONFLICT] }), ROUTE_CONTEXT);

      const body = await readSuccessfulBody(response);
      console.log('[query same-batch filter]', JSON.stringify({ totalRows: body.totalRows, firstRow: body.rows[0] }));

      expect(body.totalRows).toBe(2);
      expect(body.rows[0]).toMatchObject({
        coreMeasurementID: FIRST_MEASUREMENT_ID,
        rawCodes: FIRST_RAW_CODES,
        contradictionType: SAME_BATCH_CONFLICT,
        relatedMeasurementIDs: [SECOND_MEASUREMENT_ID]
      });
    });

    // Regression: derive isFailedRow from cm.StemGUID (aliased as CoreStemGUID),
    // not ms.StemGUID, because ms.StemGUID can be stale. View Errors uses this
    // to route hard-failed rows to the failedmeasurements edit surface.
    it('marks rows where coremeasurements.StemGUID IS NULL as isFailedRow=true even if measurementssummary still has a stale StemGUID', async () => {
      const invalidSpeciesError: FixtureErrorType = { errorID: 1, source: 'ingestion', code: 'INVALID_SPECIES', message: INVALID_SPECIES_MESSAGE };
      const dbhOutlierError: FixtureErrorType = {
        errorID: 2,
        source: 'validation',
        code: String(VALIDATION_DBH_OUTLIER_ID),
        message: CATALOG_MESSAGE_OVERRIDDEN_BY_VALIDATION
      };
      await replaceFixture(
        connection(),
        fixtureOf({
          errorTypes: [invalidSpeciesError, dbhOutlierError],
          validations: [{ validationID: VALIDATION_DBH_OUTLIER_ID, procedureName: 'Validation 5', description: DBH_OUTLIER_MESSAGE, criteria: '' }],
          measurements: [
            firstMeasurement({
              coreMeasurementID: FAILED_MEASUREMENT_ID,
              coreStemGUID: null,
              summaryStemGUID: 21,
              speciesCode: 'SYNSSP',
              description: INVALID_SPECIES_DESCRIPTION,
              rawCodes: null
            }),
            secondMeasurement({ coreMeasurementID: RESOLVED_MEASUREMENT_ID, treeTag: 'TREE-2', stemTag: 'B', description: RESOLVED_DESCRIPTION })
          ],
          logs: [unresolvedLog(FAILED_MEASUREMENT_ID, invalidSpeciesError.errorID), unresolvedLog(RESOLVED_MEASUREMENT_ID, dbhOutlierError.errorID)]
        })
      );
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(queryRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      const body = await readSuccessfulBody(response);
      const failedRow = body.rows.find((row: ErrorExplorerRow) => row.coreMeasurementID === FAILED_MEASUREMENT_ID);
      const resolvedRow = body.rows.find((row: ErrorExplorerRow) => row.coreMeasurementID === RESOLVED_MEASUREMENT_ID);
      console.log('[query isFailedRow]', JSON.stringify({ failedRow, resolvedRow }));

      expect(failedRow.isFailedRow).toBe(true);
      expect(resolvedRow.isFailedRow).toBe(false);
    });
  });

  describe('POST /api/errors/explorer/facets', () => {
    it('returns error-type identities and census totals scoped to the current census', async () => {
      await replaceFixture(
        connection(),
        fixtureOf({
          errorTypes: [DUPLICATE_TAG_VALIDATION_ERROR, DUPLICATE_TAG_INGESTION_ERROR],
          validations: [DUPLICATE_TAG_VALIDATION],
          extraCensuses: [{ censusID: DECOY_CENSUS_ID, plotID: PLOT_ID, plotCensusNumber: DECOY_PLOT_CENSUS_NUMBER }],
          measurements: [
            firstMeasurement({ userDefinedFields: {} }),
            secondMeasurement({ treeTag: 'TREE-2', stemTag: 'B', userDefinedFields: {} }),
            firstMeasurement({ coreMeasurementID: DECOY_MEASUREMENT_ID, censusID: DECOY_CENSUS_ID, treeTag: 'TREE-DECOY', stemTag: 'D', userDefinedFields: {} })
          ],
          logs: [
            unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
            unresolvedLog(SECOND_MEASUREMENT_ID, DUPLICATE_TAG_INGESTION_ERROR.errorID),
            unresolvedLog(DECOY_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID)
          ]
        })
      );
      const { POST } = await import('@/app/api/errors/explorer/facets/route');
      sharedState.executedSql = [];

      const response = await POST(facetsRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      const body = await readSuccessfulBody(response);
      console.log('[facets error types and census totals]', JSON.stringify({ errorTypes: body.errorTypes, censusTotals: body.censusTotals }));

      expect(Object.keys(body).sort(), 'the facets response is exactly errorTypes and censusTotals').toEqual(['censusTotals', 'errorTypes']);
      expect(executedKinds(), 'the unsearched facets read the catalog, the histogram and the active count').toEqual(UNSEARCHED_FACET_KINDS);
      expect(body.errorTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'validation', code: String(VALIDATION_DUPLICATE_TAG_ID), message: DUPLICATE_TAG_MESSAGE, count: 1 }),
          expect.objectContaining({ source: 'ingestion', code: DUPLICATE_TAG_INGESTION_ERROR.code, message: DUPLICATE_TAG_INGESTION_MESSAGE, count: 1 })
        ])
      );
      expect(body.errorTypes, 'the decoy row in census 8 must not add an identity or a count').toHaveLength(2);
      expect(body.errorTypes.flatMap((identity: { fields: string[] }) => identity.fields)).toEqual(expect.arrayContaining(['treeTag', 'stemTag']));
      expect(body.censusTotals, `the decoy row ${DECOY_MEASUREMENT_ID} in census ${DECOY_CENSUS_ID} must not be counted`).toEqual(
        expect.objectContaining({ affectedMeasurements: 2, validation: 1, ingestion: 1, errorTypeCount: 2 })
      );
    });

    it('reports one distinct measurement when a row carries two error messages (#547)', async () => {
      const invalidSpeciesError: FixtureErrorType = { errorID: 1, source: 'ingestion', code: 'INVALID_SPECIES', message: FIRST_TWO_ERRORS_MESSAGE };
      const coordinateDriftError: FixtureErrorType = { errorID: 2, source: 'ingestion', code: 'COORDINATE_DRIFT', message: SECOND_TWO_ERRORS_MESSAGE };
      await replaceFixture(
        connection(),
        fixtureOf({
          errorTypes: [invalidSpeciesError, coordinateDriftError],
          validations: [],
          measurements: [firstMeasurement({ coreMeasurementID: MEASUREMENT_WITH_TWO_ERRORS, treeTag: 'TREE-201', description: null, userDefinedFields: {} })],
          logs: [
            unresolvedLog(MEASUREMENT_WITH_TWO_ERRORS, invalidSpeciesError.errorID),
            unresolvedLog(MEASUREMENT_WITH_TWO_ERRORS, coordinateDriftError.errorID)
          ]
        })
      );
      const { POST } = await import('@/app/api/errors/explorer/facets/route');
      sharedState.executedSql = [];

      const response = await POST(facetsRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      const body = await readSuccessfulBody(response);
      console.log('[#547 facets total]', JSON.stringify({ censusTotals: body.censusTotals, errorTypes: body.errorTypes }));
      expect(body.errorTypes.map((identity: { message: string }) => identity.message).sort()).toEqual(
        [SECOND_TWO_ERRORS_MESSAGE, FIRST_TWO_ERRORS_MESSAGE].sort()
      );
      expect(
        body.errorTypes.map((identity: { count: number }) => identity.count),
        'each of the two identities counts the one measurement'
      ).toEqual([1, 1]);
      expect(body.censusTotals.affectedMeasurements, 'two messages on one measurement are one affected measurement').toBe(1);
      expect(body.censusTotals.errorTypeCount).toBe(2);
      expect(executedKinds()).toEqual(UNSEARCHED_FACET_KINDS);
    });
  });

  describe('GET /api/errors/explorer/details/[measurementID]', () => {
    const detailsContext = (measurementID: number) => ({ params: Promise.resolve({ measurementID: String(measurementID) }) });

    it('returns full error details and related contradiction rows', async () => {
      await replaceFixture(
        connection(),
        fixtureOf({
          errorTypes: [DUPLICATE_TAG_VALIDATION_ERROR, SAME_BATCH_VALIDATION_ERROR],
          validations: [DUPLICATE_TAG_VALIDATION, SAME_BATCH_VALIDATION],
          measurements: [
            firstMeasurement({ userDefinedFields: {} }),
            secondMeasurement({
              userDefinedFields: {},
              uploadBatchID: UPLOAD_BATCH_ID_OF_DUPLICATE_ONLY_ROW,
              stemLocalX: DETAIL_STEM_LOCAL_X,
              stemLocalY: DETAIL_STEM_LOCAL_Y
            })
          ],
          logs: [
            unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
            unresolvedLog(SECOND_MEASUREMENT_ID, SAME_BATCH_VALIDATION_ERROR.errorID)
          ]
        })
      );
      const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');

      const response = await GET(detailsRequest(schema(), FIRST_MEASUREMENT_ID), detailsContext(FIRST_MEASUREMENT_ID));

      const body = await readSuccessfulBody(response);
      console.log('[details related rows]', JSON.stringify({ row: body.row, allErrors: body.allErrors, relatedRows: body.relatedRows }));

      expect(body.row).toMatchObject({
        coreMeasurementID: FIRST_MEASUREMENT_ID,
        rawCodes: FIRST_RAW_CODES,
        hasContradiction: true,
        contradictionType: DUPLICATE_TAG_STEM
      });
      expect(body.row.contradictionTypes).toEqual([DUPLICATE_TAG_STEM]);
      expect(body.allErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: String(VALIDATION_DUPLICATE_TAG_ID),
            message: DUPLICATE_TAG_MESSAGE,
            fields: ['treeTag', 'stemTag']
          })
        ])
      );
      expect(body.relatedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            coreMeasurementID: SECOND_MEASUREMENT_ID,
            speciesCode: SECOND_SPECIES_CODE,
            stemLocalX: `${DETAIL_STEM_LOCAL_X}${DECIMAL_SCALE_SUFFIX}`,
            stemLocalY: `${DETAIL_STEM_LOCAL_Y}${DECIMAL_SCALE_SUFFIX}`,
            description: SECOND_DESCRIPTION,
            errorCount: 1,
            errorMessages: [SAME_BATCH_MESSAGE]
          })
        ])
      );
    });

    it('uses the requested contradiction type when a row belongs to multiple groups', async () => {
      await replaceFixture(connection(), contradictingPairFixture({ userDefinedFields: {}, firstRowIngestionError: false, withDuplicateOnlyRow: true }));
      const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');

      const response = await GET(detailsRequest(schema(), FIRST_MEASUREMENT_ID, SAME_BATCH_CONFLICT), detailsContext(FIRST_MEASUREMENT_ID));

      const body = await readSuccessfulBody(response);
      console.log('[details requested contradiction type]', JSON.stringify({ row: body.row, relatedRows: body.relatedRows }));

      expect(body.row).toMatchObject({
        coreMeasurementID: FIRST_MEASUREMENT_ID,
        rawCodes: FIRST_RAW_CODES,
        contradictionType: SAME_BATCH_CONFLICT
      });
      expect(body.row.contradictionTypes).toEqual(expect.arrayContaining([DUPLICATE_TAG_STEM, SAME_BATCH_CONFLICT]));
      expect(body.relatedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            coreMeasurementID: SECOND_MEASUREMENT_ID,
            speciesCode: SECOND_SPECIES_CODE
          })
        ])
      );
      const sameBatchRelatedIDs = body.relatedRows.map((related: { coreMeasurementID: number }) => related.coreMeasurementID);
      expect(sameBatchRelatedIDs, `same-batch related rows must leave out the duplicate-only row ${DUPLICATE_ONLY_MEASUREMENT_ID}`).toEqual([
        SECOND_MEASUREMENT_ID
      ]);

      const duplicateResponse = await GET(detailsRequest(schema(), FIRST_MEASUREMENT_ID, DUPLICATE_TAG_STEM), detailsContext(FIRST_MEASUREMENT_ID));
      const duplicateBody = await readSuccessfulBody(duplicateResponse);
      const duplicateRelatedIDs = duplicateBody.relatedRows.map((related: { coreMeasurementID: number }) => related.coreMeasurementID).sort();
      console.log('[details duplicate-type related rows]', JSON.stringify({ sameBatchRelatedIDs, duplicateRelatedIDs }));
      expect(duplicateBody.row.contradictionType).toBe(DUPLICATE_TAG_STEM);
      expect(duplicateRelatedIDs, 'duplicate related rows include the duplicate-only row').toEqual([SECOND_MEASUREMENT_ID, DUPLICATE_ONLY_MEASUREMENT_ID]);
    });
  });
});
