import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorExplorerFacetsResponse } from '@/config/errorsexplorer';
import * as production from '@/app/api/errors/explorer/_shared';
import { LOCALE_TIE_FALLBACK_WARNING, SIGNATURE_FALLBACK_WARNING, SIGNATURE_THRESHOLD_WARNING } from '@/app/api/errors/explorer/_shared';
import {
  buildHistogramWithFlagsStatement,
  ERROR_EXPLORER_STATEMENT_LABELS,
  SQL_FALSE,
  SQL_TRUE,
  type ErrorSignatureRow
} from '@/app/api/errors/explorer/errorsetsql';
import * as oracle from '../oracles/errors-explorer-legacy';
import { DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  assertLocalOrRefuse,
  createFixtureDatabaseSession,
  createRecordingExecutor,
  DISTINCT_SIGNATURE_MEASUREMENT_COUNT,
  distinctSignatureTypesFixture,
  EQUIVALENCE_GROUP_CONCAT_MAX_LEN,
  expectExplorerEqual,
  failedRowSignatureFixture,
  FAILED_SIGNATURE_MEASUREMENT_IDS,
  FIRST_CENSUS_ID,
  FIXTURE_HOOK_TIMEOUT_MS,
  localeTieErrorTypeFixture,
  localeTieMessageFixture,
  LOCALE_TIE_NFC_TEXT,
  LOCALE_TIE_NFD_TEXT,
  MAIN_PLOT_ID,
  MANY_TYPES_CUTTING_LIMIT,
  manyTypesFixture,
  replaceFixture,
  seedDistinctSignatureMeasurements,
  setGroupConcatMaxLen,
  SHARED_IDENTITY_CATALOG_ENTRY_LINK_COUNT,
  SHARED_IDENTITY_ERROR_TYPES,
  SHARED_IDENTITY_MEASUREMENT_COUNT,
  sharedIdentityFixture,
  SIGNATURE_WITNESS_COMPLETE_LIMIT,
  SIGNATURE_WITNESS_CUT_INSIDE_KEY_LIMIT,
  SIGNATURE_WITNESS_CUT_TO_OTHER_KEY_LIMIT,
  SIGNATURE_WITNESS_SHARED_KEYS,
  signatureWitnessFixture,
  type ExplorerFixture,
  type FixtureDatabase,
  type RecordedStatement
} from './helpers/errorsexplorerfixtures';

