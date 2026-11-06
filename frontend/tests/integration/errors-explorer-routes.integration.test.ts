import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import type { ErrorExplorerFilters, ErrorExplorerRow } from '@/config/errorsexplorer';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import {
  assertLocalOrRefuse,
  openFixtureDatabase,
  replaceFixture,
  type ExplorerFixture,
  type FixtureDatabase,
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
const FIRST_MEASUREMENT_ID = 101;
const SECOND_MEASUREMENT_ID = 102;
const FAILED_MEASUREMENT_ID = 201;
const RESOLVED_MEASUREMENT_ID = 202;
const MEASUREMENT_WITH_TWO_ERRORS = 201;

const VALIDATION_DUPLICATE_TAG_ID = 5;
const VALIDATION_SAME_BATCH_ID = 21;
const VALIDATION_DBH_OUTLIER_ID = 5;

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
  connection: null as Connection | null
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
      return runQueryDispatch(sharedState.connection, query, params);
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

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
    description: 'row 101',
    rawCodes: 'MX,I',
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
    speciesCode: 'SP2',
    quadratName: 'Q2',
    stemLocalX: 12,
    stemLocalY: 22,
    measurementDate: '2026-01-02',
    measuredDBH: 6.2,
    measuredHOM: 1.4,
    description: 'row 102',
    rawCodes: 'A',
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

function unresolvedLog(measurementID: number, errorID: number): FixtureLog {
  return { measurementID, errorID, isResolved: false };
}

function fixtureOf(parts: Pick<ExplorerFixture, 'errorTypes' | 'validations' | 'measurements' | 'logs'>): ExplorerFixture {
  return {
    plotIDs: [PLOT_ID],
    censuses: [{ censusID: CENSUS_ID, plotID: PLOT_ID, plotCensusNumber: PLOT_CENSUS_NUMBER }],
    ...parts
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

/** 101 and 102 share TREE-1/A (duplicate group) and one upload batch with two species (same-batch group). */
function contradictingPairFixture(options: { userDefinedFields: Record<string, unknown>; firstRowIngestionError: boolean }): ExplorerFixture {
  const sharedUserDefinedFields = options.userDefinedFields;
  return fixtureOf({
    errorTypes: [DUPLICATE_TAG_VALIDATION_ERROR, SAME_BATCH_VALIDATION_ERROR, DUPLICATE_TAG_INGESTION_ERROR],
    validations: [DUPLICATE_TAG_VALIDATION, SAME_BATCH_VALIDATION],
    measurements: [firstMeasurement({ userDefinedFields: sharedUserDefinedFields }), secondMeasurement({ userDefinedFields: sharedUserDefinedFields })],
    logs: [
      unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
      ...(options.firstRowIngestionError ? [unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_INGESTION_ERROR.errorID)] : []),
      unresolvedLog(SECOND_MEASUREMENT_ID, SAME_BATCH_VALIDATION_ERROR.errorID)
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

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await openFixtureDatabase(ROUTES_DATABASE);
    sharedState.connection = fixtureDatabase.explorerConnection;
  });

  afterAll(async () => {
    sharedState.connection = null;
    const opened = fixtureDatabase;
    fixtureDatabase = null;
    await opened?.teardown();
  });

  describe('POST /api/errors/explorer/query', () => {
    it('returns grouped row-centric error data with contradiction links', async () => {
      await replaceFixture(connection(), contradictingPairFixture({ userDefinedFields: { treestemstate: 'old tree' }, firstRowIngestionError: true }));
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(queryRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[query contradiction links]', JSON.stringify({ totalRows: body.totalRows, summary: body.summary, firstRow: body.rows[0] }));

      expect(body.totalRows).toBe(2);
      expect(body.rows[0]).toMatchObject({
        coreMeasurementID: 101,
        rawCodes: 'MX,I',
        hasContradiction: true,
        contradictionType: 'duplicate_tag_stem'
      });
      expect(body.rows[0].contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem', 'same_batch_conflict']));
      expect(body.rows[0].errorMessages).toContain('Duplicate tree/stem tag');
      expect(body.rows[0].errorSources).toEqual(expect.arrayContaining(['validation', 'ingestion']));
      expect(body.rows[0].relatedMeasurementIDs).toEqual([102]);
      expect(body.summary.contradictions).toBe(2);
      expect(body.summary.duplicateTagStem).toBe(2);
      expect(body.summary.sameBatchConflict).toBe(2);
    });

    it('surfaces overlapping contradiction rows in same-batch filters', async () => {
      await replaceFixture(connection(), contradictingPairFixture({ userDefinedFields: { treestemstate: 'old tree' }, firstRowIngestionError: false }));
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(
        queryRequest(schema(), { ...NO_FILTERS, contradictionOnly: true, contradictionTypes: ['same_batch_conflict'] }),
        ROUTE_CONTEXT
      );

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[query same-batch filter]', JSON.stringify({ totalRows: body.totalRows, firstRow: body.rows[0] }));

      expect(body.totalRows).toBe(2);
      expect(body.rows[0]).toMatchObject({
        coreMeasurementID: 101,
        rawCodes: 'MX,I',
        contradictionType: 'same_batch_conflict',
        relatedMeasurementIDs: [102]
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
            secondMeasurement({ coreMeasurementID: RESOLVED_MEASUREMENT_ID, treeTag: 'TREE-2', stemTag: 'B', description: 'row 202' })
          ],
          logs: [unresolvedLog(FAILED_MEASUREMENT_ID, invalidSpeciesError.errorID), unresolvedLog(RESOLVED_MEASUREMENT_ID, dbhOutlierError.errorID)]
        })
      );
      const { POST } = await import('@/app/api/errors/explorer/query/route');

      const response = await POST(queryRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      const failedRow = body.rows.find((row: ErrorExplorerRow) => row.coreMeasurementID === FAILED_MEASUREMENT_ID);
      const resolvedRow = body.rows.find((row: ErrorExplorerRow) => row.coreMeasurementID === RESOLVED_MEASUREMENT_ID);
      console.log('[query isFailedRow]', JSON.stringify({ failedRow, resolvedRow }));

      expect(failedRow.isFailedRow).toBe(true);
      expect(resolvedRow.isFailedRow).toBe(false);
    });
  });

  describe('POST /api/errors/explorer/facets', () => {
    it('returns message and field facets scoped to the current census', async () => {
      await replaceFixture(
        connection(),
        fixtureOf({
          errorTypes: [DUPLICATE_TAG_VALIDATION_ERROR, DUPLICATE_TAG_INGESTION_ERROR],
          validations: [DUPLICATE_TAG_VALIDATION],
          measurements: [firstMeasurement({ userDefinedFields: {} }), secondMeasurement({ treeTag: 'TREE-2', stemTag: 'B', userDefinedFields: {} })],
          logs: [
            unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
            unresolvedLog(SECOND_MEASUREMENT_ID, DUPLICATE_TAG_INGESTION_ERROR.errorID)
          ]
        })
      );
      const { POST } = await import('@/app/api/errors/explorer/facets/route');

      const response = await POST(facetsRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[facets messages and fields]', JSON.stringify({ messages: body.messages, fields: body.fields }));

      expect(body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'Duplicate tree/stem tag', count: 1 }),
          expect.objectContaining({ value: 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch', count: 1 })
        ])
      );
      expect(body.fields).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'treeTag', count: 2 })]));
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

      const response = await POST(facetsRequest(schema(), NO_FILTERS), ROUTE_CONTEXT);

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[#547 facets total]', JSON.stringify({ totalMeasurements: body.totalMeasurements, messages: body.messages }));
      expect(body.messages.map((option: { value: string }) => option.value).sort()).toEqual([SECOND_TWO_ERRORS_MESSAGE, FIRST_TWO_ERRORS_MESSAGE].sort());
      expect(body.totalMeasurements, 'two messages on one measurement are one affected measurement').toBe(1);
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
            secondMeasurement({ userDefinedFields: {}, uploadBatchID: 'batch-2', stemLocalX: DETAIL_STEM_LOCAL_X, stemLocalY: DETAIL_STEM_LOCAL_Y })
          ],
          logs: [
            unresolvedLog(FIRST_MEASUREMENT_ID, DUPLICATE_TAG_VALIDATION_ERROR.errorID),
            unresolvedLog(SECOND_MEASUREMENT_ID, SAME_BATCH_VALIDATION_ERROR.errorID)
          ]
        })
      );
      const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');

      const response = await GET(detailsRequest(schema(), FIRST_MEASUREMENT_ID), detailsContext(FIRST_MEASUREMENT_ID));

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[details related rows]', JSON.stringify({ row: body.row, allErrors: body.allErrors, relatedRows: body.relatedRows }));

      expect(body.row).toMatchObject({
        coreMeasurementID: 101,
        rawCodes: 'MX,I',
        hasContradiction: true,
        contradictionType: 'duplicate_tag_stem'
      });
      expect(body.row.contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem']));
      expect(body.allErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: '5',
            message: 'Duplicate tree/stem tag',
            fields: ['treeTag', 'stemTag']
          })
        ])
      );
      expect(body.relatedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            coreMeasurementID: 102,
            speciesCode: 'SP2',
            stemLocalX: `${DETAIL_STEM_LOCAL_X}${DECIMAL_SCALE_SUFFIX}`,
            stemLocalY: `${DETAIL_STEM_LOCAL_Y}${DECIMAL_SCALE_SUFFIX}`,
            description: 'row 102',
            errorCount: 1,
            errorMessages: ['Same-batch species conflict']
          })
        ])
      );
    });

    it('uses the requested contradiction type when a row belongs to multiple groups', async () => {
      await replaceFixture(connection(), contradictingPairFixture({ userDefinedFields: {}, firstRowIngestionError: false }));
      const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');

      const response = await GET(detailsRequest(schema(), FIRST_MEASUREMENT_ID, 'same_batch_conflict'), detailsContext(FIRST_MEASUREMENT_ID));

      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      console.log('[details requested contradiction type]', JSON.stringify({ row: body.row, relatedRows: body.relatedRows }));

      expect(body.row).toMatchObject({
        coreMeasurementID: 101,
        rawCodes: 'MX,I',
        contradictionType: 'same_batch_conflict'
      });
      expect(body.row.contradictionTypes).toEqual(expect.arrayContaining(['duplicate_tag_stem', 'same_batch_conflict']));
      expect(body.relatedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            coreMeasurementID: 102,
            speciesCode: 'SP2'
          })
        ])
      );
    });
  });
});
