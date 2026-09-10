/**
 * Integration tests for the operator-run Smithsonian Stem PX/PY backfill
 * script (issue #475): db/ops/2026-09-09-backfill-stem-plot-coordinates.sql.
 *
 * These tests execute the REAL TEXT of the script's marked sections (via
 * readOpsScriptSections/executeSection, see ./helpers/ops-script-sections)
 * against a fresh destination database built from the canonical CTFS DDL —
 * never a test-owned copy of the SQL. This is what proves the script an
 * operator pastes into a MySQL client, statement by statement, behaves as
 * the header documents.
 *
 * The seed is one array of scenario rows (SCENARIO_STEMS below), each
 * describing a stem's quadrat, existing PX/PY, local QX/QY, and the
 * censuses it was measured in. Both the seed SQL AND every EXPECTED_*
 * count are derived from that same array (via deriveStems, which mirrors
 * the script's own CANDIDATE SELECT logic in plain TypeScript) plus the
 * QUADRAT_ORIGINS lookup — no hand-typed count literals. This is what
 * keeps the seed and the assertions from silently drifting apart.
 *
 * Prerequisites: docker compose up -d mysql
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { splitSqlFile } from '../../lib/provisioning/sql-runner';
import { loadCanonicalDestinationDdl } from './helpers/ctfs-destination-ddl';
import { readOpsScriptSections, executeSection, type MetricMap } from './helpers/ops-script-sections';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPS_SCRIPT_PATH = path.resolve(__dirname, '../../db/ops/2026-09-09-backfill-stem-plot-coordinates.sql');

// The ops script file is static for the whole test run — read and split it
// once at module scope rather than re-parsing it in every test's beforeEach.
const { preamble, sections } = readOpsScriptSections(OPS_SCRIPT_PATH);

// ---------------------------------------------------------------------------
// Seed constants
// ---------------------------------------------------------------------------

const TARGET_PLOT_ID = 1;
const OTHER_PLOT_ID = 2;

const LISTED_CENSUS_ID_1 = 1;
const LISTED_CENSUS_ID_2 = 2;
const LEGACY_CENSUS_ID = 3; // target plot, NOT in @census_ids
const OTHER_PLOT_CENSUS_ID = 9;
const UNKNOWN_CENSUS_ID = 999; // does not exist in Census at all
const LISTED_CENSUS_IDS = `'${LISTED_CENSUS_ID_1},${LISTED_CENSUS_ID_2}'`;
const LISTED_CENSUS_ID_SET = new Set([LISTED_CENSUS_ID_1, LISTED_CENSUS_ID_2]);

const QUADRAT_ORIGIN_ID = 1; // origin (40,60) via 4 corner Coordinates rows
const QUADRAT_ZERO_ORIGIN_ID = 2; // origin (0,0) via 4 corner Coordinates rows
const QUADRAT_MISSING_PX_ORIGIN_ID = 3; // Coordinates rows: PX NULL, PY populated
const QUADRAT_NO_COORDINATES_ID = 4; // no Coordinates rows at all
const OTHER_PLOT_QUADRAT_ID = 9;

const ORIGIN_PX = 40;
const ORIGIN_PY = 60;
const ZERO_ORIGIN = 0;
const PARTIAL_ORIGIN_PY = 20; // Q3's only known axis (MIN of two PY-bearing rows)
const OTHER_PLOT_ORIGIN_PX = 5;
const OTHER_PLOT_ORIGIN_PY = 5;

const PLOT_DIMENSION_X = 100;
const PLOT_DIMENSION_Y = 100;

// Must match the script's own `SET @existing_value_tolerance := 0.001;`
// (setup section) — used only by the derived disagreement checks below.
const EXISTING_VALUE_TOLERANCE = 0.001;

const DECIMAL_PLACES = 5;
const fmt = (n: number): string => n.toFixed(DECIMAL_PLACES);

// Quadrat origins, exactly as the seed's Coordinates rows reduce to via
// MIN(PX)/MIN(PY) — the same reduction the CANDIDATE SELECT's origin
// subquery performs. This table plus SCENARIO_STEMS below is the single
// source every EXPECTED_* count is derived from.
interface QuadratOrigin {
  plotId: number;
  originPx: number | null;
  originPy: number | null;
}

const QUADRAT_ORIGINS: Record<number, QuadratOrigin> = {
  [QUADRAT_ORIGIN_ID]: { plotId: TARGET_PLOT_ID, originPx: ORIGIN_PX, originPy: ORIGIN_PY },
  [QUADRAT_ZERO_ORIGIN_ID]: { plotId: TARGET_PLOT_ID, originPx: ZERO_ORIGIN, originPy: ZERO_ORIGIN },
  [QUADRAT_MISSING_PX_ORIGIN_ID]: { plotId: TARGET_PLOT_ID, originPx: null, originPy: PARTIAL_ORIGIN_PY },
  [QUADRAT_NO_COORDINATES_ID]: { plotId: TARGET_PLOT_ID, originPx: null, originPy: null },
  [OTHER_PLOT_QUADRAT_ID]: { plotId: OTHER_PLOT_ID, originPx: OTHER_PLOT_ORIGIN_PX, originPy: OTHER_PLOT_ORIGIN_PY }
};

// Stem identifiers — kept as named constants purely as keys into
// SCENARIO_STEMS and EXPECTED_REPAIRS; every count derived from them below.
const STEM_BOTH_NULL_ID = 101;
const STEM_PX_NULL_ONLY_ID = 102;
const STEM_PY_NULL_ONLY_ID = 103;
const STEM_SHARED_CENSUS_ID = 104;
const STEM_ZERO_POPULATED_ID = 105;
const STEM_MISSING_LOCAL_X_ID = 106;
const STEM_MISSING_ORIGIN_X_ID = 107;
const STEM_MISSING_BOTH_ORIGINS_ID = 108;
const STEM_DISAGREEING_PX_ID = 109;
const STEM_LEGACY_FLAGGED_ID = 110;
const STEM_LEGACY_ONLY_ID = 111;
const STEM_OTHER_PLOT_ID = 112;
const STEM_POPULATED_PX_MISSING_LOCAL_ID = 114;
const STEM_OUT_OF_BOUNDS_ID = 113; // added only in the bounds-blocking test (test 5)

// Local (QX/QY) offsets and any deliberately-populated PX/PY values. Kept as
// named constants for readability inside SCENARIO_STEMS and in comments.
const STEM_BOTH_NULL_QX = 1.25;
const STEM_BOTH_NULL_QY = 2.5;
const STEM_PX_NULL_ONLY_QX = 3.0;
const STEM_PX_NULL_ONLY_QY = 2.5; // existing PY is set to origin+QY below (no disagreement)
const STEM_PY_NULL_ONLY_QX = 1.25; // existing PX is set to origin+QX below (no disagreement)
const STEM_PY_NULL_ONLY_QY = 5.0;
const STEM_SHARED_CENSUS_QX = 6.0;
const STEM_SHARED_CENSUS_QY = 7.0;
const STEM_MISSING_ORIGIN_X_QX = 10.0;
const STEM_MISSING_ORIGIN_X_QY = 5.0;
const STEM_MISSING_BOTH_ORIGINS_QX = 1.0;
const STEM_MISSING_BOTH_ORIGINS_QY = 1.0;
const STEM_DISAGREEING_PX_VALUE = 999.0; // deliberately far from origin+QX
const STEM_DISAGREEING_PX_QX = 1.25;
const STEM_DISAGREEING_PX_QY = 2.5; // PY kept consistent so only PX disagrees
const STEM_LEGACY_FLAGGED_QX = 8.0;
const STEM_LEGACY_FLAGGED_QY = 9.0;
const STEM_LEGACY_ONLY_QX = 1.5;
const STEM_LEGACY_ONLY_QY = 1.5;
const STEM_OTHER_PLOT_QX = 1.0;
const STEM_OTHER_PLOT_QY = 1.0;
const STEM_POPULATED_PX_MISSING_LOCAL_PX = 12.34; // arbitrary populated value; QX is NULL so never a "proposal"
const STEM_POPULATED_PX_MISSING_LOCAL_QY = 3.0; // PY repairable: 60 + 3.0 = 63.0, in bounds
const STEM_OUT_OF_BOUNDS_QX = 65.0; // 40 + 65 = 105 > PLOT_DIMENSION_X
const STEM_OUT_OF_BOUNDS_QY = 2.5;

// ---------------------------------------------------------------------------
// Scenario rows — the single source of truth. Each row drives BOTH the seed
// SQL (Tree/Stem/DBH) AND every derived EXPECTED_* count below.
// ---------------------------------------------------------------------------

interface ScenarioStem {
  stemId: number;
  quadratId: number;
  px: number | null;
  py: number | null;
  qx: number | null;
  qy: number | null;
  censusIds: number[];
  note: string;
}

const SCENARIO_STEMS: ScenarioStem[] = [
  {
    stemId: STEM_BOTH_NULL_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: null,
    py: null,
    qx: STEM_BOTH_NULL_QX,
    qy: STEM_BOTH_NULL_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'both axes NULL, DBH in a listed census -> repairs both axes'
  },
  {
    stemId: STEM_PX_NULL_ONLY_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: null,
    py: ORIGIN_PY + STEM_PX_NULL_ONLY_QY,
    qx: STEM_PX_NULL_ONLY_QX,
    qy: STEM_PX_NULL_ONLY_QY,
    censusIds: [LISTED_CENSUS_ID_2],
    note: 'PX NULL only (PY already == origin+QY, no disagreement) -> repairs PX only'
  },
  {
    stemId: STEM_PY_NULL_ONLY_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: ORIGIN_PX + STEM_PY_NULL_ONLY_QX,
    py: null,
    qx: STEM_PY_NULL_ONLY_QX,
    qy: STEM_PY_NULL_ONLY_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'PY NULL only (PX already == origin+QX, no disagreement) -> repairs PY only'
  },
  {
    stemId: STEM_SHARED_CENSUS_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: null,
    py: null,
    qx: STEM_SHARED_CENSUS_QX,
    qy: STEM_SHARED_CENSUS_QY,
    censusIds: [LISTED_CENSUS_ID_1, LISTED_CENSUS_ID_2],
    note: 'both axes NULL, DBH in BOTH listed censuses -> counted and repaired once'
  },
  {
    stemId: STEM_ZERO_POPULATED_ID,
    quadratId: QUADRAT_ZERO_ORIGIN_ID,
    px: ZERO_ORIGIN,
    py: ZERO_ORIGIN,
    qx: ZERO_ORIGIN,
    qy: ZERO_ORIGIN,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'populated zero on both axes (origin also zero) -> already complete, never changed'
  },
  {
    stemId: STEM_MISSING_LOCAL_X_ID,
    quadratId: QUADRAT_ZERO_ORIGIN_ID,
    px: null,
    py: ZERO_ORIGIN,
    qx: null,
    qy: ZERO_ORIGIN,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'PX NULL with QX also NULL (missing local) -> cannot repair PX'
  },
  {
    stemId: STEM_MISSING_ORIGIN_X_ID,
    quadratId: QUADRAT_MISSING_PX_ORIGIN_ID,
    px: null,
    py: null,
    qx: STEM_MISSING_ORIGIN_X_QX,
    qy: STEM_MISSING_ORIGIN_X_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'quadrat origin PX missing -> PX unrepairable, PY repairable'
  },
  {
    stemId: STEM_MISSING_BOTH_ORIGINS_ID,
    quadratId: QUADRAT_NO_COORDINATES_ID,
    px: null,
    py: null,
    qx: STEM_MISSING_BOTH_ORIGINS_QX,
    qy: STEM_MISSING_BOTH_ORIGINS_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'quadrat has no Coordinates rows at all -> neither axis repairable'
  },
  {
    stemId: STEM_DISAGREEING_PX_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: STEM_DISAGREEING_PX_VALUE,
    py: ORIGIN_PY + STEM_DISAGREEING_PX_QY,
    qx: STEM_DISAGREEING_PX_QX,
    qy: STEM_DISAGREEING_PX_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note: 'PX populated but disagrees with origin+QX -> reported, never changed'
  },
  {
    stemId: STEM_LEGACY_FLAGGED_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: null,
    py: null,
    qx: STEM_LEGACY_FLAGGED_QX,
    qy: STEM_LEGACY_FLAGGED_QY,
    censusIds: [LISTED_CENSUS_ID_1, LEGACY_CENSUS_ID],
    note: 'DBH in a listed AND the legacy census -> still a candidate, flagged + repaired'
  },
  {
    stemId: STEM_LEGACY_ONLY_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: null,
    py: null,
    qx: STEM_LEGACY_ONLY_QX,
    qy: STEM_LEGACY_ONLY_QY,
    censusIds: [LEGACY_CENSUS_ID],
    note: 'DBH ONLY in the legacy (unlisted) census -> NOT a candidate at all'
  },
  {
    stemId: STEM_OTHER_PLOT_ID,
    quadratId: OTHER_PLOT_QUADRAT_ID,
    px: null,
    py: null,
    qx: STEM_OTHER_PLOT_QX,
    qy: STEM_OTHER_PLOT_QY,
    censusIds: [OTHER_PLOT_CENSUS_ID],
    note: 'wrong plot -> NOT a candidate regardless of census'
  },
  {
    stemId: STEM_POPULATED_PX_MISSING_LOCAL_ID,
    quadratId: QUADRAT_ORIGIN_ID,
    px: STEM_POPULATED_PX_MISSING_LOCAL_PX,
    py: null,
    qx: null,
    qy: STEM_POPULATED_PX_MISSING_LOCAL_QY,
    censusIds: [LISTED_CENSUS_ID_1],
    note:
      'regression seed for the px_expected_still_null bug: PX populated (never "still null") but QX NULL ' +
      '(so ProposedPX is NULL); PY NULL and repairable. The old buggy `WHERE ProposedPX IS NULL` counted this ' +
      'stem in px_expected_still_null even though it disagreed with candidates_still_null_px, which correctly ' +
      'excludes a populated axis.'
  }
];

// Out-of-bounds stem for the whole-plot-bounds-blocking test (test 5) only —
// kept separate from SCENARIO_STEMS so the base seed's counts are unaffected
// by it.
const OOB_STEM: ScenarioStem = {
  stemId: STEM_OUT_OF_BOUNDS_ID,
  quadratId: QUADRAT_ORIGIN_ID,
  px: null,
  py: null,
  qx: STEM_OUT_OF_BOUNDS_QX,
  qy: STEM_OUT_OF_BOUNDS_QY,
  censusIds: [LISTED_CENSUS_ID_1],
  note: 'proposed PX 105 > PLOT_DIMENSION_X 100 -> out of bounds, blocks the whole plot'
};

// Simulates a stem published AFTER the backup snapshot already ran (test 9
// only) — kept separate from SCENARIO_STEMS so the base seed's counts are
// unaffected by it. Both axes are repairable and in bounds, so `transaction`
// (which rebuilds candidates from live data) repairs it even though
// `backup` never saw it.
const STEM_CONCURRENT_PUBLISH_ID = 115;
const STEM_CONCURRENT_PUBLISH_QX = 2.0;
const STEM_CONCURRENT_PUBLISH_QY = 3.0;
const CONCURRENT_PUBLISH_STEM: ScenarioStem = {
  stemId: STEM_CONCURRENT_PUBLISH_ID,
  quadratId: QUADRAT_ORIGIN_ID,
  px: null,
  py: null,
  qx: STEM_CONCURRENT_PUBLISH_QX,
  qy: STEM_CONCURRENT_PUBLISH_QY,
  censusIds: [LISTED_CENSUS_ID_1],
  note: 'published after the backup snapshot -> repaired by transaction but absent from stem_px_backup_20260909'
};

// ---------------------------------------------------------------------------
// Derivation — mirrors the script's CANDIDATE SELECT (see the ops script's
// "CANDIDATE SELECT START/END" blocks) in plain TypeScript, so every
// EXPECTED_* count below is computed, not hand-typed.
// ---------------------------------------------------------------------------

interface DerivedStem extends ScenarioStem {
  isCandidate: boolean;
  proposedPx: number | null;
  proposedPy: number | null;
  repairPx: boolean;
  repairPy: boolean;
  outOfBoundsPx: boolean;
  outOfBoundsPy: boolean;
  disagreesPx: boolean;
  disagreesPy: boolean;
  measuredOutsideListed: boolean;
}

function deriveStems(scenarioStems: ScenarioStem[], plotDimensionX: number, plotDimensionY: number): DerivedStem[] {
  return scenarioStems.map(stem => {
    const origin = QUADRAT_ORIGINS[stem.quadratId];
    const isCandidate = origin.plotId === TARGET_PLOT_ID && stem.censusIds.some(c => LISTED_CENSUS_ID_SET.has(c));

    const proposedPx = origin.originPx === null || stem.qx === null ? null : origin.originPx + stem.qx;
    const proposedPy = origin.originPy === null || stem.qy === null ? null : origin.originPy + stem.qy;

    const inBoundsPx = proposedPx !== null && proposedPx >= 0 && proposedPx <= plotDimensionX;
    const inBoundsPy = proposedPy !== null && proposedPy >= 0 && proposedPy <= plotDimensionY;

    const repairPx = stem.px === null && proposedPx !== null && inBoundsPx;
    const repairPy = stem.py === null && proposedPy !== null && inBoundsPy;
    const outOfBoundsPx = stem.px === null && proposedPx !== null && !inBoundsPx;
    const outOfBoundsPy = stem.py === null && proposedPy !== null && !inBoundsPy;

    const disagreesPx = stem.px !== null && proposedPx !== null && Math.abs(stem.px - proposedPx) > EXISTING_VALUE_TOLERANCE;
    const disagreesPy = stem.py !== null && proposedPy !== null && Math.abs(stem.py - proposedPy) > EXISTING_VALUE_TOLERANCE;

    const measuredOutsideListed = stem.censusIds.some(c => !LISTED_CENSUS_ID_SET.has(c));

    return { ...stem, isCandidate, proposedPx, proposedPy, repairPx, repairPy, outOfBoundsPx, outOfBoundsPy, disagreesPx, disagreesPy, measuredOutsideListed };
  });
}

function findDerived(derived: DerivedStem[], stemId: number): DerivedStem {
  const found = derived.find(s => s.stemId === stemId);
  if (!found) throw new Error(`Stem ${stemId} not found in derived scenario`);
  return found;
}

const BASE_DERIVED = deriveStems(SCENARIO_STEMS, PLOT_DIMENSION_X, PLOT_DIMENSION_Y);
const BASE_CANDIDATES = BASE_DERIVED.filter(s => s.isCandidate);

// Every candidate that needs at least one axis repaired, and which axes, and
// the exact 5-decimal replacement string. Anything not listed here must be
// byte-identical before and after the run.
const EXPECTED_REPAIRS: Record<number, { px?: string; py?: string }> = {};
for (const stem of BASE_CANDIDATES) {
  if (stem.repairPx || stem.repairPy) {
    EXPECTED_REPAIRS[stem.stemId] = {
      ...(stem.repairPx ? { px: fmt(stem.proposedPx!) } : {}),
      ...(stem.repairPy ? { py: fmt(stem.proposedPy!) } : {})
    };
  }
}

const EXPECTED_DISTINCT_CANDIDATES = BASE_CANDIDATES.length;
const EXPECTED_CANDIDATES_MEASURED_OUTSIDE_LISTED = BASE_CANDIDATES.filter(s => s.measuredOutsideListed).length;
const EXPECTED_CANDIDATES_ALREADY_COMPLETE = BASE_CANDIDATES.filter(s => s.px !== null && s.py !== null).length;
const EXPECTED_STEMS_NEEDING_REPAIR = BASE_CANDIDATES.filter(s => s.repairPx || s.repairPy).length;
const EXPECTED_PX_REPAIRS = BASE_CANDIDATES.filter(s => s.repairPx).length;
const EXPECTED_PY_REPAIRS = BASE_CANDIDATES.filter(s => s.repairPy).length;
const EXPECTED_PX_MISSING_ORIGIN = BASE_CANDIDATES.filter(s => s.px === null && QUADRAT_ORIGINS[s.quadratId].originPx === null).length;
const EXPECTED_PX_MISSING_LOCAL = BASE_CANDIDATES.filter(s => s.px === null && s.qx === null).length;
const EXPECTED_PY_MISSING_ORIGIN = BASE_CANDIDATES.filter(s => s.py === null && QUADRAT_ORIGINS[s.quadratId].originPy === null).length;
const EXPECTED_PY_MISSING_LOCAL = BASE_CANDIDATES.filter(s => s.py === null && s.qy === null).length;
const EXPECTED_PX_EXISTING_DISAGREES = BASE_CANDIDATES.filter(s => s.disagreesPx).length;
const EXPECTED_PY_EXISTING_DISAGREES = BASE_CANDIDATES.filter(s => s.disagreesPy).length;
const EXPECTED_PX_OUT_OF_BOUNDS_BASE = BASE_CANDIDATES.filter(s => s.outOfBoundsPx).length;
const EXPECTED_PY_OUT_OF_BOUNDS_BASE = BASE_CANDIDATES.filter(s => s.outOfBoundsPy).length;
const EXPECTED_CANDIDATES_STILL_NULL_PX = BASE_CANDIDATES.filter(s => s.px === null && !s.repairPx).length;
const EXPECTED_CANDIDATES_STILL_NULL_PY = BASE_CANDIDATES.filter(s => s.py === null && !s.repairPy).length;
const EXPECTED_ROWS_UPDATED = EXPECTED_STEMS_NEEDING_REPAIR;

// Bounds-blocking scenario (test 5): adds OOB_STEM on top of the base seed,
// re-derived from scratch rather than assumed to be "+1".
const WITH_OOB_CANDIDATES = deriveStems([...SCENARIO_STEMS, OOB_STEM], PLOT_DIMENSION_X, PLOT_DIMENSION_Y).filter(s => s.isCandidate);
const EXPECTED_DISTINCT_CANDIDATES_WITH_OOB = WITH_OOB_CANDIDATES.length;
const EXPECTED_STEMS_NEEDING_REPAIR_WITH_OOB = WITH_OOB_CANDIDATES.filter(s => s.repairPx || s.repairPy).length;
const EXPECTED_PX_OUT_OF_BOUNDS_WITH_OOB = WITH_OOB_CANDIDATES.filter(s => s.outOfBoundsPx).length;

// Concurrent-publish scenario (test 9): adds CONCURRENT_PUBLISH_STEM on top
// of the base seed, re-derived from scratch — proves `transaction` picks up
// and repairs a stem `backup` never saw.
const WITH_CONCURRENT_CANDIDATES = deriveStems([...SCENARIO_STEMS, CONCURRENT_PUBLISH_STEM], PLOT_DIMENSION_X, PLOT_DIMENSION_Y).filter(s => s.isCandidate);
const EXPECTED_STEMS_NEEDING_REPAIR_WITH_CONCURRENT = WITH_CONCURRENT_CANDIDATES.filter(s => s.repairPx || s.repairPy).length;

// Rollback-with-intervening-edit scenario (test 8) exercises BOTH divergence
// branches:
//  - STEM_PX_NULL_ONLY_ID has RepairPY = 0 (its PY was already populated), so
//    editing its repaired PX after commit excludes the WHOLE row from the
//    rollback UPDATE's WHERE clause (neither axis clause matches) — diverged,
//    but not restored at all.
//  - STEM_BOTH_NULL_ID has RepairPX = 1 AND RepairPY = 1. Editing only its PX
//    diverges that one axis, but the row still matches the WHERE clause via
//    its still-matching PY clause — a PARTIAL restore: PY goes back to NULL,
//    the edited PX is preserved.
const ROLLBACK_TEST_EDITS: { stemId: number; editedAxis: 'px' | 'py' }[] = [
  { stemId: STEM_PX_NULL_ONLY_ID, editedAxis: 'px' },
  { stemId: STEM_BOTH_NULL_ID, editedAxis: 'px' }
];
const EXPECTED_ROLLBACK_AXES_DIVERGED = ROLLBACK_TEST_EDITS.length;
// A row is entirely excluded from the restore (and so drops out of
// rollback_rows_restored) only when the OTHER axis's repair flag is false —
// otherwise the row still matches via that other axis's clause.
const ROLLBACK_FULLY_EXCLUDED_COUNT = ROLLBACK_TEST_EDITS.filter(edit => {
  const derived = findDerived(BASE_CANDIDATES, edit.stemId);
  const otherAxisRepaired = edit.editedAxis === 'px' ? derived.repairPy : derived.repairPx;
  return !otherAxisRepaired;
}).length;
const EXPECTED_ROLLBACK_ROWS_RESTORED = EXPECTED_STEMS_NEEDING_REPAIR - ROLLBACK_FULLY_EXCLUDED_COUNT;
const INTERVENING_EDIT_PX_VALUE = fmt(777); // STEM_PX_NULL_ONLY_ID — whole row excluded from restore
const PARTIAL_DIVERGENCE_EDIT_PX_VALUE = fmt(888); // STEM_BOTH_NULL_ID — only PX excluded; PY still restored

const SECTION_NAMES = ['inputs', 'setup', 'preview', 'backup', 'transaction', 'verification', 'rollback', 'cleanup'] as const;

// ---------------------------------------------------------------------------
// Seed SQL — generated from SCENARIO_STEMS (plus the structural fixtures:
// Site/Census/Quadrat/Coordinates/taxonomy, which define QUADRAT_ORIGINS
// itself rather than being "counts").
// ---------------------------------------------------------------------------

function sqlNumberOrNull(value: number | null): string {
  return value === null ? 'NULL' : String(value);
}

function sqlDecimalOrNull(value: number | null): string {
  return value === null ? 'NULL' : fmt(value);
}

function buildTreeRowSql(stem: ScenarioStem): string {
  return `(${stem.stemId}, 1, 'T${stem.stemId}')`;
}

function buildStemRowSql(stem: ScenarioStem): string {
  return `(${stem.stemId}, ${stem.stemId}, ${stem.quadratId}, 1, ${sqlDecimalOrNull(stem.px)}, ${sqlDecimalOrNull(stem.py)}, ${sqlNumberOrNull(stem.qx)}, ${sqlNumberOrNull(stem.qy)})`;
}

function buildDbhRowsSql(scenarioStems: ScenarioStem[]): string[] {
  const rows: string[] = [];
  let measureId = 1;
  for (const stem of scenarioStems) {
    for (const censusId of stem.censusIds) {
      rows.push(`(${measureId}, ${censusId}, ${stem.stemId}, 10)`);
      measureId += 1;
    }
  }
  return rows;
}

function buildSeedSql(includeOutOfBoundsStem: boolean): string {
  const scenarioStems = includeOutOfBoundsStem ? [...SCENARIO_STEMS, OOB_STEM] : SCENARIO_STEMS;

  return `
INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize)
VALUES
  (${TARGET_PLOT_ID}, 'TARGET', 'Target plot', 1, 'rectangle', 'Backfill test target plot', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y'),
  (${OTHER_PLOT_ID}, 'OTHER', 'Other plot', 1, 'rectangle', 'Backfill test other plot', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y');

INSERT INTO Census (CensusID, PlotID, PlotCensusNumber) VALUES
  (${LISTED_CENSUS_ID_1}, ${TARGET_PLOT_ID}, '1'),
  (${LISTED_CENSUS_ID_2}, ${TARGET_PLOT_ID}, '2'),
  (${LEGACY_CENSUS_ID}, ${TARGET_PLOT_ID}, '3'),
  (${OTHER_PLOT_CENSUS_ID}, ${OTHER_PLOT_ID}, '1');

INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${QUADRAT_ORIGIN_ID}, ${TARGET_PLOT_ID}, 'Q1', 'Y'),
  (${QUADRAT_ZERO_ORIGIN_ID}, ${TARGET_PLOT_ID}, 'Q2', 'Y'),
  (${QUADRAT_MISSING_PX_ORIGIN_ID}, ${TARGET_PLOT_ID}, 'Q3', 'Y'),
  (${QUADRAT_NO_COORDINATES_ID}, ${TARGET_PLOT_ID}, 'Q4', 'Y'),
  (${OTHER_PLOT_QUADRAT_ID}, ${OTHER_PLOT_ID}, 'Q9', 'Y');

-- Q1 origin (40,60): four corner rows, MIN(PX)/MIN(PY) reduces to the origin.
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${TARGET_PLOT_ID}, ${QUADRAT_ORIGIN_ID}, ${ORIGIN_PX}, ${ORIGIN_PY}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ORIGIN_ID}, ${ORIGIN_PX + 20}, ${ORIGIN_PY}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ORIGIN_ID}, ${ORIGIN_PX}, ${ORIGIN_PY + 20}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ORIGIN_ID}, ${ORIGIN_PX + 20}, ${ORIGIN_PY + 20});

-- Q2 origin (0,0): four corner rows.
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${TARGET_PLOT_ID}, ${QUADRAT_ZERO_ORIGIN_ID}, ${ZERO_ORIGIN}, ${ZERO_ORIGIN}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ZERO_ORIGIN_ID}, ${ZERO_ORIGIN + 20}, ${ZERO_ORIGIN}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ZERO_ORIGIN_ID}, ${ZERO_ORIGIN}, ${ZERO_ORIGIN + 20}),
  (${TARGET_PLOT_ID}, ${QUADRAT_ZERO_ORIGIN_ID}, ${ZERO_ORIGIN + 20}, ${ZERO_ORIGIN + 20});

-- Q3: every Coordinates row has PX NULL — origin PX is unrecoverable, PY is not.
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${TARGET_PLOT_ID}, ${QUADRAT_MISSING_PX_ORIGIN_ID}, NULL, ${PARTIAL_ORIGIN_PY}),
  (${TARGET_PLOT_ID}, ${QUADRAT_MISSING_PX_ORIGIN_ID}, NULL, ${PARTIAL_ORIGIN_PY + 10});

-- Q4: no Coordinates rows at all — both origin axes unrecoverable.

-- Q9 (other plot): origin present but out of scope for @plot_id = TARGET_PLOT_ID.
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${OTHER_PLOT_ID}, ${OTHER_PLOT_QUADRAT_ID}, ${OTHER_PLOT_ORIGIN_PX}, ${OTHER_PLOT_ORIGIN_PY});

INSERT INTO Family (FamilyID, Family) VALUES (1, 'Testaceae');
INSERT INTO Genus (GenusID, Genus, FamilyID) VALUES (1, 'Foobaria', 1);
INSERT INTO Species (SpeciesID, GenusID, SpeciesName) VALUES (1, 1, 'foo');

INSERT INTO Tree (TreeID, SpeciesID, Tag) VALUES
  ${scenarioStems.map(buildTreeRowSql).join(',\n  ')};

INSERT INTO Stem (StemID, TreeID, QuadratID, StemNumber, PX, PY, QX, QY) VALUES
  ${scenarioStems.map(buildStemRowSql).join(',\n  ')};

INSERT INTO DBH (MeasureID, CensusID, StemID, DBH) VALUES
  ${buildDbhRowsSql(scenarioStems).join(',\n  ')};
`;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

async function loadSeed(conn: mysql.Connection, includeOutOfBoundsStem = false): Promise<void> {
  const sql = buildSeedSql(includeOutOfBoundsStem)
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  for (const stmt of splitSqlFile(sql)) {
    if (!stmt.sql.trim()) continue;
    await conn.query(stmt.sql);
  }
}

interface InputsOverride {
  plotId?: number | null;
  censusIds?: string | null; // already quoted, e.g. "'1,2'", or null
  dimensionX?: number | null;
  dimensionY?: number | null;
}

function buildInputsSql(overrides: InputsOverride = {}): string {
  const plotId = overrides.plotId === undefined ? TARGET_PLOT_ID : overrides.plotId;
  const censusIds = overrides.censusIds === undefined ? LISTED_CENSUS_IDS : overrides.censusIds;
  const dimensionX = overrides.dimensionX === undefined ? PLOT_DIMENSION_X : overrides.dimensionX;
  const dimensionY = overrides.dimensionY === undefined ? PLOT_DIMENSION_Y : overrides.dimensionY;
  return `
SET @plot_id := ${plotId === null ? 'NULL' : plotId};
SET @census_ids := ${censusIds === null ? 'NULL' : censusIds};
SET @plot_dimension_x := ${dimensionX === null ? 'NULL' : dimensionX};
SET @plot_dimension_y := ${dimensionY === null ? 'NULL' : dimensionY};
`;
}

/**
 * Runs one or more named sections in order on the same session, merging
 * their metrics into a single map. A metric name shared by two sections is
 * last-write-wins (e.g. `preview` and `transaction` both emit
 * `distinct_candidates`). That is safe only because those two sections
 * recompute the identical CANDIDATE SELECT — when called back-to-back
 * against unmodified data they must agree, and they are only ever expected
 * to disagree once `transaction`'s UPDATE has actually changed the data
 * `verification` reads afterward (whose metric names do not overlap
 * preview/transaction's at all). Test 2 asserts, once, that preview and
 * transaction actually agree on every metric name they share, so a future
 * edit that lets the two CANDIDATE SELECT copies drift apart fails loudly
 * instead of being silently masked by this merge.
 */
