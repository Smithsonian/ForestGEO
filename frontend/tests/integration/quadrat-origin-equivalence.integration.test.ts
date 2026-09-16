/**
 * Integration tests for the operator-run quadrat origin-equivalence check
 * (issue #475): db/ops/2026-09-09-check-quadrat-origin-equivalence.sql.
 *
 * The app computes a published stem's plot coordinates from the app schema's
 * quadrats.StartX/StartY. The destination-side historical repair
 * (db/ops/2026-09-09-backfill-stem-plot-coordinates.sql) instead derives a
 * quadrat's origin as MIN(Coordinates.PX)/MIN(Coordinates.PY) on the
 * Smithsonian server. These two servers cannot be JOINed, so this script's
 * input is a VALUES list an operator exports from the app schema by hand —
 * these tests build that list themselves and paste it into the `inputs`
 * section exactly as an operator would.
 *
 * These tests execute the REAL TEXT of the script's marked sections (via
 * readOpsScriptSections/executeSection, see ./helpers/ops-script-sections)
 * against a fresh destination database built from the canonical CTFS DDL —
 * never a test-owned copy of the SQL.
 *
 * Prerequisites: docker compose up -d mysql
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { loadCanonicalDestinationDdl } from './helpers/ctfs-destination-ddl';
import { readOpsScriptSections, executeSection, executeSectionStatements, collectMetrics } from './helpers/ops-script-sections';
import { testDbServerOptions } from '../setup/test-db-connection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPS_SCRIPT_PATH = path.resolve(__dirname, '../../db/ops/2026-09-09-check-quadrat-origin-equivalence.sql');

const SECTION_NAMES = ['inputs', 'setup', 'report', 'cleanup'] as const;

// The ops script file is static for the whole test run — read and split it
// once at module scope rather than re-parsing it in every test's beforeEach.
const { preamble, sections } = readOpsScriptSections(OPS_SCRIPT_PATH);

// `report`'s statement order — one metrics statement, then four sample-row
// diagnostics. executeSectionStatements returns raw result sets in exactly
// this order; see db/ops/2026-09-09-check-quadrat-origin-equivalence.sql's
// `report` section for the statements themselves.
const REPORT_STATEMENT_APP_ONLY_SAMPLE = 1;
const REPORT_STATEMENT_DESTINATION_ONLY_SAMPLE = 2;
const REPORT_STATEMENT_AMBIGUOUS_SAMPLE = 3;
const REPORT_STATEMENT_MISMATCH_SAMPLE = 4;

// ---------------------------------------------------------------------------
// Seed constants — every quadrat and coordinate the tests reason about, plus
// the app-side origin lists pasted into `@app_quadrat_origins`. All metric
// expectations are derived from these, never hardcoded, so a seed change and
// its assertions can never silently drift apart.
// ---------------------------------------------------------------------------

const PLOT_ID = 1;
const OTHER_PLOT_ID = 2; // must be entirely ignored by every metric below

const DEFAULT_ORIGIN_TOLERANCE = 0.00001; // matches the script's own default; decimal(16,5) storage precision

// Destination-side quadrats (plot 1) for the "dirty" seed (test 1).
const QUADRAT_EQUAL_ID = 1; // origin agrees exactly with the app list
const QUADRAT_MISMATCH_ID = 2; // origin disagrees with the app list beyond tolerance
const QUADRAT_DEST_ONLY_ID = 3; // no app-side entry at all
const QUADRAT_NULL_AXIS_ID = 4; // every Coordinates row has PX NULL
const QUADRAT_AMBIGUOUS_ID_A = 5; // shares QUADRAT_AMBIGUOUS_NAME with ID_B
const QUADRAT_AMBIGUOUS_ID_B = 6;
const QUADRAT_APP_NULL_AXIS_ID = 7; // destination origin fully known; app-side StartX is NULL
const QUADRAT_DUP_NAME_ID = 8; // destination unambiguous; app-side name is duplicated
const QUADRAT_OTHER_PLOT_ID = 9; // plot 2 — must never appear in any plot-1 metric

const QUADRAT_EQUAL_NAME = 'QEQUAL';
const QUADRAT_MISMATCH_NAME = 'QMISMTCH';
const QUADRAT_DEST_ONLY_NAME = 'QDESTONL';
const QUADRAT_NULL_AXIS_NAME = 'QNULLAX';
const QUADRAT_AMBIGUOUS_NAME = 'QAMBIG';
const QUADRAT_APP_NULL_AXIS_NAME = 'QAPPNUL';
const QUADRAT_DUP_NAME_NAME = 'QDUPNAME';
const QUADRAT_OTHER_PLOT_NAME = 'QOTHER';
const APP_ONLY_QUADRAT_NAME = 'APPONLY'; // app-side only, no destination row at all

const EQUAL_ORIGIN_X = 40;
const EQUAL_ORIGIN_Y = 60;
const MISMATCH_DEST_X = 40;
const MISMATCH_DEST_Y = 60;
const MISMATCH_APP_X = 41; // diff 1, far beyond tolerance
const MISMATCH_APP_Y = 60;
const DEST_ONLY_X = 70;
const DEST_ONLY_Y = 80;
const NULL_AXIS_PY_ROW_1 = 90; // MIN(PY) across two corner rows -> 90
const NULL_AXIS_PY_ROW_2 = 95;
const NULL_AXIS_APP_X = 5; // arbitrary — origin_missing_destination fires regardless
const NULL_AXIS_APP_Y = 90; // matches destination PY so no accidental Y mismatch
const AMBIGUOUS_APP_X = 1;
const AMBIGUOUS_APP_Y = 1;
const APP_NULL_AXIS_DEST_X = 10;
const APP_NULL_AXIS_DEST_Y = 20;
const APP_NULL_AXIS_APP_Y = 20; // matches destination Y so only X (NULL) is missing
const DUP_NAME_DEST_X = 50;
const DUP_NAME_DEST_Y = 50;
const DUP_NAME_APP_1_X = 2;
const DUP_NAME_APP_1_Y = 2;
const DUP_NAME_APP_2_Y = 3; // this row's StartX is NULL — the seed's "one NULL StartX"
const APP_ONLY_X = 99;
const APP_ONLY_Y = 99;
const OTHER_PLOT_ORIGIN_X = 5;
const OTHER_PLOT_ORIGIN_Y = 5;

// Every metric the "dirty" seed is designed to exercise with a distinct,
// separable nonzero example (see the report SQL for the exact definitions).
const EXPECTED_DESTINATION_QUADRATS = 8; // 6 unambiguous rows + 2 QAMBIG rows
const EXPECTED_APP_QUADRATS = 8; // 6 unambiguous rows + 2 QDUPNAME rows
const EXPECTED_APP_ONLY = 1; // APP_ONLY_QUADRAT_NAME
const EXPECTED_DESTINATION_ONLY = 1; // QUADRAT_DEST_ONLY_NAME
const EXPECTED_AMBIGUOUS_DESTINATION_NAMES = 1; // QUADRAT_AMBIGUOUS_NAME
const EXPECTED_AMBIGUOUS_APP_NAMES = 1; // QUADRAT_DUP_NAME_NAME
const EXPECTED_MATCHED = 4; // QEQUAL, QMISMTCH, QNULLAX, QAPPNUL
const EXPECTED_ORIGIN_MISSING_DESTINATION = 1; // QUADRAT_NULL_AXIS_NAME
const EXPECTED_ORIGIN_MISSING_APP = 1; // QUADRAT_APP_NULL_AXIS_NAME
const EXPECTED_ORIGIN_MISMATCH = 1; // QUADRAT_MISMATCH_NAME
const EXPECTED_ORIGIN_EQUAL = 1; // QUADRAT_EQUAL_NAME

function dirtySeedSql(): string {
  return `
INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize)
VALUES
  (${PLOT_ID}, 'TARGET', 'Target plot', 1, 'rectangle', 'Origin-equivalence test target plot', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y'),
  (${OTHER_PLOT_ID}, 'OTHER', 'Other plot', 1, 'rectangle', 'Origin-equivalence test other plot', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y');

INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${QUADRAT_EQUAL_ID}, ${PLOT_ID}, '${QUADRAT_EQUAL_NAME}', 'Y'),
  (${QUADRAT_MISMATCH_ID}, ${PLOT_ID}, '${QUADRAT_MISMATCH_NAME}', 'Y'),
  (${QUADRAT_DEST_ONLY_ID}, ${PLOT_ID}, '${QUADRAT_DEST_ONLY_NAME}', 'Y'),
  (${QUADRAT_NULL_AXIS_ID}, ${PLOT_ID}, '${QUADRAT_NULL_AXIS_NAME}', 'Y'),
  (${QUADRAT_AMBIGUOUS_ID_A}, ${PLOT_ID}, '${QUADRAT_AMBIGUOUS_NAME}', 'Y'),
  (${QUADRAT_AMBIGUOUS_ID_B}, ${PLOT_ID}, '${QUADRAT_AMBIGUOUS_NAME}', 'Y'),
  (${QUADRAT_APP_NULL_AXIS_ID}, ${PLOT_ID}, '${QUADRAT_APP_NULL_AXIS_NAME}', 'Y'),
  (${QUADRAT_DUP_NAME_ID}, ${PLOT_ID}, '${QUADRAT_DUP_NAME_NAME}', 'Y'),
  (${QUADRAT_OTHER_PLOT_ID}, ${OTHER_PLOT_ID}, '${QUADRAT_OTHER_PLOT_NAME}', 'Y');

-- QEQUAL origin (40,60): four corner rows, MIN reduces to the origin.
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_EQUAL_ID}, ${EQUAL_ORIGIN_X}, ${EQUAL_ORIGIN_Y}),
  (${PLOT_ID}, ${QUADRAT_EQUAL_ID}, ${EQUAL_ORIGIN_X + 20}, ${EQUAL_ORIGIN_Y}),
  (${PLOT_ID}, ${QUADRAT_EQUAL_ID}, ${EQUAL_ORIGIN_X}, ${EQUAL_ORIGIN_Y + 20}),
  (${PLOT_ID}, ${QUADRAT_EQUAL_ID}, ${EQUAL_ORIGIN_X + 20}, ${EQUAL_ORIGIN_Y + 20});

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_MISMATCH_ID}, ${MISMATCH_DEST_X}, ${MISMATCH_DEST_Y});

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_DEST_ONLY_ID}, ${DEST_ONLY_X}, ${DEST_ONLY_Y});

-- QNULLAX: every Coordinates row has PX NULL — destination origin PX is
-- unrecoverable, PY is not (MIN across two rows).
INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_NULL_AXIS_ID}, NULL, ${NULL_AXIS_PY_ROW_1}),
  (${PLOT_ID}, ${QUADRAT_NULL_AXIS_ID}, NULL, ${NULL_AXIS_PY_ROW_2});

-- QAMBIG: no Coordinates needed — ambiguous by name alone, excluded from
-- matched regardless of origin.

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_APP_NULL_AXIS_ID}, ${APP_NULL_AXIS_DEST_X}, ${APP_NULL_AXIS_DEST_Y});

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${QUADRAT_DUP_NAME_ID}, ${DUP_NAME_DEST_X}, ${DUP_NAME_DEST_Y});

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${OTHER_PLOT_ID}, ${QUADRAT_OTHER_PLOT_ID}, ${OTHER_PLOT_ORIGIN_X}, ${OTHER_PLOT_ORIGIN_Y});
`;
}

// The app-side export pasted into @app_quadrat_origins for the dirty seed:
// real (unescaped) single quotes — sqlStringLiteral() below doubles them
// when building the SET statement, exactly as an operator's paste would
// need to for MySQL string-literal syntax.
const DIRTY_APP_QUADRAT_ORIGINS =
  `('${QUADRAT_EQUAL_NAME}', ${EQUAL_ORIGIN_X}, ${EQUAL_ORIGIN_Y}),` +
  `('${QUADRAT_MISMATCH_NAME}', ${MISMATCH_APP_X}, ${MISMATCH_APP_Y}),` +
  `('${QUADRAT_NULL_AXIS_NAME}', ${NULL_AXIS_APP_X}, ${NULL_AXIS_APP_Y}),` +
  `('${QUADRAT_AMBIGUOUS_NAME}', ${AMBIGUOUS_APP_X}, ${AMBIGUOUS_APP_Y}),` +
  `('${QUADRAT_APP_NULL_AXIS_NAME}', NULL, ${APP_NULL_AXIS_APP_Y}),` +
  `('${QUADRAT_DUP_NAME_NAME}', ${DUP_NAME_APP_1_X}, ${DUP_NAME_APP_1_Y}),` +
  `('${QUADRAT_DUP_NAME_NAME}', NULL, ${DUP_NAME_APP_2_Y}),` +
  `('${APP_ONLY_QUADRAT_NAME}', ${APP_ONLY_X}, ${APP_ONLY_Y})`;

// ---------------------------------------------------------------------------
// "Clean" seed (test 2 + reused as the base for tests 4 and 5): app list
// equals destination exactly, no ambiguity, no extras.
// ---------------------------------------------------------------------------

const CLEAN_QUADRAT_1_ID = 101;
const CLEAN_QUADRAT_2_ID = 102;
const CLEAN_QUADRAT_1_NAME = 'CQONE';
const CLEAN_QUADRAT_2_NAME = 'CQTWO';
const CLEAN_ORIGIN_1_X = 10;
const CLEAN_ORIGIN_1_Y = 10;
const CLEAN_ORIGIN_2_X = 20;
const CLEAN_ORIGIN_2_Y = 20;

function cleanSeedSql(): string {
  return `
INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize)
VALUES (${PLOT_ID}, 'TARGET', 'Target plot', 1, 'rectangle', 'Origin-equivalence clean-plot test', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y');

INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${CLEAN_QUADRAT_1_ID}, ${PLOT_ID}, '${CLEAN_QUADRAT_1_NAME}', 'Y'),
  (${CLEAN_QUADRAT_2_ID}, ${PLOT_ID}, '${CLEAN_QUADRAT_2_NAME}', 'Y');

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${CLEAN_QUADRAT_1_ID}, ${CLEAN_ORIGIN_1_X}, ${CLEAN_ORIGIN_1_Y}),
  (${PLOT_ID}, ${CLEAN_QUADRAT_2_ID}, ${CLEAN_ORIGIN_2_X}, ${CLEAN_ORIGIN_2_Y});
`;
}

const CLEAN_APP_QUADRAT_ORIGINS =
  `('${CLEAN_QUADRAT_1_NAME}', ${CLEAN_ORIGIN_1_X}, ${CLEAN_ORIGIN_1_Y}),` + `('${CLEAN_QUADRAT_2_NAME}', ${CLEAN_ORIGIN_2_X}, ${CLEAN_ORIGIN_2_Y})`;

// ---------------------------------------------------------------------------
// Tolerance seed (test 3): a single quadrat whose destination origin is
// exact, so the app-side X value alone controls the diff.
//
// @origin_tolerance's own comment says "decimal(16,5) storage precision" —
// both Coordinates.PX/PY (destination) and the working table's StartX/StartY
// are DECIMAL(16,5), so two distinct stored values can never differ by less
// than 0.00001: that is the smallest representable nonzero difference, and
// it is also the script's default tolerance. This test therefore checks the
// intended boundary behavior (a difference at or below tolerance reads as
// equal; a difference clearly beyond it reads as a mismatch) using
// 0.00001 (the boundary itself — not '>' the tolerance, so still equal) and
// 0.00002 (twice the tolerance) rather than an unrepresentable 0.000005.
// ---------------------------------------------------------------------------

const TOLERANCE_QUADRAT_ID = 201;
const TOLERANCE_QUADRAT_NAME = 'CQTOL';
const TOLERANCE_ORIGIN_X = 40;
const TOLERANCE_ORIGIN_Y = 60;
const TOLERANCE_BOUNDARY_APP_X = 40.00001; // diff == @origin_tolerance, not > it
const TOLERANCE_EXCEEDING_APP_X = 40.00002; // diff == 2x @origin_tolerance

function toleranceSeedSql(): string {
  return `
INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize)
VALUES (${PLOT_ID}, 'TARGET', 'Target plot', 1, 'rectangle', 'Origin-equivalence tolerance test', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y');

INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${TOLERANCE_QUADRAT_ID}, ${PLOT_ID}, '${TOLERANCE_QUADRAT_NAME}', 'Y');

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${TOLERANCE_QUADRAT_ID}, ${TOLERANCE_ORIGIN_X}, ${TOLERANCE_ORIGIN_Y});
`;
}

function toleranceAppQuadratOrigins(appX: number): string {
  return `('${TOLERANCE_QUADRAT_NAME}', ${appX}, ${TOLERANCE_ORIGIN_Y})`;
}

// ---------------------------------------------------------------------------
// Blocker-isolation seeds (tests 6-9 below): each gives exactly ONE of the
// five equivalence_ok-gating metrics (app_only, destination_only,
// ambiguous_destination_names, ambiguous_app_names, origin_mismatch) a
// nonzero value, and every other one 0 — proving equivalence_ok's CASE
// (db/ops/2026-09-09-check-quadrat-origin-equivalence.sql's `blocker_counts`
// CTE) is gated correctly by each condition independently, not just by all
// five at once (as the dirty seed above exercises). origin_mismatch is
// covered the same way by the tolerance test's "exceeding" half.
// ---------------------------------------------------------------------------

// app_only: no destination quadrat exists at all — a single app-side row is
// already enough, nothing else needs seeding.
const BLOCKER_APP_ONLY_NAME = 'BLKAPP';
const BLOCKER_APP_ONLY_X = 11;
const BLOCKER_APP_ONLY_Y = 22;

// destination_only: one baseline quadrat matched exactly (so the app list is
// non-empty without itself being app-only) plus one destination quadrat with
// no app-side counterpart.
const BLOCKER_BASE_ID = 601;
const BLOCKER_BASE_NAME = 'BLKBASE';
const BLOCKER_BASE_X = 1;
const BLOCKER_BASE_Y = 1;
const BLOCKER_DEST_ONLY_ID = 602;
const BLOCKER_DEST_ONLY_NAME = 'BLKDEST';
const BLOCKER_DEST_ONLY_X = 2;
const BLOCKER_DEST_ONLY_Y = 2;

// ambiguous_destination_names: two destination Quadrat rows share a name
// that also has exactly one (matching-by-name) app-side row, so the name
// exists on both sides — isolating ambiguity from destination_only/app_only.
const BLOCKER_DUP_DEST_ID_A = 603;
const BLOCKER_DUP_DEST_ID_B = 604;
const BLOCKER_DUP_DEST_NAME = 'BLKDDST';
const BLOCKER_DUP_DEST_APP_X = 3;
const BLOCKER_DUP_DEST_APP_Y = 3;

// ambiguous_app_names: one destination Quadrat row whose name has two
// app-side rows.
const BLOCKER_DUP_APP_ID = 605;
const BLOCKER_DUP_APP_NAME = 'BLKDAPP';
const BLOCKER_DUP_APP_X_1 = 4;
const BLOCKER_DUP_APP_Y_1 = 4;
const BLOCKER_DUP_APP_X_2 = 5;
const BLOCKER_DUP_APP_Y_2 = 5;

// Apostrophe-name regression pin (see the last test below): the export
// query's REPLACE chain must double an embedded apostrophe TWICE — once so
// the name round-trips through the generated INSERT statement's own string
// literal, once more so that whole result round-trips through the outer
// @app_quadrat_origins literal it gets pasted into. QUOTE() (the function
// this script used to use) backslash-escapes an embedded apostrophe
// instead, and that stray backslash corrupts the outer literal. 7 chars —
// well within destination Quadrat.QuadratName's CHAR(8).
const APOSTROPHE_QUADRAT_ID = 701;
const APOSTROPHE_QUADRAT_NAME = "O'BRIEN";
const APOSTROPHE_ORIGIN_X = 40;
const APOSTROPHE_ORIGIN_Y = 60;

function siteSeedSql(): string {
  return `
INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize)
VALUES (${PLOT_ID}, 'TARGET', 'Target plot', 1, 'rectangle', 'Origin-equivalence blocker-isolation test', 1.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y');
`;
}

function blockerDestinationOnlySeedSql(): string {
  return `
${siteSeedSql()}
INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${BLOCKER_BASE_ID}, ${PLOT_ID}, '${BLOCKER_BASE_NAME}', 'Y'),
  (${BLOCKER_DEST_ONLY_ID}, ${PLOT_ID}, '${BLOCKER_DEST_ONLY_NAME}', 'Y');

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${BLOCKER_BASE_ID}, ${BLOCKER_BASE_X}, ${BLOCKER_BASE_Y}),
  (${PLOT_ID}, ${BLOCKER_DEST_ONLY_ID}, ${BLOCKER_DEST_ONLY_X}, ${BLOCKER_DEST_ONLY_Y});
`;
}

function blockerAmbiguousDestinationSeedSql(): string {
  return `
${siteSeedSql()}
INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${BLOCKER_DUP_DEST_ID_A}, ${PLOT_ID}, '${BLOCKER_DUP_DEST_NAME}', 'Y'),
  (${BLOCKER_DUP_DEST_ID_B}, ${PLOT_ID}, '${BLOCKER_DUP_DEST_NAME}', 'Y');
`;
}

function blockerAmbiguousAppSeedSql(): string {
  return `
${siteSeedSql()}
INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${BLOCKER_DUP_APP_ID}, ${PLOT_ID}, '${BLOCKER_DUP_APP_NAME}', 'Y');
`;
}

function apostropheSeedSql(): string {
  return `
${siteSeedSql()}
INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, IsStandardShape) VALUES
  (${APOSTROPHE_QUADRAT_ID}, ${PLOT_ID}, '${escapeQuotesOnce(APOSTROPHE_QUADRAT_NAME)}', 'Y');

INSERT INTO Coordinates (PlotID, QuadratID, PX, PY) VALUES
  (${PLOT_ID}, ${APOSTROPHE_QUADRAT_ID}, ${APOSTROPHE_ORIGIN_X}, ${APOSTROPHE_ORIGIN_Y});
`;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

/** Standard one-level SQL string-literal escape: doubles embedded quotes. */
function escapeQuotesOnce(raw: string): string {
  return raw.replace(/'/g, "''");
}

function sqlStringLiteral(raw: string): string {
  return `'${escapeQuotesOnce(raw)}'`;
}

interface InputsOverride {
  plotId?: number | null;
  originTolerance?: number | null;
  appQuadratOrigins?: string | null; // raw VALUES-tuples text (real quotes), '', or null
}

function buildInputsSql(overrides: InputsOverride = {}): string {
  const plotId = overrides.plotId === undefined ? PLOT_ID : overrides.plotId;
  const originTolerance = overrides.originTolerance === undefined ? DEFAULT_ORIGIN_TOLERANCE : overrides.originTolerance;
  const appQuadratOrigins = overrides.appQuadratOrigins === undefined ? DIRTY_APP_QUADRAT_ORIGINS : overrides.appQuadratOrigins;
  return `
SET @plot_id := ${plotId === null ? 'NULL' : plotId};
SET @origin_tolerance := ${originTolerance === null ? 'NULL' : originTolerance};
SET @app_quadrat_origins := ${appQuadratOrigins === null ? 'NULL' : sqlStringLiteral(appQuadratOrigins)};
`;
}

async function runReport(conn: mysql.Connection): Promise<(Record<string, unknown>[] | null)[]> {
  return executeSectionStatements(conn, sections.get('report')!);
}

/** Extracts the text between each `startMarker`/`endMarker` pair, in file order. */
function extractMarkedBlocks(sql: string, startMarker: string, endMarker: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = sql.indexOf(startMarker, searchFrom);
    if (start === -1) break;
    const end = sql.indexOf(endMarker, start);
    if (end === -1) throw new Error(`${startMarker} at offset ${start} has no matching ${endMarker}`);
    blocks.push(sql.slice(start + startMarker.length, end));
    searchFrom = end + endMarker.length;
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Static checks — no database needed.
// ---------------------------------------------------------------------------

describe('quadrat-origin-equivalence ops script: static checks (no DB)', () => {
  it('has every section in the documented order, and nothing executable before the first marker', () => {
    expect(Array.from(sections.keys())).toEqual(SECTION_NAMES);
    for (const line of preamble.split('\n')) {
      const trimmed = line.trim();
      expect(trimmed === '' || trimmed.startsWith('--'), `Non-comment line before first SECTION marker: "${line}"`).toBe(true);
    }
  });

  it('has exactly five byte-identical ORIGIN CTES blocks in `report`', () => {
    const blocks = extractMarkedBlocks(sections.get('report')!, '-- ORIGIN CTES START', '-- ORIGIN CTES END');
    expect(blocks.length, 'ORIGIN CTES block count (1 metrics statement + 4 sample listings)').toBe(5);
    expect(new Set(blocks).size, 'all five ORIGIN CTES blocks must be byte-identical').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Database lifecycle — one isolated destination database per test.
// ---------------------------------------------------------------------------

const createdDatabases: string[] = [];

afterAll(async () => {
  if (createdDatabases.length === 0) return;
  const conn = await mysql.createConnection({
    ...testDbServerOptions()
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)', [createdDatabases]);
    const leaked = rows.map(r => r.SCHEMA_NAME as string);
    expect(leaked, `Databases leaked by this file (teardown failed to drop them): ${leaked.join(', ')}`).toEqual([]);
  } finally {
    await conn.end();
  }
});

describe('quadrat-origin-equivalence ops script: section-by-section execution', () => {
  let conn: mysql.Connection;
  let dbName: string;

  beforeEach(async () => {
    const stamp = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    dbName = `forestgeo_qoe_${stamp}`;
    createdDatabases.push(dbName);

    conn = await createTestDatabase({ ...DEFAULT_TEST_CONFIG, database: dbName });
    await loadCanonicalDestinationDdl(conn);
  });

  afterEach(async () => {
    if (conn) {
      try {
        await teardownTestDatabase(conn, { database: dbName });
      } catch {
        // best-effort cleanup — the file-level afterAll tripwire catches leaks
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 0 — the shipped placeholder example rows parse, and only @plot_id
  // is missing from them.
  // -------------------------------------------------------------------------

  it('the shipped inputs section, run verbatim, loads its own placeholder example rows once @plot_id is supplied', async () => {
    // No override — this is the script's own `inputs` section text exactly
    // as shipped: @origin_tolerance := 0.00001 and the Cocoli placeholder
    // 'A1'/'A2' example VALUES-tuples for @app_quadrat_origins. Only
    // @plot_id ships as NULL, so supplying it is the only thing needed to
    // make inputs_ok = 1 — proving the placeholder example text itself is
    // valid, parseable SQL through the PREPARE/EXECUTE dance.
    await executeSection(conn, sections.get('inputs')!);
    await conn.query(`SET @plot_id := ${PLOT_ID};`);

    const setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok with only @plot_id supplied').toBe(1);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded: shipped A1/A2 placeholder rows').toBe(2);

    await executeSection(conn, sections.get('cleanup')!);
  });

  // -------------------------------------------------------------------------
  // Test 1 — every metric against a seed designed to give each one a
  // distinct, separable nonzero example.
  // -------------------------------------------------------------------------

  it('reports every metric against the dirty seed’s known name/origin set, and equivalence_ok is 0', async () => {
    await executeSectionStatements(conn, dirtySeedSql());
    await executeSection(conn, buildInputsSql());

    const setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok').toBe(1);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded').toBe(EXPECTED_APP_QUADRATS);

    const reportResultSets = await runReport(conn);
    const metrics = collectMetrics(reportResultSets);

    expect(metrics.get('destination_quadrats'), 'destination_quadrats').toBe(EXPECTED_DESTINATION_QUADRATS);
    expect(metrics.get('app_quadrats'), 'app_quadrats').toBe(EXPECTED_APP_QUADRATS);
    expect(metrics.get('app_only'), 'app_only').toBe(EXPECTED_APP_ONLY);
    expect(metrics.get('destination_only'), 'destination_only').toBe(EXPECTED_DESTINATION_ONLY);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(EXPECTED_AMBIGUOUS_DESTINATION_NAMES);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(EXPECTED_AMBIGUOUS_APP_NAMES);
    expect(metrics.get('matched'), 'matched').toBe(EXPECTED_MATCHED);
    expect(metrics.get('origin_missing_destination'), 'origin_missing_destination').toBe(EXPECTED_ORIGIN_MISSING_DESTINATION);
    expect(metrics.get('origin_missing_app'), 'origin_missing_app').toBe(EXPECTED_ORIGIN_MISSING_APP);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(EXPECTED_ORIGIN_MISMATCH);
    expect(metrics.get('origin_equal'), 'origin_equal').toBe(EXPECTED_ORIGIN_EQUAL);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(0);

    // Sample rows name the right quadrats.
    const appOnlySample = reportResultSets[REPORT_STATEMENT_APP_ONLY_SAMPLE] ?? [];
    expect(appOnlySample.map(r => r.QuadratName)).toEqual([APP_ONLY_QUADRAT_NAME]);

    const destinationOnlySample = reportResultSets[REPORT_STATEMENT_DESTINATION_ONLY_SAMPLE] ?? [];
    expect(destinationOnlySample.map(r => r.QuadratName)).toEqual([QUADRAT_DEST_ONLY_NAME]);
    expect(Number(destinationOnlySample[0].OriginPX)).toBe(DEST_ONLY_X);
    expect(Number(destinationOnlySample[0].OriginPY)).toBe(DEST_ONLY_Y);

    const ambiguousSample = (reportResultSets[REPORT_STATEMENT_AMBIGUOUS_SAMPLE] ?? [])
      .map(r => ({ name: r.QuadratName, side: r.ambiguous_side }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(ambiguousSample).toEqual(
      [
        { name: QUADRAT_AMBIGUOUS_NAME, side: 'destination' },
        { name: QUADRAT_DUP_NAME_NAME, side: 'app' }
      ].sort((a, b) => a.name.localeCompare(b.name))
    );

    const mismatchSample = reportResultSets[REPORT_STATEMENT_MISMATCH_SAMPLE] ?? [];
    expect(mismatchSample.map(r => r.QuadratName)).toEqual([QUADRAT_MISMATCH_NAME]);
    expect(Number(mismatchSample[0].StartX)).toBe(MISMATCH_APP_X);
    expect(Number(mismatchSample[0].OriginPX)).toBe(MISMATCH_DEST_X);
    expect(Number(mismatchSample[0].DiffX)).toBe(MISMATCH_APP_X - MISMATCH_DEST_X);
    expect(Number(mismatchSample[0].DiffY)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2 — a clean plot: everything matches, everything else is 0.
  // -------------------------------------------------------------------------

  it('a clean plot (app list equals destination exactly): origin_equal = matched, everything else 0, equivalence_ok 1', async () => {
    await executeSectionStatements(conn, cleanSeedSql());
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: CLEAN_APP_QUADRAT_ORIGINS }));
    await executeSection(conn, sections.get('setup')!);

    const metrics = collectMetrics(await runReport(conn));

    const EXPECTED_CLEAN_QUADRATS = 2;
    expect(metrics.get('destination_quadrats'), 'destination_quadrats').toBe(EXPECTED_CLEAN_QUADRATS);
    expect(metrics.get('app_quadrats'), 'app_quadrats').toBe(EXPECTED_CLEAN_QUADRATS);
    expect(metrics.get('app_only'), 'app_only').toBe(0);
    expect(metrics.get('destination_only'), 'destination_only').toBe(0);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(0);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(0);
    expect(metrics.get('matched'), 'matched').toBe(EXPECTED_CLEAN_QUADRATS);
    expect(metrics.get('origin_missing_destination'), 'origin_missing_destination').toBe(0);
    expect(metrics.get('origin_missing_app'), 'origin_missing_app').toBe(0);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(0);
    expect(metrics.get('origin_equal'), 'origin_equal').toBe(EXPECTED_CLEAN_QUADRATS);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 3 — tolerance boundary, and equivalence_ok tracking it.
  // -------------------------------------------------------------------------

  it('tolerance: a diff at the boundary counts as equal (equivalence_ok 1); twice the tolerance counts as a mismatch (equivalence_ok 0)', async () => {
    await executeSectionStatements(conn, toleranceSeedSql());

    await executeSection(conn, buildInputsSql({ appQuadratOrigins: toleranceAppQuadratOrigins(TOLERANCE_BOUNDARY_APP_X) }));
    await executeSection(conn, sections.get('setup')!);
    let metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('origin_equal'), 'boundary diff: origin_equal').toBe(1);
    expect(metrics.get('origin_mismatch'), 'boundary diff: origin_mismatch').toBe(0);
    expect(metrics.get('equivalence_ok'), 'boundary diff: equivalence_ok').toBe(1);

    await executeSection(conn, sections.get('cleanup')!);

    await executeSection(conn, buildInputsSql({ appQuadratOrigins: toleranceAppQuadratOrigins(TOLERANCE_EXCEEDING_APP_X) }));
    await executeSection(conn, sections.get('setup')!);
    metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('origin_equal'), 'exceeding diff: origin_equal').toBe(0);
    expect(metrics.get('origin_mismatch'), 'exceeding diff: origin_mismatch').toBe(1);
    expect(metrics.get('equivalence_ok'), 'exceeding diff: equivalence_ok — origin_mismatch is the ONLY nonzero blocker here').toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 4 — refused inputs.
  // -------------------------------------------------------------------------

  it('refuses to claim equivalence when inputs are missing, in each documented way', async () => {
    await executeSectionStatements(conn, cleanSeedSql());

    // 4a: missing plot id.
    await executeSection(conn, buildInputsSql({ plotId: null, appQuadratOrigins: CLEAN_APP_QUADRAT_ORIGINS }));
    let setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok: missing plot id').toBe(0);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded: missing plot id').toBe(0);
    let metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('equivalence_ok'), 'equivalence_ok: missing plot id').toBe(0);
    await executeSection(conn, sections.get('cleanup')!);

    // 4b: empty (but non-NULL) app_quadrat_origins.
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: '' }));
    setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok: empty app list').toBe(0);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded: empty app list').toBe(0);
    metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('equivalence_ok'), 'equivalence_ok: empty app list').toBe(0);
    await executeSection(conn, sections.get('cleanup')!);

    // 4c: NULL app_quadrat_origins — distinct from the empty-string case
    // above; both independently fail the `<> ''` / `IS NOT NULL` checks.
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: null }));
    setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok: NULL app list').toBe(0);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded: NULL app list').toBe(0);
    metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('equivalence_ok'), 'equivalence_ok: NULL app list').toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 5 — rerun safety.
  // -------------------------------------------------------------------------

  it('setup refuses a second working table over an existing one; cleanup then setup succeeds', async () => {
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: CLEAN_APP_QUADRAT_ORIGINS }));
    await executeSection(conn, sections.get('setup')!);

    await expect(executeSection(conn, sections.get('setup')!)).rejects.toMatchObject({ code: 'ER_TABLE_EXISTS_ERROR' });

    await executeSection(conn, sections.get('cleanup')!);
    await expect(executeSection(conn, sections.get('setup')!)).resolves.toBeInstanceOf(Map);
  });

  // -------------------------------------------------------------------------
  // Tests 6-9 — each isolates exactly one of equivalence_ok's five gating
  // conditions, proving the `blocker_counts` CASE responds to each
  // independently rather than only ever being exercised all-at-once (test 1)
  // or all-clear (test 2). origin_mismatch alone is covered by test 3's
  // "exceeding" half above.
  // -------------------------------------------------------------------------

  it('blocker isolation: app_only alone makes equivalence_ok 0', async () => {
    // No destination quadrat at all — one app-side row is already app_only.
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: `('${BLOCKER_APP_ONLY_NAME}', ${BLOCKER_APP_ONLY_X}, ${BLOCKER_APP_ONLY_Y})` }));
    await executeSection(conn, sections.get('setup')!);
    const metrics = collectMetrics(await runReport(conn));

    expect(metrics.get('app_only'), 'app_only').toBe(1);
    expect(metrics.get('destination_only'), 'destination_only').toBe(0);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(0);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(0);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(0);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(0);
  });

  it('blocker isolation: destination_only alone makes equivalence_ok 0', async () => {
    await executeSectionStatements(conn, blockerDestinationOnlySeedSql());
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: `('${BLOCKER_BASE_NAME}', ${BLOCKER_BASE_X}, ${BLOCKER_BASE_Y})` }));
    await executeSection(conn, sections.get('setup')!);
    const metrics = collectMetrics(await runReport(conn));

    expect(metrics.get('app_only'), 'app_only').toBe(0);
    expect(metrics.get('destination_only'), 'destination_only').toBe(1);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(0);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(0);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(0);
    expect(metrics.get('matched'), 'matched (the baseline pair, not a blocker)').toBe(1);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(0);
  });

  it('blocker isolation: ambiguous_destination_names alone makes equivalence_ok 0', async () => {
    await executeSectionStatements(conn, blockerAmbiguousDestinationSeedSql());
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: `('${BLOCKER_DUP_DEST_NAME}', ${BLOCKER_DUP_DEST_APP_X}, ${BLOCKER_DUP_DEST_APP_Y})` }));
    await executeSection(conn, sections.get('setup')!);
    const metrics = collectMetrics(await runReport(conn));

    expect(metrics.get('app_only'), 'app_only').toBe(0);
    expect(metrics.get('destination_only'), 'destination_only').toBe(0);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(1);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(0);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(0);
    expect(metrics.get('matched'), 'matched (excluded — the destination name is ambiguous)').toBe(0);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(0);
  });

  it('blocker isolation: ambiguous_app_names alone makes equivalence_ok 0', async () => {
    await executeSectionStatements(conn, blockerAmbiguousAppSeedSql());
    const appOrigins =
      `('${BLOCKER_DUP_APP_NAME}', ${BLOCKER_DUP_APP_X_1}, ${BLOCKER_DUP_APP_Y_1}),` +
      `('${BLOCKER_DUP_APP_NAME}', ${BLOCKER_DUP_APP_X_2}, ${BLOCKER_DUP_APP_Y_2})`;
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: appOrigins }));
    await executeSection(conn, sections.get('setup')!);
    const metrics = collectMetrics(await runReport(conn));

    expect(metrics.get('app_only'), 'app_only').toBe(0);
    expect(metrics.get('destination_only'), 'destination_only').toBe(0);
    expect(metrics.get('ambiguous_destination_names'), 'ambiguous_destination_names').toBe(0);
    expect(metrics.get('ambiguous_app_names'), 'ambiguous_app_names').toBe(1);
    expect(metrics.get('origin_mismatch'), 'origin_mismatch').toBe(0);
    expect(metrics.get('matched'), 'matched (excluded — the app name is ambiguous)').toBe(0);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 10 — an apostrophe in the name round-trips exactly. Regression pin
  // for the QUOTE()-backslash-escaping bug: QUOTE() would have produced
  // O\'BRIEN, and the stray backslash corrupts the outer @app_quadrat_origins
  // literal once pasted. Verified end-to-end against a real MySQL instance
  // (see the task report) before this test was written.
  // -------------------------------------------------------------------------

  it('an app-side name containing an apostrophe round-trips exactly through setup and matches on report', async () => {
    await executeSectionStatements(conn, apostropheSeedSql());

    // The VALUES-tuple text an operator's export query would produce for
    // this name: the apostrophe doubled once (the generated INSERT
    // statement's own string-literal escaping). buildInputsSql's
    // sqlStringLiteral() below — built on the SAME escapeQuotesOnce() used
    // for the destination-side INSERT above — doubles it again for the
    // outer @app_quadrat_origins literal, exactly as the export query's
    // REPLACE chain does.
    const appOrigins = `('${escapeQuotesOnce(APOSTROPHE_QUADRAT_NAME)}', ${APOSTROPHE_ORIGIN_X}, ${APOSTROPHE_ORIGIN_Y})`;
    await executeSection(conn, buildInputsSql({ appQuadratOrigins: appOrigins }));

    const setupMetrics = await executeSection(conn, sections.get('setup')!);
    expect(setupMetrics.get('inputs_ok'), 'inputs_ok').toBe(1);
    expect(setupMetrics.get('app_quadrats_loaded'), 'app_quadrats_loaded').toBe(1);

    const [loadedRows] = await conn.query<mysql.RowDataPacket[]>('SELECT QuadratName FROM quadrat_origin_app_20260909');
    expect(
      loadedRows.map(r => r.QuadratName),
      'the apostrophe survives the double-escaped round trip exactly'
    ).toEqual([APOSTROPHE_QUADRAT_NAME]);

    const metrics = collectMetrics(await runReport(conn));
    expect(metrics.get('app_only'), 'app_only').toBe(0);
    expect(metrics.get('destination_only'), 'destination_only').toBe(0);
    expect(metrics.get('matched'), 'matched — same name on both sides').toBe(1);
    expect(metrics.get('origin_equal'), 'origin_equal').toBe(1);
    expect(metrics.get('equivalence_ok'), 'equivalence_ok').toBe(1);
  });
});