vi.mock('@/ailogger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const SIGNATURES_DATABASE = `${DEFAULT_TEST_CONFIG.database}_errsig`;
const LARGE_FIXTURE_TEST_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVE_COUNT_SQL_MARKER = 'SELECT COUNT(*) AS n';
const ACTIVE_COUNT_KIND = 'active-count';
const UNLABELLED_KIND = 'unlabelled';
const FACETS_REQUEST_KIND = 'facets';
const MESSAGE_COUNTS_REQUEST_KIND = 'message-counts';

type OracleExecutor = Parameters<typeof oracle.queryErrorExplorer>[0];
type ProductionExecutor = Parameters<typeof production.queryErrorExplorer>[0];

interface ComparedResults {
  facets: ErrorExplorerFacetsResponse;
  counts: production.ErrorMessageCounts;
  facetStatements: RecordedStatement[];
  countStatements: RecordedStatement[];
}

describe('errors explorer: signature histogram against the frozen oracle (#544)', () => {
  let fixtureDatabase: FixtureDatabase | null = null;
  const fixtureSession = createFixtureDatabaseSession(SIGNATURES_DATABASE);
  const warn = () => vi.mocked(ailogger.warn);

  const database = () => (fixtureDatabase as FixtureDatabase).database;
  const explorerConnection = () => (fixtureDatabase as FixtureDatabase).explorerConnection;
  const scope = () => ({ schema: database(), plotID: MAIN_PLOT_ID, censusID: FIRST_CENSUS_ID, censusIDs: [FIRST_CENSUS_ID] });
  const facetRequest = () => ({ ...scope(), filters: DEFAULT_ERROR_EXPLORER_FILTERS });
  const countsRequest = () => ({ schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [FIRST_CENSUS_ID] });

  async function loadFixture(fixture: ExplorerFixture): Promise<void> {
    await replaceFixture((fixtureDatabase as FixtureDatabase).setupConnection, fixture);
  }

  /**
   * mysql2 caches a prepared statement per SQL text, and MySQL fixes group_concat_max_len when the statement is prepared. A statement cached
   * under one limit would silently keep that limit under the next, so every statement a run used is dropped from the cache afterwards.
   */
  function forgetPreparedStatements(statements: readonly Pick<RecordedStatement, 'sql'>[]): void {
    statements.forEach(statement => explorerConnection().unprepare(statement.sql));
  }

  async function runProduction(limit: number): Promise<ComparedResults> {
    const facetRecorder = createRecordingExecutor(explorerConnection());
    const countRecorder = createRecordingExecutor(explorerConnection());
    await setGroupConcatMaxLen(explorerConnection(), limit);
    try {
      const facets = await production.buildErrorExplorerFacets(facetRecorder as unknown as ProductionExecutor, facetRequest());
      const counts = await production.buildErrorMessageCounts(countRecorder as unknown as ProductionExecutor, countsRequest());
      return { facets, counts, facetStatements: [...facetRecorder.statements], countStatements: [...countRecorder.statements] };
    } finally {
      forgetPreparedStatements([...facetRecorder.statements, ...countRecorder.statements]);
      await setGroupConcatMaxLen(explorerConnection(), EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
    }
  }

  async function runOracle(): Promise<{ facets: ErrorExplorerFacetsResponse; counts: production.ErrorMessageCounts }> {
    const recorder = createRecordingExecutor(explorerConnection());
    const executor = recorder as unknown as OracleExecutor;
    try {
      return {
        facets: await oracle.buildErrorExplorerFacets(executor, facetRequest()),
        counts: await oracle.buildErrorMessageCounts(executor, countsRequest())
      };
    } finally {
      forgetPreparedStatements(recorder.statements);
    }
  }

  async function expectProductionEqualsOracle(label: string, limit: number): Promise<ComparedResults> {
    const actual = await runProduction(limit);
    const expected = await runOracle();
    console.log(`[signatures] ${label} limit=${limit} facets=${JSON.stringify(actual.facets)} counts=${JSON.stringify(actual.counts)}`);
    console.log(
      `[signatures] ${label} statements facets=${JSON.stringify(actual.facetStatements.map(s => s.label))} counts=${JSON.stringify(actual.countStatements.map(s => s.label))}`
    );
    console.log(`[signatures] ${label} ailogger.warn calls=${JSON.stringify(warn().mock.calls)}`);
    await expectExplorerEqual(explorerConnection(), { label, limit, api: 'facets' }, actual.facets, expected.facets);
    await expectExplorerEqual(explorerConnection(), { label, limit, api: 'message-counts' }, actual.counts, expected.counts);
    return actual;
  }

  async function readHistogramRows(limit: number): Promise<ErrorSignatureRow[]> {
    await setGroupConcatMaxLen(explorerConnection(), limit);
    try {
      const statement = buildHistogramWithFlagsStatement({ schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [FIRST_CENSUS_ID] });
      return (await runQueryDispatch(explorerConnection(), statement.sql, statement.params)) as ErrorSignatureRow[];
    } finally {
      forgetPreparedStatements([{ sql: buildHistogramWithFlagsStatement({ schema: database(), plotID: MAIN_PLOT_ID, censusIDs: [FIRST_CENSUS_ID] }).sql }]);
      await setGroupConcatMaxLen(explorerConnection(), EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
    }
  }

  const warningMessages = () => warn().mock.calls.map(call => call[0]);
  const warningsOf = (message: string) => warn().mock.calls.filter(call => call[0] === message);
  const kindOf = (statement: RecordedStatement) => statement.label ?? (statement.sql.includes(ACTIVE_COUNT_SQL_MARKER) ? ACTIVE_COUNT_KIND : UNLABELLED_KIND);
  /** Facets run the catalog, the histogram and the active count at once, so their completion order is not fixed. */
  const sortedKindsOf = (statements: RecordedStatement[]) => statements.map(kindOf).sort();
  const usedOnlyCatalogAndHistogram = (statements: RecordedStatement[], histogramLabel: string) =>
    statements.every(statement => statement.label === ERROR_EXPLORER_STATEMENT_LABELS.catalog || statement.label === histogramLabel);
  const labelsOf = (statements: RecordedStatement[]) => statements.map(statement => statement.label);
  const SQL_FACET_KINDS = [ERROR_EXPLORER_STATEMENT_LABELS.catalog, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags, ACTIVE_COUNT_KIND].sort();
  const FALLBACK_FACET_KINDS = [...SQL_FACET_KINDS, ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows].sort();
  const FALLBACK_COUNT_LABELS = [
    ERROR_EXPLORER_STATEMENT_LABELS.catalog,
    ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags,
    ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows
  ];

  beforeAll(async () => {
    assertLocalOrRefuse();
    fixtureDatabase = await fixtureSession.open();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    fixtureDatabase = null;
    await fixtureSession.close();
  }, FIXTURE_HOOK_TIMEOUT_MS);

  describe('error types 1, 234 and 2345 with no type 23', () => {
    beforeAll(() => loadFixture(signatureWitnessFixture()), FIXTURE_HOOK_TIMEOUT_MS);

    it('limit 6 fits every signature: the SQL path answers, with no warning, and equals the oracle', async () => {
      const histogram = await readHistogramRows(SIGNATURE_WITNESS_COMPLETE_LIMIT);
      console.log(`[signatures] limit 6 histogram rows: ${JSON.stringify(histogram)}`);
      expect(histogram.map(row => [row.ErrorTypeKeys, Number(row.SignatureComplete)])).toEqual([
        ['1,234', SQL_TRUE],
        ['1,2345', SQL_TRUE]
      ]);

      const actual = await expectProductionEqualsOracle('limit 6', SIGNATURE_WITNESS_COMPLETE_LIMIT);

      expect(warningMessages(), 'no warning when every signature is whole').toEqual([]);
      expect(sortedKindsOf(actual.facetStatements), 'facets read only the catalog, the histogram and the active count').toEqual(SQL_FACET_KINDS);
      expect(
        usedOnlyCatalogAndHistogram(actual.countStatements, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags),
        'message counts read only the catalog and the histogram'
      ).toBe(true);
      expect(actual.counts).toEqual({
        totalMeasurements: 2,
        messages: [
          { value: 'Signature type 1', count: 2 },
          { value: 'Signature type 234', count: 1 },
          { value: 'Signature type 2345', count: 1 }
        ]
      });
    });

    it('limit 5 cuts the 1,2345 signature to the key 1,234: the histogram keeps the cut and the whole row apart and the request takes the Node path', async () => {
      const histogram = await readHistogramRows(SIGNATURE_WITNESS_CUT_TO_OTHER_KEY_LIMIT);
      console.log(`[signatures] limit 5 histogram rows: ${JSON.stringify(histogram)}`);
      const sharedKeyRows = histogram.filter(row => row.ErrorTypeKeys === SIGNATURE_WITNESS_SHARED_KEYS);
      expect(
        sharedKeyRows.map(row => [Number(row.SignatureComplete), Number(row.MeasurementCount)]).sort(),
        `the key ${SIGNATURE_WITNESS_SHARED_KEYS} appears once complete and once incomplete`
      ).toEqual([
        [SQL_FALSE, 1],
        [SQL_TRUE, 1]
      ]);

      const actual = await expectProductionEqualsOracle('limit 5', SIGNATURE_WITNESS_CUT_TO_OTHER_KEY_LIMIT);

      expect(
        warningsOf(SIGNATURE_FALLBACK_WARNING).map(call => call[1]),
        'one fallback warning per request'
      ).toEqual([expect.objectContaining({ requestKind: FACETS_REQUEST_KIND }), expect.objectContaining({ requestKind: MESSAGE_COUNTS_REQUEST_KIND })]);
      expect(
        sortedKindsOf(actual.facetStatements),
        'facets: catalog, histogram and active count, then one scope raw-rows statement and no member-group statement'
      ).toEqual(FALLBACK_FACET_KINDS);
      expect(
        actual.facetStatements.filter(statement => kindOf(statement) === ACTIVE_COUNT_KIND),
        'the fallback reuses the active count it already ran'
      ).toHaveLength(1);
      expect(labelsOf(actual.countStatements), 'message counts: catalog, histogram, then one scope raw-rows statement and no member-group statement').toEqual(
        FALLBACK_COUNT_LABELS
      );
      expect(
        actual.counts.messages.map(option => option.value),
        'the cut measurement was not counted under the whole 1,234 signature'
      ).toEqual(['Signature type 1', 'Signature type 234', 'Signature type 2345']);
    });

    it('limit 4 cuts both signatures to 1,23, which is no catalog key: the request takes the Node path and equals the oracle', async () => {
      const histogram = await readHistogramRows(SIGNATURE_WITNESS_CUT_INSIDE_KEY_LIMIT);
      console.log(`[signatures] limit 4 histogram rows: ${JSON.stringify(histogram)}`);
      expect(histogram.map(row => [row.ErrorTypeKeys, Number(row.SignatureComplete), Number(row.MeasurementCount)])).toEqual([['1,23', SQL_FALSE, 2]]);

      const actual = await expectProductionEqualsOracle('limit 4', SIGNATURE_WITNESS_CUT_INSIDE_KEY_LIMIT);

      expect(warningsOf(SIGNATURE_FALLBACK_WARNING)).toHaveLength(2);
      expect(sortedKindsOf(actual.facetStatements)).toEqual(FALLBACK_FACET_KINDS);
      expect(labelsOf(actual.countStatements)).toEqual(FALLBACK_COUNT_LABELS);
      expect(actual.counts.totalMeasurements).toBe(2);
    });
  });

  describe('one measurement carrying 40 error types', () => {
    beforeAll(() => loadFixture(manyTypesFixture()), FIXTURE_HOOK_TIMEOUT_MS);

    it('a limit that cuts its signature sends the request to the Node path and equals the oracle', async () => {
      const actual = await expectProductionEqualsOracle('40 types', MANY_TYPES_CUTTING_LIMIT);

      expect(warningsOf(SIGNATURE_FALLBACK_WARNING)).toHaveLength(2);
      expect(sortedKindsOf(actual.facetStatements)).toEqual(FALLBACK_FACET_KINDS);
      expect(labelsOf(actual.countStatements)).toEqual(FALLBACK_COUNT_LABELS);
      expect(actual.counts.totalMeasurements).toBe(1);
      expect(actual.counts.messages, 'every one of the 40 messages counts the one measurement').toHaveLength(40);
    });
  });

  describe('locale ties', () => {
    it('two messages that localeCompare calls equal keep the oracle order for message counts through the Node path, while the error types order by code on the SQL path', async () => {
      await loadFixture(localeTieMessageFixture());

      const actual = await expectProductionEqualsOracle('message tie', EQUIVALENCE_GROUP_CONCAT_MAX_LEN);

      expect(actual.counts.messages, 'the oracle meets the NFD message first because its measurement has the lower ID').toEqual([
        { value: LOCALE_TIE_NFD_TEXT, count: 1 },
        { value: LOCALE_TIE_NFC_TEXT, count: 1 }
      ]);
      expect(
        actual.facets.errorTypes.map(errorType => errorType.message),
        'the two codes differ, so the comparator separates the identities and the histogram order is already the oracle order'
      ).toEqual([LOCALE_TIE_NFC_TEXT, LOCALE_TIE_NFD_TEXT]);
      expect(
        warningsOf(LOCALE_TIE_FALLBACK_WARNING).map(call => call[1]),
        'only the message counts fall back'
      ).toEqual([expect.objectContaining({ requestKind: MESSAGE_COUNTS_REQUEST_KIND })]);
      expect(warningsOf(SIGNATURE_FALLBACK_WARNING), 'the signatures were whole: only the tie caused the fallback').toEqual([]);
      expect(sortedKindsOf(actual.facetStatements), 'facets stay on the SQL path').toEqual(SQL_FACET_KINDS);
      expect(labelsOf(actual.countStatements)).toEqual(FALLBACK_COUNT_LABELS);
    });

    it('two identities that tie on count, message, source and code keep the oracle order for error types and message counts through the Node path', async () => {
      await loadFixture(localeTieErrorTypeFixture());

      const actual = await expectProductionEqualsOracle('error type tie', EQUIVALENCE_GROUP_CONCAT_MAX_LEN);

      expect(
        actual.facets.errorTypes.map(errorType => errorType.message),
        'the oracle meets the NFD identity first because its measurement has the lower ID, the opposite of the histogram order'
      ).toEqual([LOCALE_TIE_NFD_TEXT, LOCALE_TIE_NFC_TEXT]);
      expect(warningsOf(LOCALE_TIE_FALLBACK_WARNING).map(call => call[1])).toEqual([
        expect.objectContaining({ requestKind: FACETS_REQUEST_KIND }),
        expect.objectContaining({ requestKind: MESSAGE_COUNTS_REQUEST_KIND })
      ]);
      expect(warningsOf(SIGNATURE_FALLBACK_WARNING), 'the signatures were whole: only the tie caused the fallback').toEqual([]);
      expect(sortedKindsOf(actual.facetStatements), 'catalog, histogram and active count, then the scope raw rows').toEqual(FALLBACK_FACET_KINDS);
      expect(
        actual.facetStatements.filter(statement => kindOf(statement) === ACTIVE_COUNT_KIND),
        'the fallback reuses the active count it already ran'
      ).toHaveLength(1);
      expect(labelsOf(actual.countStatements)).toEqual(FALLBACK_COUNT_LABELS);
    });
  });

  describe('failed rows in the histogram key', () => {
    beforeAll(() => loadFixture(failedRowSignatureFixture()), FIXTURE_HOOK_TIMEOUT_MS);

    it('keeps a failed row and an intact row with the same error types in two histogram rows and counts one failed measurement', async () => {
      const histogram = await readHistogramRows(EQUIVALENCE_GROUP_CONCAT_MAX_LEN);
      console.log(`[signatures] failed-row histogram rows: ${JSON.stringify(histogram)}`);
      expect(
        histogram.map(row => [row.ErrorTypeKeys, Number(row.IsFailedRow), Number(row.MeasurementCount)]).sort(),
        `measurements ${FAILED_SIGNATURE_MEASUREMENT_IDS.failed} (failed) and ${FAILED_SIGNATURE_MEASUREMENT_IDS.intact} share one signature`
      ).toEqual([
        ['1', SQL_FALSE, 1],
        ['1', SQL_TRUE, 1]
      ]);

      const actual = await expectProductionEqualsOracle('failed row signature', EQUIVALENCE_GROUP_CONCAT_MAX_LEN);

      expect(actual.facets.censusTotals.failedMeasurements).toBe(1);
      expect(actual.facets.censusTotals.affectedMeasurements).toBe(2);
      expect(sortedKindsOf(actual.facetStatements)).toEqual(SQL_FACET_KINDS);
    });
  });

  describe('one identity under two catalog entries', () => {
    beforeAll(() => loadFixture(sharedIdentityFixture()), FIXTURE_HOOK_TIMEOUT_MS);

    it('counts a measurement once for an identity it carries through two NULL-code catalog rows', async () => {
      expect(
        SHARED_IDENTITY_ERROR_TYPES.map(type => type.code),
        'the fixture must have two catalog entries with a NULL code'
      ).toEqual([null, null]);

      const actual = await expectProductionEqualsOracle('shared identity', EQUIVALENCE_GROUP_CONCAT_MAX_LEN);

      console.log(
        `[signatures] shared identity: measurements=${SHARED_IDENTITY_MEASUREMENT_COUNT} catalogEntryLinks=${SHARED_IDENTITY_CATALOG_ENTRY_LINK_COUNT} errorTypes=${JSON.stringify(actual.facets.errorTypes)}`
      );
      expect(actual.facets.errorTypes).toHaveLength(1);
      expect(actual.facets.errorTypes[0].count, 'two measurements, not the three links').toBe(SHARED_IDENTITY_MEASUREMENT_COUNT);
      expect(actual.facets.censusTotals.errorTypeCount, 'one identity').toBe(1);
      expect(actual.facets.censusTotals.affectedMeasurements).toBe(SHARED_IDENTITY_MEASUREMENT_COUNT);
      expect(sortedKindsOf(actual.facetStatements)).toEqual(SQL_FACET_KINDS);
    });
  });

  describe('14 error types over 10,500 measurements with distinct type sets', () => {
    beforeAll(async () => {
      await loadFixture(distinctSignatureTypesFixture());
      await seedDistinctSignatureMeasurements((fixtureDatabase as FixtureDatabase).setupConnection);
    }, FIXTURE_HOOK_TIMEOUT_MS);

    it(
      'equals the oracle, raises no error and logs the threshold warning with the signature count',
      async () => {
        const actual = await expectProductionEqualsOracle('10,500 distinct signatures', EQUIVALENCE_GROUP_CONCAT_MAX_LEN);

        expect(actual.counts.totalMeasurements).toBe(DISTINCT_SIGNATURE_MEASUREMENT_COUNT);
        expect(actual.facets.censusTotals.affectedMeasurements).toBe(DISTINCT_SIGNATURE_MEASUREMENT_COUNT);
        expect(warningsOf(SIGNATURE_THRESHOLD_WARNING).map(call => call[1])).toEqual([
          expect.objectContaining({ requestKind: FACETS_REQUEST_KIND, signatureRows: DISTINCT_SIGNATURE_MEASUREMENT_COUNT }),
          expect.objectContaining({ requestKind: MESSAGE_COUNTS_REQUEST_KIND, signatureRows: DISTINCT_SIGNATURE_MEASUREMENT_COUNT })
        ]);
        expect(warningsOf(SIGNATURE_FALLBACK_WARNING), 'every signature was whole').toEqual([]);
        expect(sortedKindsOf(actual.facetStatements)).toEqual(SQL_FACET_KINDS);
        expect(usedOnlyCatalogAndHistogram(actual.countStatements, ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags)).toBe(true);
      },
      LARGE_FIXTURE_TEST_TIMEOUT_MS
    );
  });
});
