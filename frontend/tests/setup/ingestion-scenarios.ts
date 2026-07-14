/**
 * Table-driven ingestion scenarios consumed by ingestion-invariants.integration.test.ts.
 *
 * Each scenario is a real batch of temporarymeasurements rows plus the exact
 * IngestionOutcome bulkingestionprocess must produce for it. The expected values are
 * grounded in db/sql/storedprocedures.sql (see ingestion-outcome.ts for the mapping),
 * NOT invented — if the procedure regresses (silently drops a duplicate, mislabels a
 * code, miscounts a metric), the corresponding scenario goes red.
 *
 * Each scenario carries a STATIC name (so a test runner can enumerate the table before
 * the live database is up) and a `build(testData)` that produces the batch + expectation
 * from the real seed species/quadrat identifiers.
 *
 * Only the "uniform" cases live here (insert rows -> ingest -> assert outcome). Cases
 * needing extra machinery (multi-stem cardinality counts, active/inactive reference
 * seeding, constraint-dropped ambiguity schema, constraint-prevention DDL) are their
 * own tests in the suite because they assert more than a single outcome shape.
 */
import type { TestData } from './local-db-setup';
import { INGESTION_ALERT_TYPE, INGESTION_ERROR_CODE, type IngestionOutcome } from './ingestion-outcome';

export interface ScenarioMeasurement {
  treeTag: string;
  stemTag: string;
  speciesCode: string;
  quadratName: string;
  x: number;
  y: number;
  dbh: number;
  hom: number;
  date: string;
  codes?: string;
  comments?: string;
  publishedStemID?: number | null;
}

export interface ScenarioBatch {
  rows: ScenarioMeasurement[];
  expected: Partial<IngestionOutcome>;
}

export interface IngestionScenario {
  name: string;
  build(testData: TestData): ScenarioBatch;
}

export const MEASUREMENT_DATE = '2024-06-15';
const UNKNOWN_SPECIES_CODE = 'NOSUCHSP';
const UNKNOWN_QUADRAT_NAME = 'NOSUCHQ';

export const INGESTION_SCENARIOS: IngestionScenario[] = [
  {
    name: 'all-valid rows all succeed with no failures, error codes, or alerts',
    build(testData) {
      const species = testData.species[0].SpeciesCode;
      const otherSpecies = testData.species[1].SpeciesCode;
      const quadrat = testData.quadrats[0].QuadratName;
      return {
        rows: [
          { treeTag: 'VALID_A', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 1, y: 1, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'VALID_B', stemTag: '1', speciesCode: otherSpecies, quadratName: quadrat, x: 2, y: 2, dbh: 12, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'VALID_C', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 3, y: 3, dbh: 14, hom: 1.3, date: MEASUREMENT_DATE }
        ],
        expected: {
          sourceRecords: 3,
          successfulRows: 3,
          failedRows: 0,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 3,
          metricFailedRecords: 0,
          metricMissingRecords: 0,
          errorCodes: [],
          alertTypes: []
        }
      };
    }
  },
  {
    name: 'invalid species code surfaces one failed row tagged INVALID_SPECIES',
    build(testData) {
      const quadrat = testData.quadrats[0].QuadratName;
      return {
        rows: [
          { treeTag: 'BADSP_A', stemTag: '1', speciesCode: UNKNOWN_SPECIES_CODE, quadratName: quadrat, x: 4, y: 4, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE }
        ],
        expected: {
          sourceRecords: 1,
          successfulRows: 0,
          failedRows: 1,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 0,
          metricFailedRecords: 1,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.INVALID_SPECIES],
          alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
        }
      };
    }
  },
  {
    name: 'invalid quadrat name surfaces one failed row tagged INVALID_QUADRAT',
    build(testData) {
      const species = testData.species[0].SpeciesCode;
      return {
        rows: [
          { treeTag: 'BADQ_A', stemTag: '1', speciesCode: species, quadratName: UNKNOWN_QUADRAT_NAME, x: 5, y: 5, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE }
        ],
        expected: {
          sourceRecords: 1,
          successfulRows: 0,
          failedRows: 1,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 0,
          metricFailedRecords: 1,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.INVALID_QUADRAT],
          alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
        }
      };
    }
  },
  {
    name: 'exact duplicate is a surfaced DUPLICATE_ENTRY failure, not a silent drop (one row still ingests)',
    build(testData) {
      const species = testData.species[0].SpeciesCode;
      const quadrat = testData.quadrats[0].QuadratName;
      // Two byte-identical rows: Stage 2a collapses to one survivor; the other is surfaced.
      const identical: ScenarioMeasurement = {
        treeTag: 'DUP_A',
        stemTag: '1',
        speciesCode: species,
        quadratName: quadrat,
        x: 6,
        y: 6,
        dbh: 20,
        hom: 1.3,
        date: MEASUREMENT_DATE
      };
      return {
        rows: [{ ...identical }, { ...identical }],
        expected: {
          sourceRecords: 2,
          successfulRows: 1,
          failedRows: 1,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 1,
          metricFailedRecords: 1,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.DUPLICATE_ENTRY],
          alertTypes: [INGESTION_ALERT_TYPE.DUPLICATE_RECORDS]
        }
      };
    }
  },
  {
    name: 'duplicate TreeTag/StemTag with differing data fails ALL colliding rows as DUPLICATE_TAG_STEMTAG',
    build(testData) {
      const species = testData.species[0].SpeciesCode;
      const quadrat = testData.quadrats[0].QuadratName;
      // Same (TreeTag, StemTag) but different DBH => not an exact duplicate; Stage 2b flags
      // the whole collision group (no winner is chosen).
      return {
        rows: [
          { treeTag: 'TAGCOLL_A', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 7, y: 7, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'TAGCOLL_A', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 7, y: 7, dbh: 22, hom: 1.3, date: MEASUREMENT_DATE }
        ],
        expected: {
          sourceRecords: 2,
          successfulRows: 0,
          failedRows: 2,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 0,
          metricFailedRecords: 2,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.DUPLICATE_TAG_STEMTAG],
          alertTypes: [INGESTION_ALERT_TYPE.DUPLICATE_TAG_STEMTAG]
        }
      };
    }
  },
  {
    name: 'mixed batch: valid rows succeed, invalid-species row fails, and counts reconcile',
    build(testData) {
      const species = testData.species[0].SpeciesCode;
      const otherSpecies = testData.species[1].SpeciesCode;
      const quadrat = testData.quadrats[0].QuadratName;
      return {
        rows: [
          { treeTag: 'MIX_A', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 8, y: 8, dbh: 10, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'MIX_B', stemTag: '1', speciesCode: otherSpecies, quadratName: quadrat, x: 9, y: 9, dbh: 11, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'MIX_C', stemTag: '1', speciesCode: species, quadratName: quadrat, x: 10, y: 10, dbh: 12, hom: 1.3, date: MEASUREMENT_DATE },
          { treeTag: 'MIX_BAD', stemTag: '1', speciesCode: UNKNOWN_SPECIES_CODE, quadratName: quadrat, x: 11, y: 11, dbh: 13, hom: 1.3, date: MEASUREMENT_DATE }
        ],
        expected: {
          sourceRecords: 4,
          successfulRows: 3,
          failedRows: 1,
          remainingTemporaryRows: 0,
          metricProcessedRecords: 3,
          metricFailedRecords: 1,
          metricMissingRecords: 0,
          errorCodes: [INGESTION_ERROR_CODE.INVALID_SPECIES],
          alertTypes: [INGESTION_ALERT_TYPE.INVALID_REFERENCE_DATA]
        }
      };
    }
  }
];