async function runSections(conn: mysql.Connection, sectionMap: Map<string, string>, names: string[]): Promise<MetricMap> {
  const merged: MetricMap = new Map();
  for (const name of names) {
    const sectionSql = sectionMap.get(name);
    if (sectionSql === undefined) throw new Error(`Section not found in ops script: ${name}`);
    const metrics = await executeSection(conn, sectionSql);
    for (const [key, value] of metrics) merged.set(key, value);
  }
  return merged;
}

async function runInputsAndSections(conn: mysql.Connection, sectionMap: Map<string, string>, inputsSql: string, names: string[]): Promise<MetricMap> {
  await executeSection(conn, inputsSql);
  return runSections(conn, sectionMap, names);
}

interface StemRow {
  StemID: number;
  PX: string | null;
  PY: string | null;
}

async function snapshotStems(conn: mysql.Connection): Promise<Map<number, { PX: string | null; PY: string | null }>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT StemID, PX, PY FROM Stem ORDER BY StemID');
  const snapshot = new Map<number, { PX: string | null; PY: string | null }>();
  for (const row of rows as unknown as StemRow[]) {
    snapshot.set(row.StemID, { PX: row.PX === null ? null : String(row.PX), PY: row.PY === null ? null : String(row.PY) });
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Static checks — no database needed, so these run without the per-test
// database lifecycle below.
// ---------------------------------------------------------------------------

describe('stem-plot-coordinate-backfill ops script: static checks (no DB)', () => {
  it('has a comment-only preamble before the first marker, and the sections appear in the required order', () => {
    for (const line of preamble.split('\n')) {
      const trimmed = line.trim();
      const isCommentOrBlank = trimmed === '' || trimmed.startsWith('--');
      expect(isCommentOrBlank, `Non-comment, non-blank line before the first SECTION marker: ${JSON.stringify(line)}`).toBe(true);
    }

    // Map insertion order mirrors the order the markers appear in the file.
    expect(Array.from(sections.keys()), 'section order').toEqual(SECTION_NAMES);
  });

  it('has exactly three byte-identical CANDIDATE SELECT blocks', () => {
    const raw = readFileSync(OPS_SCRIPT_PATH, 'utf8');
    const START_MARKER = '-- CANDIDATE SELECT START';
    const END_MARKER = '-- CANDIDATE SELECT END';

    const blocks: string[] = [];
    let searchFrom = 0;
    while (true) {
      const start = raw.indexOf(START_MARKER, searchFrom);
      if (start === -1) break;
      const end = raw.indexOf(END_MARKER, start);
      expect(end, `CANDIDATE SELECT START at offset ${start} has no matching END`).toBeGreaterThan(-1);
      blocks.push(raw.slice(start + START_MARKER.length, end));
      searchFrom = end + END_MARKER.length;
    }

    expect(blocks.length, 'CANDIDATE SELECT block count').toBe(3);
    expect(new Set(blocks).size, 'all three CANDIDATE SELECT blocks must be byte-identical').toBe(1);
  });

  // Pins the scenario-derived counts to today's known-good values so a
  // future edit to SCENARIO_STEMS or deriveStems that silently changes a
  // count is caught here — fast, without a database — rather than only
  // surfacing as a confusing mismatch deep in a DB-backed test below.
  it('scenario-derived expected counts match the known-good values', () => {
    expect(EXPECTED_DISTINCT_CANDIDATES, 'EXPECTED_DISTINCT_CANDIDATES').toBe(11);
    expect(EXPECTED_CANDIDATES_MEASURED_OUTSIDE_LISTED, 'EXPECTED_CANDIDATES_MEASURED_OUTSIDE_LISTED').toBe(1);
    expect(EXPECTED_CANDIDATES_ALREADY_COMPLETE, 'EXPECTED_CANDIDATES_ALREADY_COMPLETE').toBe(2);
    expect(EXPECTED_STEMS_NEEDING_REPAIR, 'EXPECTED_STEMS_NEEDING_REPAIR').toBe(7);
    expect(EXPECTED_PX_REPAIRS, 'EXPECTED_PX_REPAIRS').toBe(4);
    expect(EXPECTED_PY_REPAIRS, 'EXPECTED_PY_REPAIRS').toBe(6);
    expect(EXPECTED_PX_MISSING_ORIGIN, 'EXPECTED_PX_MISSING_ORIGIN').toBe(2);
    expect(EXPECTED_PX_MISSING_LOCAL, 'EXPECTED_PX_MISSING_LOCAL').toBe(1);
    expect(EXPECTED_PY_MISSING_ORIGIN, 'EXPECTED_PY_MISSING_ORIGIN').toBe(1);
    expect(EXPECTED_PY_MISSING_LOCAL, 'EXPECTED_PY_MISSING_LOCAL').toBe(0);
    expect(EXPECTED_PX_EXISTING_DISAGREES, 'EXPECTED_PX_EXISTING_DISAGREES').toBe(1);
    expect(EXPECTED_PY_EXISTING_DISAGREES, 'EXPECTED_PY_EXISTING_DISAGREES').toBe(0);
    expect(EXPECTED_CANDIDATES_STILL_NULL_PX, 'EXPECTED_CANDIDATES_STILL_NULL_PX').toBe(3);
    expect(EXPECTED_CANDIDATES_STILL_NULL_PY, 'EXPECTED_CANDIDATES_STILL_NULL_PY').toBe(1);
    expect(EXPECTED_ROLLBACK_ROWS_RESTORED, 'EXPECTED_ROLLBACK_ROWS_RESTORED').toBe(6);
    expect(EXPECTED_DISTINCT_CANDIDATES_WITH_OOB, 'EXPECTED_DISTINCT_CANDIDATES_WITH_OOB').toBe(12);
    expect(EXPECTED_STEMS_NEEDING_REPAIR_WITH_OOB, 'EXPECTED_STEMS_NEEDING_REPAIR_WITH_OOB').toBe(8);
    expect(EXPECTED_PX_OUT_OF_BOUNDS_WITH_OOB, 'EXPECTED_PX_OUT_OF_BOUNDS_WITH_OOB').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Database lifecycle — one isolated destination database per test.
// ---------------------------------------------------------------------------

const createdDatabases: string[] = [];

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  const conn = await mysql.createConnection({
    host: DEFAULT_TEST_CONFIG.host,
    user: DEFAULT_TEST_CONFIG.user,
    password: DEFAULT_TEST_CONFIG.password,
    port: DEFAULT_TEST_CONFIG.port
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)', [createdDatabases]);
    const leaked = rows.map(r => r.SCHEMA_NAME as string);
    expect(leaked, `Databases leaked by this file (teardown failed to drop them): ${leaked.join(', ')}`).toEqual([]);
  } finally {
    await conn.end();
  }
});

describe('stem-plot-coordinate-backfill ops script: section-by-section execution', () => {
  let conn: mysql.Connection;
  let dbName: string;

  beforeEach(async () => {
    const stamp = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    dbName = `forestgeo_pxb_${stamp}`;
    createdDatabases.push(dbName);

    conn = await createTestDatabase({ ...DEFAULT_TEST_CONFIG, database: dbName });
    await loadCanonicalDestinationDdl(conn);
  });

  afterEach(async () => {
    if (conn) {
      try {
        await teardownTestDatabase(conn, { database: dbName });
      } catch (err) {
        // best-effort cleanup — the file-level afterAll tripwire catches
        // leaks, but log so a real teardown failure isn't silently invisible.
        console.error(`Failed to tear down test database ${dbName}:`, err);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 0 — the shipped placeholders refuse, and their SET statements parse
  // -------------------------------------------------------------------------

  it('the shipped inputs section, run verbatim, refuses via inputs_ok = 0 (unfilled Cocoli placeholders)', async () => {
    await loadSeed(conn);
    // No override — this is the script's own `inputs` section text
    // (SET ... := NULL; with trailing comments) exactly as shipped, proving
    // both that the placeholder SET statements parse and that setup refuses
    // them.
    const metrics = await runSections(conn, sections, ['inputs', 'setup']);
    expect(metrics.get('inputs_ok'), 'inputs_ok with unfilled placeholders').toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 1 — preview metrics against the known seed
  // -------------------------------------------------------------------------

  it('preview reports every metric against the seed’s known candidate set', async () => {
    await loadSeed(conn);
    const metrics = await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);

    expect(metrics.get('inputs_ok'), 'inputs_ok').toBe(1);
    expect(metrics.get('distinct_candidates'), 'distinct_candidates').toBe(EXPECTED_DISTINCT_CANDIDATES);
    expect(metrics.get('candidates_measured_outside_listed_censuses'), 'candidates_measured_outside_listed_censuses').toBe(
      EXPECTED_CANDIDATES_MEASURED_OUTSIDE_LISTED
    );
    expect(metrics.get('candidates_already_complete'), 'candidates_already_complete').toBe(EXPECTED_CANDIDATES_ALREADY_COMPLETE);
    expect(metrics.get('stems_needing_repair'), 'stems_needing_repair').toBe(EXPECTED_STEMS_NEEDING_REPAIR);
    expect(metrics.get('px_repairs'), 'px_repairs').toBe(EXPECTED_PX_REPAIRS);
    expect(metrics.get('py_repairs'), 'py_repairs').toBe(EXPECTED_PY_REPAIRS);
    expect(metrics.get('px_missing_origin'), 'px_missing_origin').toBe(EXPECTED_PX_MISSING_ORIGIN);
    expect(metrics.get('px_missing_local'), 'px_missing_local').toBe(EXPECTED_PX_MISSING_LOCAL);
    expect(metrics.get('py_missing_origin'), 'py_missing_origin').toBe(EXPECTED_PY_MISSING_ORIGIN);
    expect(metrics.get('py_missing_local'), 'py_missing_local').toBe(EXPECTED_PY_MISSING_LOCAL);
    expect(metrics.get('px_existing_disagrees'), 'px_existing_disagrees').toBe(EXPECTED_PX_EXISTING_DISAGREES);
    expect(metrics.get('py_existing_disagrees'), 'py_existing_disagrees').toBe(EXPECTED_PY_EXISTING_DISAGREES);
    expect(metrics.get('px_out_of_bounds'), 'px_out_of_bounds').toBe(EXPECTED_PX_OUT_OF_BOUNDS_BASE);
    expect(metrics.get('py_out_of_bounds'), 'py_out_of_bounds').toBe(EXPECTED_PY_OUT_OF_BOUNDS_BASE);
    expect(metrics.get('bounds_ok'), 'bounds_ok').toBe(1);
    expect(metrics.get('repair_allowed'), 'repair_allowed').toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2 — transaction + COMMIT
  // -------------------------------------------------------------------------

  it('transaction + COMMIT repairs exactly the expected axes and leaves everything else untouched', async () => {
    await loadSeed(conn);
    const before = await snapshotStems(conn);

    const previewMetrics = await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    const backupMetrics = await executeSection(conn, sections.get('backup')!);
    const transactionMetrics = await executeSection(conn, sections.get('transaction')!);

    // `preview` and `transaction` both recompute the identical CANDIDATE
    // SELECT; at this point (transaction's UPDATE hasn't run yet) they read
    // the exact same unmodified data, so every metric name they share must
    // agree. This is the one-time check backing runSections' last-write-wins
    // merge — see its docstring.
    for (const [key, transactionValue] of transactionMetrics) {
      if (previewMetrics.has(key)) {
        expect(transactionValue, `metric "${key}" must agree between preview and transaction (both read unmodified data)`).toBe(previewMetrics.get(key));
      }
    }

    const verificationMetrics = await executeSection(conn, sections.get('verification')!);
    const metrics: MetricMap = new Map([...previewMetrics, ...backupMetrics, ...transactionMetrics, ...verificationMetrics]);
    await conn.query('COMMIT');

    expect(metrics.get('rows_updated'), 'rows_updated').toBe(EXPECTED_ROWS_UPDATED);
    expect(metrics.get('rows_updated_matches_stems_needing_repair'), 'rows_updated_matches_stems_needing_repair').toBe(1);
    expect(metrics.get('repaired_axes_not_equal_replacement'), 'repaired_axes_not_equal_replacement').toBe(0);
    expect(metrics.get('stems_repaired_not_in_backup'), 'stems_repaired_not_in_backup').toBe(0);
    expect(metrics.get('candidates_still_null_px'), 'candidates_still_null_px').toBe(EXPECTED_CANDIDATES_STILL_NULL_PX);
    expect(metrics.get('candidates_still_null_py'), 'candidates_still_null_py').toBe(EXPECTED_CANDIDATES_STILL_NULL_PY);
    expect(metrics.get('px_expected_still_null'), 'px_expected_still_null').toBe(EXPECTED_CANDIDATES_STILL_NULL_PX);
    expect(metrics.get('py_expected_still_null'), 'py_expected_still_null').toBe(EXPECTED_CANDIDATES_STILL_NULL_PY);
    expect(metrics.get('fresh_rebuild_proposes'), 'fresh_rebuild_proposes').toBe(0);

    // Full before/after snapshot: every repaired axis equals its exact
    // replacement value; every other axis (candidate or not) is unchanged.
    const after = await snapshotStems(conn);
    for (const [stemId, beforeRow] of before) {
      const afterRow = after.get(stemId)!;
      const repair = EXPECTED_REPAIRS[stemId];
      expect(afterRow.PX, `Stem ${stemId} PX`).toBe(repair?.px ?? beforeRow.PX);
      expect(afterRow.PY, `Stem ${stemId} PY`).toBe(repair?.py ?? beforeRow.PY);
    }

    // Shared-census stem counted and updated exactly once.
    const sharedRepair = EXPECTED_REPAIRS[STEM_SHARED_CENSUS_ID];
    expect(after.get(STEM_SHARED_CENSUS_ID)!.PX).toBe(sharedRepair.px);
    expect(after.get(STEM_SHARED_CENSUS_ID)!.PY).toBe(sharedRepair.py);

    // Backup table holds exactly the repaired stems, with OriginalPX/PY NULL
    // on the axis that was actually repaired.
    const [backupRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT StemID, OriginalPX, OriginalPY, RepairPX, RepairPY FROM stem_px_backup_20260909 ORDER BY StemID'
    );
    const backupStemIds = (backupRows as any[]).map(r => r.StemID).sort((a, b) => a - b);
    expect(backupStemIds, 'backup table StemIDs').toEqual(
      Object.keys(EXPECTED_REPAIRS)
        .map(Number)
        .sort((a, b) => a - b)
    );
    for (const row of backupRows as any[]) {
      const repair = EXPECTED_REPAIRS[row.StemID];
      if (repair?.px) {
        expect(row.RepairPX, `Stem ${row.StemID} backup RepairPX`).toBe(1);
        expect(row.OriginalPX, `Stem ${row.StemID} backup OriginalPX`).toBeNull();
      }
      if (repair?.py) {
        expect(row.RepairPY, `Stem ${row.StemID} backup RepairPY`).toBe(1);
        expect(row.OriginalPY, `Stem ${row.StemID} backup OriginalPY`).toBeNull();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 3 — rerun after commit proposes nothing further
  // -------------------------------------------------------------------------

  it('rerun after commit (cleanup, setup, preview, verification) proposes zero further repairs', async () => {
    await loadSeed(conn);
    await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    await runSections(conn, sections, ['backup', 'transaction']);
    await conn.query('COMMIT');

    const rerun = await runInputsAndSections(conn, sections, buildInputsSql(), ['cleanup', 'setup', 'preview', 'verification']);

    expect(rerun.get('stems_needing_repair'), 'stems_needing_repair after rerun').toBe(0);
    expect(rerun.get('fresh_rebuild_proposes'), 'fresh_rebuild_proposes after rerun').toBe(0);
    // The irreparable candidates are still exactly the irreparable ones.
    expect(rerun.get('px_missing_origin'), 'px_missing_origin after rerun').toBe(EXPECTED_PX_MISSING_ORIGIN);
    expect(rerun.get('px_missing_local'), 'px_missing_local after rerun').toBe(EXPECTED_PX_MISSING_LOCAL);
    expect(rerun.get('py_missing_origin'), 'py_missing_origin after rerun').toBe(EXPECTED_PY_MISSING_ORIGIN);
  });

  // -------------------------------------------------------------------------
  // Test 4 — transaction + ROLLBACK
  // -------------------------------------------------------------------------

  it('transaction + ROLLBACK leaves Stem identical to its pre-transaction state', async () => {
    await loadSeed(conn);
    const before = await snapshotStems(conn);

    await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    const metrics = await runSections(conn, sections, ['backup', 'transaction']);
    expect(metrics.get('rows_updated'), 'rows_updated before rollback').toBe(EXPECTED_ROWS_UPDATED);

    await conn.query('ROLLBACK');

    const after = await snapshotStems(conn);
    expect(after).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Test 5 — whole-plot bounds blocking
  // -------------------------------------------------------------------------

  it('a single out-of-bounds candidate blocks the whole plot: 0 rows updated, nothing repaired', async () => {
    await loadSeed(conn, /* includeOutOfBoundsStem */ true);
    const before = await snapshotStems(conn);

    const previewMetrics = await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    expect(previewMetrics.get('distinct_candidates'), 'distinct_candidates with OOB stem').toBe(EXPECTED_DISTINCT_CANDIDATES_WITH_OOB);
    expect(previewMetrics.get('stems_needing_repair'), 'stems_needing_repair with OOB stem').toBe(EXPECTED_STEMS_NEEDING_REPAIR_WITH_OOB);
    expect(previewMetrics.get('px_out_of_bounds'), 'px_out_of_bounds').toBe(EXPECTED_PX_OUT_OF_BOUNDS_WITH_OOB);
    expect(previewMetrics.get('bounds_ok'), 'bounds_ok').toBe(0);
    expect(previewMetrics.get('repair_allowed'), 'repair_allowed').toBe(0);

    const txMetrics = await runSections(conn, sections, ['backup', 'transaction']);
    expect(txMetrics.get('rows_updated'), 'rows_updated when repair_allowed = 0').toBe(0);
    await conn.query('ROLLBACK');

    const after = await snapshotStems(conn);
    expect(after, 'no candidate — in or out of bounds — was repaired').toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Test 6 — missing/invalid inputs are refused
  // -------------------------------------------------------------------------

  it('refuses to repair when inputs are missing or invalid, in each documented way', async () => {
    await loadSeed(conn);
    // `transaction` never reads the backup table (only `verification` and
    // `rollback` do), so these sub-cases deliberately skip `backup` —
    // running it more than once in this test would hit the
    // ER_TABLE_EXISTS_ERROR refusal covered separately in test 7.

    // 6a: missing plot dimension.
    const missingDimension = await runInputsAndSections(conn, sections, buildInputsSql({ dimensionX: null }), ['setup', 'preview']);
    expect(missingDimension.get('inputs_ok'), 'inputs_ok: missing dimension').toBe(0);
    expect(missingDimension.get('repair_allowed'), 'repair_allowed: missing dimension').toBe(0);
    let txMetrics = await runSections(conn, sections, ['transaction']);
    expect(txMetrics.get('rows_updated'), 'rows_updated: missing dimension').toBe(0);
    await conn.query('ROLLBACK');
    await runSections(conn, sections, ['cleanup']);

    // 6b: a listed census belongs to a different plot.
    const wrongPlotCensusIds = `'${LISTED_CENSUS_ID_1},${LISTED_CENSUS_ID_2},${OTHER_PLOT_CENSUS_ID}'`;
    const wrongPlotCensus = await runInputsAndSections(conn, sections, buildInputsSql({ censusIds: wrongPlotCensusIds }), ['setup', 'preview']);
    expect(wrongPlotCensus.get('censuses_outside_target_plot'), 'censuses_outside_target_plot').toBe(1);
    expect(wrongPlotCensus.get('inputs_ok'), 'inputs_ok: wrong-plot census').toBe(0);
    txMetrics = await runSections(conn, sections, ['transaction']);
    expect(txMetrics.get('rows_updated'), 'rows_updated: wrong-plot census').toBe(0);
    await conn.query('ROLLBACK');
    await runSections(conn, sections, ['cleanup']);

    // 6c: an unknown census id.
    const unknownCensusIds = `'${LISTED_CENSUS_ID_1},${LISTED_CENSUS_ID_2},${UNKNOWN_CENSUS_ID}'`;
    const unknownCensus = await runInputsAndSections(conn, sections, buildInputsSql({ censusIds: unknownCensusIds }), ['setup', 'preview']);
    expect(unknownCensus.get('census_ids_listed'), 'census_ids_listed: unknown census').toBe(3);
    expect(unknownCensus.get('census_ids_found')!, 'census_ids_found: unknown census').toBeLessThan(unknownCensus.get('census_ids_listed')!);
    expect(unknownCensus.get('inputs_ok'), 'inputs_ok: unknown census').toBe(0);
    txMetrics = await runSections(conn, sections, ['transaction']);
    expect(txMetrics.get('rows_updated'), 'rows_updated: unknown census').toBe(0);
    await conn.query('ROLLBACK');
    await runSections(conn, sections, ['cleanup']);

    // 6d: empty @census_ids. Without an explicit emptiness check,
    // census_ids_listed and census_ids_found both compute to 0 and their
    // equality check passes vacuously — this sub-case guards that
    // regression directly.
    const emptyCensus = await runInputsAndSections(conn, sections, buildInputsSql({ censusIds: "''" }), ['setup', 'preview']);
    expect(emptyCensus.get('census_ids_listed'), 'census_ids_listed: empty census_ids').toBe(0);
    expect(emptyCensus.get('census_ids_found'), 'census_ids_found: empty census_ids').toBe(0);
    expect(emptyCensus.get('inputs_ok'), 'inputs_ok: empty census_ids').toBe(0);
    expect(emptyCensus.get('repair_allowed'), 'repair_allowed: empty census_ids').toBe(0);
    txMetrics = await runSections(conn, sections, ['transaction']);
    expect(txMetrics.get('rows_updated'), 'rows_updated: empty census_ids').toBe(0);
    await conn.query('ROLLBACK');
  });

  // -------------------------------------------------------------------------
  // Test 7 — an existing backup name refuses the run
  // -------------------------------------------------------------------------

  it('refuses a second backup when stem_px_backup_20260909 already exists', async () => {
    await loadSeed(conn);
    await runInputsAndSections(conn, sections, buildInputsSql(), ['setup']);

    await executeSection(conn, sections.get('backup')!);

    await expect(executeSection(conn, sections.get('backup')!)).rejects.toMatchObject({ code: 'ER_TABLE_EXISTS_ERROR' });
  });

  // -------------------------------------------------------------------------
  // Test 8 — post-commit rollback with one intervening edit
  // -------------------------------------------------------------------------

  it('post-commit rollback restores every repaired axis except ones edited since — fully for one stem, partially for another', async () => {
    await loadSeed(conn);
    await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    await runSections(conn, sections, ['backup', 'transaction', 'verification']);
    await conn.query('COMMIT');

    // STEM_PX_NULL_ONLY_ID has RepairPY = 0 (its PY was already populated),
    // so editing its repaired PX excludes the row from the rollback UPDATE's
    // WHERE clause entirely — it is reported as diverged but not restored.
    await conn.query('UPDATE Stem SET PX = ? WHERE StemID = ?', [INTERVENING_EDIT_PX_VALUE, STEM_PX_NULL_ONLY_ID]);

    // STEM_BOTH_NULL_ID has RepairPX = 1 AND RepairPY = 1. Editing only its
    // PX diverges that one axis, but its PY clause still matches its
    // replacement, so the row is restored — partially: PY goes back to NULL,
    // the edited PX survives.
    await conn.query('UPDATE Stem SET PX = ? WHERE StemID = ?', [PARTIAL_DIVERGENCE_EDIT_PX_VALUE, STEM_BOTH_NULL_ID]);

    // The script's own rollback sample uses this exact WHERE clause (see
    // "-- SECTION: rollback" in the ops script). executeSection only
    // collects metric/n rows, so the sample itself is recomputed directly
    // here — BEFORE running `rollback`, since that section's own UPDATE
    // would otherwise restore these rows and make everything look diverged
    // from the (now-reverted) replacement values.
    const [divergedRowsBeforeRollback] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT b.StemID FROM stem_px_backup_20260909 b JOIN Stem s ON s.StemID = b.StemID
       WHERE (b.RepairPX = 1 AND NOT (s.PX <=> b.ReplacementPX))
          OR (b.RepairPY = 1 AND NOT (s.PY <=> b.ReplacementPY))
       ORDER BY b.StemID`
    );
    expect(
      (divergedRowsBeforeRollback as any[]).map(r => r.StemID),
      'diverged StemIDs'
    ).toEqual([STEM_BOTH_NULL_ID, STEM_PX_NULL_ONLY_ID].sort((a, b) => a - b));

    const rollbackMetrics = await runSections(conn, sections, ['rollback']);
    expect(rollbackMetrics.get('rollback_axes_diverged'), 'rollback_axes_diverged').toBe(EXPECTED_ROLLBACK_AXES_DIVERGED);
    expect(rollbackMetrics.get('rollback_rows_restored'), 'rollback_rows_restored').toBe(EXPECTED_ROLLBACK_ROWS_RESTORED);

    const after = await snapshotStems(conn);
    // Both edited stems keep their intervening PX edit — untouched by rollback.
    expect(after.get(STEM_PX_NULL_ONLY_ID)!.PX, 'entirely-excluded stem PX preserved').toBe(INTERVENING_EDIT_PX_VALUE);
    expect(after.get(STEM_BOTH_NULL_ID)!.PX, 'partially-diverged stem PX preserved').toBe(PARTIAL_DIVERGENCE_EDIT_PX_VALUE);
    // But STEM_BOTH_NULL_ID's PY — the axis that did NOT diverge — IS restored.
    expect(after.get(STEM_BOTH_NULL_ID)!.PY, 'partially-diverged stem PY restored to NULL').toBeNull();

    // Every other repaired axis (excluding the two edited stems above) is
    // back to NULL.
    for (const [stemId, repair] of Object.entries(EXPECTED_REPAIRS)) {
      const id = Number(stemId);
      if (id === STEM_PX_NULL_ONLY_ID || id === STEM_BOTH_NULL_ID) continue;
      if (repair.px) expect(after.get(id)!.PX, `Stem ${id} PX restored to NULL`).toBeNull();
      if (repair.py) expect(after.get(id)!.PY, `Stem ${id} PY restored to NULL`).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Test 9 — stems_repaired_not_in_backup fires for a post-backup arrival
  // -------------------------------------------------------------------------

  it('stems_repaired_not_in_backup fires when a stem is repaired that the backup snapshot never saw', async () => {
    await loadSeed(conn);
    await runInputsAndSections(conn, sections, buildInputsSql(), ['setup', 'preview']);
    await executeSection(conn, sections.get('backup')!);

    // Simulate a concurrent publish landing AFTER the backup snapshot: insert
    // one more repairable stem directly, reusing the same scenario-row
    // builder helpers the seed itself uses. `backup` is never re-run.
    await conn.query(`INSERT INTO Tree (TreeID, SpeciesID, Tag) VALUES ${buildTreeRowSql(CONCURRENT_PUBLISH_STEM)}`);
    await conn.query(`INSERT INTO Stem (StemID, TreeID, QuadratID, StemNumber, PX, PY, QX, QY) VALUES ${buildStemRowSql(CONCURRENT_PUBLISH_STEM)}`);
    await conn.query(`INSERT INTO DBH (MeasureID, CensusID, StemID, DBH) VALUES ${buildDbhRowsSql([CONCURRENT_PUBLISH_STEM])[0]}`);

    // `transaction` rebuilds candidates from live data, so it DOES see and
    // repair the concurrently-published stem.
    const transactionMetrics = await executeSection(conn, sections.get('transaction')!);
    expect(transactionMetrics.get('stems_needing_repair'), 'stems_needing_repair includes the concurrently-published stem').toBe(
      EXPECTED_STEMS_NEEDING_REPAIR_WITH_CONCURRENT
    );

    // `verification` is what actually flags the gap: this stem was repaired
    // but has no row in stem_px_backup_20260909, so it cannot be rolled back.
    const verificationMetrics = await executeSection(conn, sections.get('verification')!);
    expect(verificationMetrics.get('stems_repaired_not_in_backup'), 'stems_repaired_not_in_backup').toBe(1);

    // Confirm the metric is measuring a REAL gap, not a phantom: the stem
    // really was repaired, and it really is absent from the backup table.
    const [stemRows] = await conn.query<mysql.RowDataPacket[]>('SELECT PX, PY FROM Stem WHERE StemID = ?', [STEM_CONCURRENT_PUBLISH_ID]);
    expect((stemRows as any[])[0].PX, 'concurrently-published stem PX repaired').not.toBeNull();
    expect((stemRows as any[])[0].PY, 'concurrently-published stem PY repaired').not.toBeNull();
    const [backupRows] = await conn.query<mysql.RowDataPacket[]>('SELECT StemID FROM stem_px_backup_20260909 WHERE StemID = ?', [STEM_CONCURRENT_PUBLISH_ID]);
    expect(backupRows, 'concurrently-published stem absent from backup').toHaveLength(0);

    // Minimal cleanup: ROLLBACK rather than COMMIT + run `rollback` — this
    // test only needs to prove the detection metric fires; the runbook
    // already documents that a stem missing from backup cannot be undone.
    await conn.query('ROLLBACK');
  });
});
