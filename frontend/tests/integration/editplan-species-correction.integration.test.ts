// Issue #427 — tree-wide species correction acceptance coverage.
//
// A species edit on a measurement already linked to an existing tree is not
// "re-link this one measurement to a different species" — it is "the
// researcher recorded the wrong species for this entire tree; correct the
// tree's SpeciesID in this census". This file is the real-MySQL acceptance
// surface for that contract: every tree, stem, and measurement attached to
// the corrected tree — active or inactive — must end up reflecting the
// corrected species, with the tree's TreeID, every StemGUID, and every
// measurement-to-stem link preserved and no new trees/stems/orphans created.
//
// The suite is driven exclusively through the public `analyzeEdit` /
// `applyEdit` / `revertEdit` entry points (never the planner or writer
// internals directly), against a real local MySQL schema, PLUS the real
// `POST` handler of `app/api/revisionupload/apply/route.ts` for the bulk
// (CSV-revision) species-correction path — the single-edit entry points
// above never exercise that route's own plan-hash handshake, request-body
// normalization, or auth boundary. Describe blocks cover: preview/plan
// construction, plan-hash drift detection, the pre-write destination-collision
// race, tree-wide write behavior (the corrected SpeciesID/RawSpCode
// projection, membership preservation, validation-error retention, and
// rollback-on-failure), a two-connection isolation regression under
// REPEATABLE READ, and the bulk route's stale-plan-hash rejection.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { NextRequest, type NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { TxExecutor } from '@/lib/db/connectionmanager';
import type { EditAuthorizationScope } from '@/config/editplan/authorization';
import type { AppliedSpeciesCorrectionBatchSummary } from '@/config/editplan/types';
import type { FileRow } from '@/config/macros/formdetails';

import { setupTestDatabase, teardownTestDatabase, createAdditionalCensus, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — same pattern as editplan-revert.integration.test.ts.
// ---------------------------------------------------------------------------
// Content-based fault trigger: `matches` is tested against every write
// statement inside the active transaction. 'match' fails the matching
// statement itself (for proving rollback of a LATE write, e.g. the ledger
// insert); 'next-after' lets the matching statement succeed and fails the
// FIRST write after it (for proving rollback of everything written AFTER a
// specific real mutation, e.g. the tree's own SpeciesID update), so the test
// proves the targeted mutation actually happened before the injected failure.
interface FaultSpec {
  matches: (query: string) => boolean;
  failOn: 'match' | 'next-after';
}

// Fires exactly once, after the first NON-LOCKING read statement matching
// `matches` has already returned its (real, unmodified) rows — used by the
// two-connection isolation describe block to run a second connection's
// committed write at the exact point where connection A's REPEATABLE READ
// transaction has established its snapshot but has not yet taken any
// locking (FOR UPDATE) read. `run` must not mutate `rows`; it exists only
// to interleave a second connection's commit at a precise point in the
// first connection's transaction.
interface PostReadHook {
  matches: (query: string) => boolean;
  run: () => Promise<void>;
}

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  faultSpec: null as FaultSpec | null,
  faultArmed: false,
  postReadHook: null as PostReadHook | null,
  postBeginTransactionHook: null as (() => Promise<void>) | null,
  // The authenticated session returned by the `@/auth` mock below (seeded by
  // the actual-POST helper immediately before each real `applyRevisionPOST`
  // call), and a log of every write-statement ATTEMPT issued inside a mocked
  // transaction — populated by executeQuery before any fault check runs, so
  // a statement later rejected by a fault hook still appears here.
  session: null as Session | null,
  transactionalWrites: [] as Array<{ query: string; params: unknown[] }>
}));

const TEST_TRANSACTION_ID_PREFIX = 'test-transaction-';

// Strips line/block SQL comments before classifying a statement, so a
// leading comment (e.g. a safeFormatQuery annotation) can never hide a real
// write from the fault injector or make a read look like a write.
function stripSqlComments(query: string): string {
  return query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function isWriteStatement(query: string): boolean {
  const normalized = stripSqlComments(query).trim().slice(0, 12).toUpperCase();
  return normalized.startsWith('INSERT') || normalized.startsWith('UPDATE') || normalized.startsWith('DELETE') || normalized.startsWith('REPLACE');
}

// Matches the real tree-wide write (`UPDATE ??.trees ... SpeciesID ...`)
// regardless of its exact column list, so this stays valid as the #427
// writer stage lands.
function matchesTreeSpeciesUpdate(query: string): boolean {
  const normalized = stripSqlComments(query);
  return /UPDATE\s+\S*\btrees\b/i.test(normalized) && /SpeciesID/i.test(normalized);
}

// Matches the edit_operations ledger INSERT (frontend/config/editoperations.ts).
function matchesLedgerInsert(query: string): boolean {
  const normalized = stripSqlComments(query);
  return /^\s*INSERT/i.test(normalized) && /edit_operations/i.test(normalized);
}

// Matches analyzer.ts's loadCurrentRow NON-LOCKING linked-row SELECT
// (`cm.StemGUID IS NOT NULL AND cm.IsActive = 1`, no `FOR UPDATE`) — the
// very first read applyEditInTransaction issues inside its transaction
// (via its own internal analyzeEdit call), which is what establishes that
// transaction's REPEATABLE READ snapshot. Explicitly excludes any `FOR
// UPDATE` variant, since a locking read is the opposite of what this
// predicate is isolating.
function matchesOrdinaryTargetMeasurementRead(query: string): boolean {
  const normalized = stripSqlComments(query);
  return (
    /FROM\s+\S*\bcoremeasurements\b/i.test(normalized) &&
    /StemGUID IS NOT NULL/i.test(normalized) &&
    /IsActive\s*=\s*1/i.test(normalized) &&
    !/FOR\s+UPDATE/i.test(normalized)
  );
}

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      if (transactionID && isWriteStatement(query)) {
        // Log the ATTEMPT before any fault check, so a write later rejected
        // by a fault hook below still shows up here. Direct fixture SQL
        // issued via `connection.query(...)` outside this adapter path is
        // intentionally never logged.
        sharedState.transactionalWrites.push({ query, params: [...(params ?? [])] });
        const spec = sharedState.faultSpec;
        if (spec) {
          if (spec.failOn === 'match' && spec.matches(query)) {
            throw new Error(`Injected fault: write statement matching the trigger was rejected for rollback test: ${query}`);
          }
          if (spec.failOn === 'next-after') {
            if (sharedState.faultArmed) {
              throw new Error(`Injected fault: write statement AFTER the trigger was rejected for rollback test: ${query}`);
            }
            if (spec.matches(query)) {
              sharedState.faultArmed = true; // let THIS matching write through; fail the next one.
            }
          }
        }
      }
      // Mirrors lib/db/primitives.ts's runQuery dispatch exactly, so this mock
      // cannot hide a parameter-binding bug that only execute()'s prepared
      // (binary) protocol would surface: undefined params become NULL, and
      // only CALL / bulk-nested-array params use the text protocol (query());
      // every other statement — including every parameterized app SQL
      // statement this writer issues — goes through execute().
      const normalizedParams = (params ?? []).map(param => (param === undefined ? null : param));
      const hasBulkValues = normalizedParams.some(p => Array.isArray(p) && p.length > 0 && Array.isArray(p[0]));
      const useTextProtocol = query.trim().startsWith('CALL') || hasBulkValues;
      const [rows] = await (useTextProtocol ? sharedState.connection.query(query, normalizedParams) : sharedState.connection.execute(query, normalizedParams));

      // Fire-once interleave point: runs a second connection's committed
      // write immediately after THIS read has already returned its real,
      // unmodified rows — never substitutes or mutates `rows` itself.
      const hook = sharedState.postReadHook;
      if (hook && !isWriteStatement(query) && hook.matches(query)) {
        sharedState.postReadHook = null;
        await hook.run();
      }

      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;

      // Fire-once, right after BEGIN succeeds and before any statement of
      // this transaction has run: models a transaction whose REPEATABLE
      // READ snapshot pre-exists its very first (locking or not) read.
      // revertEdit's species-correction undo path issues ONLY FOR UPDATE
      // reads once inside its transaction, so a post-read hook (like
      // postReadHook above) could never isolate "snapshot established,
      // no lock taken yet" there — this is the only point that can.
      const beginHook = sharedState.postBeginTransactionHook;
      if (beginHook) {
        sharedState.postBeginTransactionHook = null;
        try {
          await beginHook();
        } catch (hookError) {
          // The real A transaction is still open here — revertEdit never
          // received a txID, so it cannot roll it back itself, and a later
          // beforeEach DROP TABLE would implicitly commit it. Roll it back
          // ourselves and rethrow the ORIGINAL hook failure untouched.
          try {
            await sharedState.connection.rollback();
          } catch {
            // Swallow: a rollback failure must not mask the real cause.
          }
          sharedState.activeTransactionID = null;
          throw hookError;
        }
      }

      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch`);
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    // Mirrors the real ConnectionManager's withTransaction — begin via this
    // mock's own beginTransaction, hand the callback a TxExecutor bound to
    // that transaction id, commit on success, and on failure roll back and
    // rethrow the ORIGINAL callback error even if the rollback itself throws
    // (a rollback failure must never mask the real cause). No timeout/retry
    // /pool behavior is modeled here. Exercised for real by the revision-apply
    // route's own `connectionManager.withTransaction(...)` call.
    withTransaction: async <T>(fn: (tx: TxExecutor) => Promise<T>): Promise<T> => {
      const transactionID = await manager.beginTransaction();
      if (typeof transactionID !== 'string') {
        throw new Error('ConnectionManager mock: beginTransaction did not return a transaction id');
      }
      try {
        const result = await fn({
          id: transactionID,
          // TxExecutor.query is generic (`query<T>(sql, params?): Promise<T>`,
          // frontend/lib/db/connectionmanager.ts) — the real ConnectionManager
          // satisfies that by asserting executeQuery's mysql2 QueryResult
          // through `unknown` at this adapter boundary, same as every real
          // driver adapter does. This mock must do the same cast, or its
          // `query` property is only the (non-generic) type TypeScript infers
          // from executeQuery's concrete return type, which TS2322-rejects
          // against the generic `TxExecutor` interface.
          query: async <TResult>(sql: string, params?: unknown[]): Promise<TResult> => {
            const result = await manager.executeQuery(sql, params, transactionID);
            return result as unknown as TResult;
          }
        });
        await manager.commitTransaction(transactionID);
        return result;
      } catch (error) {
        try {
          await manager.rollbackTransaction(transactionID);
        } catch {
          // Swallow: a rollback failure must not mask the original error.
        }
        throw error;
      } finally {
        sharedState.activeTransactionID = null;
      }
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Auth boundary: the real revision-apply route calls `auth()` to get the
// current session before doing anything else. `sharedState.session` starts
// `null` (every real request is rejected until something sets it — see the
// outer `beforeEach` below), and the actual-POST helper sets a synthetic
// admin identity on it immediately before each real `applyRevisionPOST`
// call, so the route's own 401/403 auth gate is exercised for real rather
// than bypassed.
vi.mock('@/auth', () => ({
  auth: async () => sharedState.session
}));

// Partial mock: every real export (assertSessionMayEdit, snapshotAuthorization,
// assertAuthorizationStillFresh, fetchAuthoritativeAuthorization, the error
// classes, etc.) stays REAL. Only createFreshAuthorizationCheck is overridden,
// and even that override delegates to the REAL createFreshAuthorizationCheck —
// it just swaps the real network-calling default fetcher
// (fetchAuthoritativeAuthorization, which requires AUTH_FUNCTIONS_POLL_URL)
// for one backed by this file's own sharedState.session, via the real
// snapshotAuthorization. This keeps "is the session still fresh at commit
// time" logic entirely real; only the network hop is stubbed.
vi.mock('@/config/editplan/authorization', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/editplan/authorization')>();
  return {
    ...actual,
    createFreshAuthorizationCheck: (session: Session, scope: EditAuthorizationScope) =>
      actual.createFreshAuthorizationCheck(session, scope, async (_email: string) => {
        const currentSession = sharedState.session;
        return currentSession ? actual.snapshotAuthorization(currentSession) : null;
      })
  };
});

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { POST as applyRevisionPOST } from '@/app/api/revisionupload/apply/route';
import { ensureEditOperationsTable } from '@/config/editoperations';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { analyzeEdit } from '@/config/editplan/analyzer';
import { applyEdit, HashDriftError } from '@/config/editplan/apply';
import { EditPlanUnapplicableError } from '@/config/editplan/analyzer';
import { revertEdit, RevertDriftError, type RevertInput } from '@/config/editplan/revert';
import { SpeciesCorrectionUndoCurrentStateConflictError, SpeciesCorrectionUndoUnapplicableError } from '@/config/editplan/species-correction-undo';
import type { SpeciesCorrectionUndoConflictKind } from '@/config/editplan/species-correction-undo';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';
import {
  SpeciesCorrectionWriteConflictError,
  SPECIES_CORRECTION_METADATA_TABLE,
  SPECIES_CORRECTION_METADATA_VERSION,
  type SpeciesCorrectionMetadata
} from '@/config/editplan/tree-species-correction-writer';
import { SpeciesCorrectionUndoMetadataError } from '@/config/editplan/species-correction-undo-metadata';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';
import type { EditOperationStateRow } from '@/config/editoperations';

// ---------------------------------------------------------------------------
// Fixture constants.
// ---------------------------------------------------------------------------
const SPECIES_CODE_ACERRU = 'ACERRU';
const SPECIES_CODE_QUERCO = 'QUERCO';
const SPECIES_CODE_UNKNOWN = 'NOSUCH';

const QUADRAT_NAME_A = 'SCA';
const QUADRAT_NAME_B = 'SCB';

const TREE_TAG_SCT1 = 'SCT1'; // multi-stem, multi-measurement correction target
const TREE_TAG_SCT2 = 'SCT2'; // single-stem tree, separate correction target
const TREE_TAG_COLLIDE = 'SCCOL'; // destination-collision fixture tree

const STEM_TAG_S1 = 'SS1';
const STEM_TAG_S2 = 'SS2';
const STEM_TAG_S3 = 'SS3'; // inactive stem
const STEM_TAG_SOLO = 'SSOLO';

const ATTR_CODE_ALIVE = 'A';
const ATTR_CODE_DEAD = 'D';

const DBH_CM1 = 10.1;
const DBH_CM2 = 10.2;
const DBH_CM3 = 10.3;
const DBH_CM4 = 10.4;
const RAW_NULL_TARGET_DBH = 20.5;
const HOM_DEFAULT = 1.3;
const MEASUREMENT_DATE = '2024-06-15';
// A different calendar day inside the same census window
// ('2024-01-01'..'2024-12-31', local-db-setup.ts) than MEASUREMENT_DATE —
// used by the DATE-restoration undo test so the pre-apply/post-apply stored
// values are provably different, not accidentally identical.
const DATE_RESTORATION_MEASUREMENT_DATE = '2024-07-20';
const STEM_X = 1.0;
const STEM_Y = 2.0;

const DESCRIPTION_CM3 = 'unrelated sibling comment';

const CREATED_BY_APPLY = 'species-correction-test-apply';
const CREATED_BY_REVERT = 'species-correction-test-revert';
const ADMIN_ROLE = 'global';

// Item B: accompanying-field values for the "species correction may coexist
// with an ordinary measurement-value/coordinate edit on the SAME row" cases.
const ACCOMPANYING_DBH_VALUE = 20.5;
const ACCOMPANYING_DESCRIPTION_VALUE = 'corrected alongside species';
const ACCOMPANYING_ATTR_CODE = ATTR_CODE_DEAD;
const ACCOMPANYING_LOCAL_X = STEM_X + 5;
const ACCOMPANYING_LOCAL_Y = STEM_Y + 5;
const ACCOMPANYING_PLOT_X = 100.123;
const ACCOMPANYING_PLOT_Y = 200.456;

// Stored-precision regression (#427): coremeasurements.RawPlotX / stems.PlotX
// are DECIMAL(12,6) (frontend/db/sql/tablestructures.sql), but the client may
// submit more decimal places than that. The request intentionally carries 9
// decimals; MySQL — not the application — rounds it to the column's own
// 6-decimal scale on storage, so the stored value below is the exact
// round-half-up result of the requested value at 6 decimals.
const PRECISION_REQUESTED_PLOT_X = 1.123456789;
const PRECISION_STORED_PLOT_X = '1.123457';

// A distinct quadrat name for the other-census fixture tree in item B's
// upgraded preview test — quadrats has no CensusID of its own and enforces
// unique (PlotID, QuadratName, IsActive), so the other census's quadrat must
// not collide with QUADRAT_NAME_A/B.
const OTHER_CENSUS_QUADRAT_NAME = 'SCOC';
const OTHER_CENSUS_STEM_TAG = 'SSOC';
// Inside the other census's own StartDate/EndDate ('2025-01-01'..'2025-12-31'
// in the cross-census test below) — MEASUREMENT_DATE ('2024-06-15') is not.
const OTHER_CENSUS_MEASUREMENT_DATE = '2025-06-15';

// cm2's pre-apply RawCodes carries a code with no cmattributes row at all
// (CM2_UNKNOWN_RAW_CODE) alongside the two known ones — proving the revert
// restores exactly what was captured, not a regenerated approximation.
const CM2_UNKNOWN_RAW_CODE = 'XX-LEGACY';
const CM2_HISTORICAL_RAW_CODES = `${ATTR_CODE_ALIVE};${ATTR_CODE_DEAD};${CM2_UNKNOWN_RAW_CODE}`;
const CM2_CORRECTED_DBH = 15.7;
const CM2_LATER_RAW_COMMENTS = 'later unrelated comment on cm2 after the correction';
const CM3_LATER_DBH = 11.9;
const CM3_LATER_RAW_COMMENTS = 'later unrelated comment on sibling cm3 after the correction';

// Item C: sitespecificvalidations rows this test seeds and owns outright —
// explicit, test-controlled ValidationIDs (deliberately far outside any
// range setupTestDatabase's loadValidationDefinitions/corequeries.sql could
// ever assign), not whichever real validation happens to occupy some ID in
// the shared seed. ErrorCode is matched to ValidationID only by the
// CAST(ValidationID AS CHAR) convention used throughout this codebase
// (measurement_errors has no FK to sitespecificvalidations), so these
// ErrorCodes are plain strings. Each seeded row's Definition is a
// deliberately non-SQL marker string (SITE_VALIDATION_TEST_DEFINITION
// below): the species-correction writer must only ever read
// IsEnabled/Definition as metadata (TRIM(COALESCE(Definition,'')) <> '')
// to decide whether a code is resolvable — it must never execute it. If it
// ever did, this malformed text would throw a SQL syntax error and fail
// the test loudly instead of silently running live validation science.
const SITE_VALIDATION_ID_SUPPORTED = 900101; // IsEnabled=1, non-blank Definition — the one occurrence a correction is expected to resolve
const SITE_VALIDATION_ID_DISABLED = 900102; // IsEnabled=0, non-blank Definition — retained regardless of a matching ErrorCode
const SITE_VALIDATION_ID_BLANK_DEFINITION = 900103; // IsEnabled=1, blank Definition — retained because there is nothing rerunnable to match
const ERROR_CODE_SUPPORTED_RULE = String(SITE_VALIDATION_ID_SUPPORTED);
const ERROR_CODE_DISABLED_RULE = String(SITE_VALIDATION_ID_DISABLED);
const ERROR_CODE_BLANK_DEFINITION_RULE = String(SITE_VALIDATION_ID_BLANK_DEFINITION);
const ERROR_CODE_UNKNOWN_RULE = 'UNRECOGNIZED_RULE'; // matches no sitespecificvalidations.ValidationID at all

const PROCEDURE_NAME_SUPPORTED_RULE = 'Species427TestSupportedRule';
const PROCEDURE_NAME_DISABLED_RULE = 'Species427TestDisabledRule';
const PROCEDURE_NAME_BLANK_DEFINITION_RULE = 'Species427TestBlankDefinitionRule';
const SITE_VALIDATION_TEST_DEFINITION = 'NOT_EXECUTABLE_SQL_TEST_DEFINITION_MARKER';

async function seedSiteSpecificValidationRule(
  connection: Connection,
  validationID: number,
  procedureName: string,
  definition: string,
  isEnabled: boolean
): Promise<void> {
  await connection.query(
    `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Definition, IsEnabled)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ProcedureName = VALUES(ProcedureName), Definition = VALUES(Definition), IsEnabled = VALUES(IsEnabled)`,
    [validationID, procedureName, `seeded for #427 acceptance: ${procedureName}`, definition, isEnabled ? 1 : 0]
  );
}

interface SiteSpecificValidationRowSnapshot {
  existed: boolean;
  procedureName: string | null;
  description: string | null;
  definition: string | null;
  isEnabled: boolean | null;
}

// Captures a sitespecificvalidations row exactly as ingestion-stage setup
// (local-db-setup.ts) left it, so a test that must temporarily flip a
// production-seeded rule's IsEnabled/Definition (to prove a writer
// protects a given ErrorCode categorically, not merely because the rule
// happens to be disabled) can restore it byte-for-byte afterward — other
// tests and other suites depend on that row's original state.
async function captureSiteSpecificValidationRow(connection: Connection, validationID: number): Promise<SiteSpecificValidationRowSnapshot> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT ProcedureName, Description, Definition, IsEnabled FROM sitespecificvalidations WHERE ValidationID = ? LIMIT 1',
    [validationID]
  );
  if (rows.length === 0) return { existed: false, procedureName: null, description: null, definition: null, isEnabled: null };
  const row = rows[0];
  return {
    existed: true,
    procedureName: row.ProcedureName as string,
    description: row.Description as string,
    definition: row.Definition as string,
    isEnabled: decodeBitFlag(row.IsEnabled)
  };
}

// Reverses captureSiteSpecificValidationRow: restores every captured
// column, or deletes the row if it did not exist before the test touched
// it — either way leaving the table exactly as the next test will expect.
async function restoreSiteSpecificValidationRow(connection: Connection, validationID: number, snapshot: SiteSpecificValidationRowSnapshot): Promise<void> {
  if (!snapshot.existed) {
    await connection.query('DELETE FROM sitespecificvalidations WHERE ValidationID = ?', [validationID]);
    return;
  }
  await connection.query('UPDATE sitespecificvalidations SET ProcedureName = ?, Description = ?, Definition = ?, IsEnabled = ? WHERE ValidationID = ?', [
    snapshot.procedureName,
    snapshot.description,
    snapshot.definition,
    snapshot.isEnabled ? 1 : 0,
    validationID
  ]);
}

// Item D: a preliminary, unrelated single-row edit used only to populate the
// derived view tables (measurementssummary/viewfulltable) before the fault
// is armed, so the rollback assertions prove real rows were present and
// stayed present, not merely that an empty table stayed empty.
const PRELIMINARY_EDIT_DESCRIPTION = 'preliminary edit to populate derived views';

interface SpeciesCorrectionFixture {
  plotID: number;
  censusID: number;
  speciesIDs: Record<string, number>;
  quadratIDs: Record<string, number>;
  treeID: number; // SCT1
  stemGUIDs: { s1: number; s2: number; s3: number };
  coreMeasurementIDs: { cm1: number; cm2: number; cm3: number; cm4: number };
  soloTreeID: number; // SCT2
  soloStemGUID: number;
  soloCoreMeasurementID: number;
}

async function seedSpeciesCorrectionFixture(connection: Connection, testData: TestData): Promise<SpeciesCorrectionFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?, ?)', [
    SPECIES_CODE_ACERRU,
    SPECIES_CODE_QUERCO
  ]);
  const speciesIDs: Record<string, number> = {};
  for (const row of speciesRows) {
    speciesIDs[row.SpeciesCode as string] = row.SpeciesID as number;
  }

  const quadratIDs: Record<string, number> = {};
  for (const name of [QUADRAT_NAME_A, QUADRAT_NAME_B]) {
    const [res] = await connection.query<ResultSetHeader>(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
      [plotID, name]
    );
    quadratIDs[name] = res.insertId;
  }

  // --- SCT1: 3 stems (2 active, 1 inactive), 4 measurements (3 active, 1 inactive). ---
  const [treeRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
    TREE_TAG_SCT1,
    speciesIDs[SPECIES_CODE_ACERRU],
    censusID
  ]);
  const treeID = treeRes.insertId;

  const [s1Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [treeID, quadratIDs[QUADRAT_NAME_A], censusID, STEM_TAG_S1, STEM_X, STEM_Y]
  );
  const [s2Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [treeID, quadratIDs[QUADRAT_NAME_A], censusID, STEM_TAG_S2, STEM_X + 1, STEM_Y + 1]
  );
  const [s3Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [treeID, quadratIDs[QUADRAT_NAME_A], censusID, STEM_TAG_S3, STEM_X + 2, STEM_Y + 2]
  );
  const stemGUIDs = { s1: s1Res.insertId, s2: s2Res.insertId, s3: s3Res.insertId };

  // CM1: active, on S1, RawSpCode exactly matches current species ('ACERRU') — the measurement that will be edited.
  const [cm1Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      stemGUIDs.s1,
      censusID,
      DBH_CM1,
      HOM_DEFAULT,
      MEASUREMENT_DATE,
      TREE_TAG_SCT1,
      STEM_TAG_S1,
      SPECIES_CODE_ACERRU,
      QUADRAT_NAME_A,
      STEM_X,
      STEM_Y,
      ATTR_CODE_ALIVE,
      null,
      null
    ]
  );
  // CM2: active, on S1, RawSpCode is NULL — exercises undo-to-NULL.
  const [cm2Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [stemGUIDs.s1, censusID, DBH_CM2, HOM_DEFAULT, MEASUREMENT_DATE, TREE_TAG_SCT1, STEM_TAG_S1, QUADRAT_NAME_A, STEM_X, STEM_Y, ATTR_CODE_ALIVE, null, null]
  );
  // CM3: active, on S2, RawSpCode is a different-case spelling ('acerru') — exercises undo-to-differing-spelling,
  // and carries its own unrelated Description/DBH that a tree-wide write must not disturb.
  const [cm3Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      stemGUIDs.s2,
      censusID,
      DBH_CM3,
      HOM_DEFAULT,
      MEASUREMENT_DATE,
      TREE_TAG_SCT1,
      STEM_TAG_S2,
      'acerru',
      QUADRAT_NAME_A,
      STEM_X + 1,
      STEM_Y + 1,
      ATTR_CODE_ALIVE,
      DESCRIPTION_CM3,
      DESCRIPTION_CM3
    ]
  );
  // CM4: inactive, on S3 (inactive stem) — exercises inactive-membership sync/undo.
  const [cm4Res] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    [
      stemGUIDs.s3,
      censusID,
      DBH_CM4,
      HOM_DEFAULT,
      MEASUREMENT_DATE,
      TREE_TAG_SCT1,
      STEM_TAG_S3,
      SPECIES_CODE_ACERRU,
      QUADRAT_NAME_A,
      STEM_X + 2,
      STEM_Y + 2,
      ATTR_CODE_ALIVE,
      null,
      null
    ]
  );

  const coreMeasurementIDs = { cm1: cm1Res.insertId, cm2: cm2Res.insertId, cm3: cm3Res.insertId, cm4: cm4Res.insertId };

  // --- SCT2: single-stem, single-measurement tree — the "single stem" acceptance case. ---
  const [soloTreeRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
    TREE_TAG_SCT2,
    speciesIDs[SPECIES_CODE_ACERRU],
    censusID
  ]);
  const soloTreeID = soloTreeRes.insertId;
  const [soloStemRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [soloTreeID, quadratIDs[QUADRAT_NAME_B], censusID, STEM_TAG_SOLO, STEM_X, STEM_Y]
  );
  const soloStemGUID = soloStemRes.insertId;
  const [soloCmRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      soloStemGUID,
      censusID,
      DBH_CM1,
      HOM_DEFAULT,
      MEASUREMENT_DATE,
      TREE_TAG_SCT2,
      STEM_TAG_SOLO,
      SPECIES_CODE_ACERRU,
      QUADRAT_NAME_B,
      STEM_X,
      STEM_Y,
      ATTR_CODE_ALIVE,
      null,
      null
    ]
  );
  const soloCoreMeasurementID = soloCmRes.insertId;

  return {
    plotID,
    censusID,
    speciesIDs,
    quadratIDs,
    treeID,
    stemGUIDs,
    coreMeasurementIDs,
    soloTreeID,
    soloStemGUID,
    soloCoreMeasurementID
  };
}

async function loadCoreMeasurement(connection: Connection, coreMeasurementID: number): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM coremeasurements WHERE CoreMeasurementID = ? LIMIT 1', [coreMeasurementID]);
  if (rows.length === 0) throw new Error('coremeasurements row vanished');
  return rows[0] as Record<string, unknown>;
}

async function loadTree(connection: Connection, treeID: number): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM trees WHERE TreeID = ? LIMIT 1', [treeID]);
  if (rows.length === 0) throw new Error('trees row vanished');
  return rows[0] as Record<string, unknown>;
}

// ErrorSource/ErrorCode per frontend/db/sql/tablestructures.sql's
// measurement_errors (unique on (ErrorSource, ErrorCode)); storedprocedures.sql's
// ingestion stage is the only place that currently produces 20/21.
const ERROR_SOURCE_VALIDATION = 'validation';
const ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH = '20';
const ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT = '21';
// The sitespecificvalidations.ValidationID rows behind the two codes above
// (seeded IsEnabled=0/blank-Definition by local-db-setup.ts's inline
// validations) — derived from the ErrorCode strings themselves so there is
// exactly one source of truth for "which rule backs this code".
const SITE_VALIDATION_ID_PREVIOUS_CENSUS_SPECIES_MISMATCH = Number(ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH);
const SITE_VALIDATION_ID_SAME_BATCH_SPECIES_CONFLICT = Number(ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT);
// Temporary ProcedureNames used only while a test flips 20/21 to
// IsEnabled=1/non-blank to prove categorical protection; restored (along
// with every other column) before the test ends.
const PROCEDURE_NAME_PREVIOUS_CENSUS_SPECIES_MISMATCH_RERUNNABLE = 'Species427TestPreviousCensusSpeciesMismatchRerunnable';
const PROCEDURE_NAME_SAME_BATCH_SPECIES_CONFLICT_RERUNNABLE = 'Species427TestSameBatchSpeciesConflictRerunnable';
// Not a defined constant anywhere on THIS base (no config/validationoverride.ts);
// used here only as an arbitrary ErrorCode string to prove an already-resolved
// occurrence's history record survives, not to claim this base recognizes a
// MANAGER_OVERRIDE semantic.
const ERROR_CODE_MANAGER_OVERRIDE_LIKE = 'MANAGER_OVERRIDE';
// Fixed, deterministic immutable-history fields for the already-resolved
// manager-marker occurrence — seeded directly (not through
// seedMeasurementErrorLog, which always stamps "now") so every one of
// measurement_error_log's history columns can be compared byte-for-byte
// before vs. after the correction, not merely re-derived from a clock read.
const MANAGER_OVERRIDE_CREATED_AT = new Date('2024-01-01T00:00:00Z');
const MANAGER_OVERRIDE_RESOLVED_AT = new Date('2024-01-02T00:00:00Z');
const MANAGER_OVERRIDE_PRIOR_DBH = 42.5;
const MANAGER_OVERRIDE_PRIOR_HOM = 3.25;

// Fixed, deterministic CreatedAt/ResolvedAt for an already-resolved
// SUPPORTED-rule history occurrence (distinct dates from the manager
// marker above, which is a different ErrorCode on a different row, so
// there is no actual collision risk — distinct purely for readability
// when both appear in a failing assertion's diff).
const SUPPORTED_RULE_HISTORY_CREATED_AT = new Date('2024-02-01T00:00:00Z');
const SUPPORTED_RULE_HISTORY_RESOLVED_AT = new Date('2024-02-02T00:00:00Z');

// Ingestion-source (#307) codes used to prove the per-member, per-row
// nature of the correction's ingestion-error refresh — see
// frontend/config/measurementerrors.ts's revalidateEditedFailedRow.
const ERROR_SOURCE_INGESTION = 'ingestion';
// The one #307 code this correction can actually prove resolved: the
// writer's checker reads each active member's own CURRENT effective
// SpCode (the tree's canonical post-correction species, joined through
// stems/trees/species — see selectEffectiveFieldsForMeasurements in
// tree-species-correction-writer.ts), and revalidateEditedFailedRow adds
// INVALID_SPECIES to checkedCodes whenever that joined SpCode is non-blank.
const ERROR_CODE_INVALID_SPECIES = 'INVALID_SPECIES';
// Never added to checkedCodes by revalidateEditedFailedRow — an
// unsupported ingestion code that must stay unresolved regardless of the
// row's current fields, proving the refresh does not wholesale-clear
// ingestion errors.
const ERROR_CODE_UNSUPPORTED_INGESTION = 'DUPLICATE_ENTRY';
// IS checked every call (UNCONDITIONALLY_REVALIDATED_CODES), but only
// resolves when DBH/HOM/Codes are no longer all empty — used to prove a
// sibling's OWN still-genuine, unrelated issue survives a species
// correction instead of being swept away as collateral cleanup.
const ERROR_CODE_MISSING_MEASUREMENT_DATA = 'MISSING_MEASUREMENT_DATA';

async function seedMeasurementErrorLog(
  connection: Connection,
  coreMeasurementID: number,
  errorSource: string,
  errorCode: string,
  isResolved: boolean
): Promise<void> {
  await connection.query('INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES (?, ?, ?)', [
    errorSource,
    errorCode,
    `seeded for #427 acceptance: ${errorSource}/${errorCode}`
  ]);
  const [errorRows] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ? LIMIT 1', [
    errorSource,
    errorCode
  ]);
  const errorID = errorRows[0].ErrorID as number;
  await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt) VALUES (?, ?, ?, ?)', [
    coreMeasurementID,
    errorID,
    isResolved ? 1 : 0,
    isResolved ? new Date() : null
  ]);
}

async function loadMeasurementErrorLog(connection: Connection, coreMeasurementID: number): Promise<RowDataPacket[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT mel.MeasurementID, mel.IsResolved, mel.CreatedAt, mel.ResolvedAt,
            mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM, me.ErrorSource, me.ErrorCode
     FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE mel.MeasurementID = ? ORDER BY me.ErrorSource, me.ErrorCode`,
    [coreMeasurementID]
  );
  return rows;
}

async function countRows(connection: Connection, table: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return Number(rows[0].cnt);
}

async function loadStem(connection: Connection, stemGUID: number): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM stems WHERE StemGUID = ? LIMIT 1', [stemGUID]);
  if (rows.length === 0) throw new Error('stems row vanished');
  return rows[0] as Record<string, unknown>;
}

async function loadSpeciesRow(connection: Connection, speciesCode: string): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM species WHERE SpeciesCode = ? LIMIT 1', [speciesCode]);
  if (rows.length === 0) throw new Error(`species row vanished for ${speciesCode}`);
  return rows[0] as Record<string, unknown>;
}

async function loadMeasurementsSummaryRows(connection: Connection, coreMeasurementIDs: readonly number[]): Promise<RowDataPacket[]> {
  const placeholders = coreMeasurementIDs.map(() => '?').join(', ');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM measurementssummary WHERE CoreMeasurementID IN (${placeholders}) ORDER BY CoreMeasurementID`,
    [...coreMeasurementIDs]
  );
  return rows;
}

async function loadViewFullTableRows(connection: Connection, coreMeasurementIDs: readonly number[]): Promise<RowDataPacket[]> {
  const placeholders = coreMeasurementIDs.map(() => '?').join(', ');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM viewfulltable WHERE CoreMeasurementID IN (${placeholders}) ORDER BY CoreMeasurementID`,
    [...coreMeasurementIDs]
  );
  return rows;
}

// Decodes a MySQL BIT(1) column (e.g. coremeasurements.IsValidated), which
// mysql2's default (non-typeCast-overridden) text-protocol decoding returns
// as a 1-byte Buffer rather than a boolean/number — Number(Buffer) is NaN,
// so callers that need a tri-state (true/false/NULL) read must go through
// this helper rather than casting the raw driver value directly.
function decodeBitFlag(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] !== 0;
  return Boolean(value);
}

// Columns a tree-wide species correction (#427) changes on ANY attached
// coremeasurements row — the edited/target row included, not just its
// siblings: the species projection itself (RawSpCode), plus the
// pending-revalidation reset (IsValidated -> NULL) the writer applies on a
// changed row (writers/measurementssummary.ts's generic changesFound block
// resets the target's own IsValidated; tree-species-correction-writer.ts's
// resetValidationPending does the same for every ACTIVE sibling). A
// species-only correction must leave every OTHER persisted column —
// including the target row's own Raw* identity/position snapshot — exactly
// as it was before the edit; this list is what "every other column" means
// for that before/after comparison, on the target row as much as on a
// sibling.
const COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS = ['RawSpCode', 'IsValidated'] as const;

function omitColumns(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  for (const column of columns) delete result[column];
  return result;
}

// ---------------------------------------------------------------------------
// Rollback-evidence helpers (tree-wide write behavior: a fault-injected
// mid-transaction failure must restore EVERY row the correction could have
// touched, not just the ones a narrow assertion happens to check).
// ---------------------------------------------------------------------------

// edit_operations is DROPPED by this describe's beforeEach, so a rollback
// test's baseline read must never assume the table exists — it checks
// information_schema itself rather than let a bare "table doesn't exist"
// SQL error get caught upstream and misread as "zero rows, rollback
// proven".
async function loadEditOperationRowsForTargets(connection: Connection, targetIDs: readonly number[]): Promise<RowDataPacket[]> {
  const [tableRows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'edit_operations'`
  );
  if (Number(tableRows[0].cnt) === 0) return [];
  const placeholders = targetIDs.map(() => '?').join(', ');
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM edit_operations WHERE TargetID IN (${placeholders}) ORDER BY EditOperationID`, [
    ...targetIDs
  ]);
  return rows;
}

// Unconfirmed half of revertEdit's drift guard: an above-info restore plan
// always throws RevertDriftError here. Caller controls the confirmed retry
// so DB state between the throw and any retry stays inspectable.
async function expectRevertDriftError(cm: ConnectionManager, input: RevertInput): Promise<RevertDriftError> {
  try {
    await revertEdit(cm, input);
  } catch (err) {
    if (!(err instanceof RevertDriftError)) throw err;
    return err;
  }
  throw new Error('revertEdit unexpectedly succeeded without confirmedPlanHash');
}

interface SpeciesCorrectionRollbackSnapshot {
  tree: Record<string, unknown>;
  cm1: Record<string, unknown>;
  cm2: Record<string, unknown>;
  cm3: Record<string, unknown>;
  cm4: Record<string, unknown>;
  s1: Record<string, unknown>;
  s2: Record<string, unknown>;
  s3: Record<string, unknown>;
  cm1Log: RowDataPacket[];
  cm2Log: RowDataPacket[];
  cm3Log: RowDataPacket[];
  cm4Log: RowDataPacket[];
  editOperationRows: RowDataPacket[];
  measurementsSummaryRows: RowDataPacket[];
  viewFullTableRows: RowDataPacket[];
}

// Whole-row, whole-history snapshot of every row a tree-wide species
// correction on `fixture` can touch: the tree itself, all 3 stems, all 4
// measurements, each measurement's full error-log history, the
// edit_operations rows recorded against any of the 4 measurements, and both
// prepopulated derived read models. A rollback test takes this twice —
// before arming the fault, after clearing it — and asserts the two
// snapshots are `toEqual`, so an incomplete restore cannot pass by
// accident.
async function captureSpeciesCorrectionRollbackSnapshot(connection: Connection, fixture: SpeciesCorrectionFixture): Promise<SpeciesCorrectionRollbackSnapshot> {
  const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];
  const [tree, cm1, cm2, cm3, cm4, s1, s2, s3, cm1Log, cm2Log, cm3Log, cm4Log, editOperationRows, measurementsSummaryRows, viewFullTableRows] =
    await Promise.all([
      loadTree(connection, fixture.treeID),
      loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1),
      loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2),
      loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3),
      loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4),
      loadStem(connection, fixture.stemGUIDs.s1),
      loadStem(connection, fixture.stemGUIDs.s2),
      loadStem(connection, fixture.stemGUIDs.s3),
      loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1),
      loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2),
      loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3),
      loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4),
      loadEditOperationRowsForTargets(connection, allMemberIDs),
      loadMeasurementsSummaryRows(connection, allMemberIDs),
      loadViewFullTableRows(connection, allMemberIDs)
    ]);
  return { tree, cm1, cm2, cm3, cm4, s1, s2, s3, cm1Log, cm2Log, cm3Log, cm4Log, editOperationRows, measurementsSummaryRows, viewFullTableRows };
}

// Seeds one resolvable site-specific validation occurrence (on the target
// row, cm1) and one resolvable ingestion occurrence (on an untouched
// sibling, cm3) — pending history/resolution writes the full correction
// WOULD make — then runs one unrelated preliminary edit (Description-only,
// on cm2, through the public applyEdit; this is exactly what
// PRELIMINARY_EDIT_DESCRIPTION was reserved for) and an explicit scope-wide
// view refresh, so both derived read models carry a real row for every one
// of cm1..cm4 before either rollback test's baseline is captured. The
// refresh call passes no transactionID, so it runs on the real connection
// outside any transaction and is never subject to fault injection. Neither
// step touches cm1 or cm3's seeded occurrences: the preliminary edit's own
// non-species write path only ever mutates its own target row (cm2).
async function prepareRollbackFixtureHistoryAndViews(
  connection: Connection,
  cm: ConnectionManager,
  schema: string,
  fixture: SpeciesCorrectionFixture
): Promise<void> {
  await seedSiteSpecificValidationRule(connection, SITE_VALIDATION_ID_SUPPORTED, PROCEDURE_NAME_SUPPORTED_RULE, SITE_VALIDATION_TEST_DEFINITION, true);
  await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1, ERROR_SOURCE_VALIDATION, ERROR_CODE_SUPPORTED_RULE, false);
  await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_INGESTION, ERROR_CODE_INVALID_SPECIES, false);

  await applyEdit(cm, {
    dataType: 'measurementssummary',
    schema,
    plotID: fixture.plotID,
    censusID: fixture.censusID,
    targetID: fixture.coreMeasurementIDs.cm2,
    newRow: { Description: PRELIMINARY_EDIT_DESCRIPTION },
    expectedPlanHash: null,
    createdBy: CREATED_BY_APPLY,
    role: ADMIN_ROLE
  });

  const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];
  await refreshMeasurementViewsForCoreMeasurements(cm, schema, allMemberIDs, undefined);
}

// ---------------------------------------------------------------------------
// Bulk (CSV-revision) species-correction route helpers. These drive the REAL
// `POST` handler in `app/api/revisionupload/apply/route.ts` end to end — its
// own auth boundary, request-body normalization, and plan-hash handshake —
// rather than calling `analyzeBulk`/the writer internals directly.
// ---------------------------------------------------------------------------

// Fixed, unroutable synthetic origin for every real POST this file issues.
// `NextRequest` requires an absolute URL and the route never inspects it, so
// one named constant stands in for a real deployment host.
const SYNTHETIC_REVISION_APPLY_REQUEST_URL = 'http://localhost/api/revisionupload/apply';

// Synthetic admin identity seeded onto `sharedState.session` (consumed by the
// `@/auth` mock above) immediately before every real POST, so the route's own
// `requireSession` / `assertSessionMayEdit` / authorization-scope checks run
// for real rather than being bypassed. Seeding happens inside the POST helper
// itself — not once in `beforeAll` — specifically because the outer
// `beforeEach` below resets `sharedState.session` to `null` before every
// test; re-seeding on every call is what lets it survive that reset.
const SYNTHETIC_ADMIN_SESSION_EMAIL = 'species-correction-bulk-route-test@example.com';
const SYNTHETIC_ADMIN_SESSION_EXPIRES_AT = '2999-01-01T00:00:00.000Z';

function seedSyntheticAdminSession(): void {
  sharedState.session = {
    user: {
      userStatus: ADMIN_ROLE,
      name: SYNTHETIC_ADMIN_SESSION_EMAIL,
      email: SYNTHETIC_ADMIN_SESSION_EMAIL,
      sites: [],
      allsites: []
    },
    expires: SYNTHETIC_ADMIN_SESSION_EXPIRES_AT
  };
}

// One request-body row for the route's `matchedRows` array. `FileRow` values
// are always `string | null` — this is the CSV-ingestion shape the real
// upload pipeline produces, not a typed numeric form payload.
interface BulkApplyMatchedRowInput {
  csvIndex: number;
  coreMeasurementID: number;
  csvRow: FileRow;
}

interface BulkApplyRequestInput {
  schema: string;
  plotID: number;
  censusID: number;
  matchedRows: BulkApplyMatchedRowInput[];
  bulkPlanHash: string;
  newRows?: FileRow[];
  confirmNewRows?: boolean;
}

// Set once a real POST has actually been issued, so the outer `afterAll`
// below only pays for closing `lib/db/primitives`'s real pool (opened by the
// route's real `ensureUploadSessionsTable` path, outside the mocked
// ConnectionManager above) when this suite actually opened it.
let usedActualRevisionApplyPostHelper = false;

// Issues one real POST against the actual `applyRevisionPOST` handler.
async function performRevisionApplyPost(input: BulkApplyRequestInput): Promise<NextResponse> {
  seedSyntheticAdminSession();
  usedActualRevisionApplyPostHelper = true;
  const requestBody = {
    schema: input.schema,
    plotID: input.plotID,
    censusID: input.censusID,
    matchedRows: input.matchedRows,
    newRows: input.newRows ?? [],
    confirmNewRows: input.confirmNewRows ?? false,
    bulkPlanHash: input.bulkPlanHash
  };
  const request = new NextRequest(SYNTHETIC_REVISION_APPLY_REQUEST_URL, {
    method: 'POST',
    body: JSON.stringify(requestBody),
    headers: { 'content-type': 'application/json' }
  });
  return applyRevisionPOST(request);
}

interface AllEditOperationsLedgerSnapshot {
  rows: RowDataPacket[];
  count: number;
}

// Unfiltered `edit_operations` capture. `loadEditOperationRowsForTargets`
// above filters by `TargetID`, which MISSES bulk species-correction ledger
// rows (`TargetID IS NULL` — the correction targets a tree, not one
// measurement): a before/after equality check guarding against ANY write
// from a rejected bulk apply must see every row the ledger could have
// gained, not just the ones a target filter happens to catch.
async function captureAllEditOperationsLedger(connection: Connection): Promise<AllEditOperationsLedgerSnapshot> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM edit_operations ORDER BY EditOperationID');
  return { rows, count: rows.length };
}

interface BatchDatabaseStateSnapshot {
  trees: RowDataPacket[];
  stems: RowDataPacket[];
  coreMeasurements: RowDataPacket[];
  attributes: RowDataPacket[];
  errorCatalog: RowDataPacket[];
  errorLog: RowDataPacket[];
  measurementsSummary: RowDataPacket[];
  viewFullTable: RowDataPacket[];
  ledger: RowDataPacket[];
}

// Whole-database snapshot for blocked/race bulk-apply cases: a rejection must
// leave every table the pipeline could touch untouched, not just this
// fixture's own trees/stems/coremeasurements — this intentionally also
// covers solo fixtures, a later ordinary-row race fixture, and TargetID=NULL
// ledger rows that a narrower, target-filtered capture would miss.
async function captureBatchDatabaseState(connection: Connection): Promise<BatchDatabaseStateSnapshot> {
  const [trees] = await connection.query<RowDataPacket[]>('SELECT * FROM trees ORDER BY TreeID');
  const [stems] = await connection.query<RowDataPacket[]>('SELECT * FROM stems ORDER BY StemGUID');
  const [coreMeasurements] = await connection.query<RowDataPacket[]>('SELECT * FROM coremeasurements ORDER BY CoreMeasurementID');
  const [attributes] = await connection.query<RowDataPacket[]>('SELECT * FROM cmattributes ORDER BY CMAID');
  const [errorCatalog] = await connection.query<RowDataPacket[]>('SELECT * FROM measurement_errors ORDER BY ErrorID');
  const [errorLog] = await connection.query<RowDataPacket[]>('SELECT * FROM measurement_error_log ORDER BY MeasurementID, ErrorID');
  const [measurementsSummary] = await connection.query<RowDataPacket[]>('SELECT * FROM measurementssummary ORDER BY CoreMeasurementID');
  const [viewFullTable] = await connection.query<RowDataPacket[]>('SELECT * FROM viewfulltable ORDER BY CoreMeasurementID');
  const [ledger] = await connection.query<RowDataPacket[]>('SELECT * FROM edit_operations ORDER BY EditOperationID');
  return { trees, stems, coreMeasurements, attributes, errorCatalog, errorLog, measurementsSummary, viewFullTable, ledger };
}

interface UnrelatedBatchMeasurement {
  treeID: number;
  stemGUID: number;
  coreMeasurementID: number;
}

const UNRELATED_BATCH_TREE_TAG = 'SCRACE427';
const UNRELATED_BATCH_STEM_TAG = 'SSRACE427';

// Clones the solo fixture's tree/stem/measurement under distinct tags, for
// ordinary-row race cases that must prove a main-group batch is blocked
// without touching this unrelated sibling. The outer `beforeEach` already
// deletes all trees/stems/measurements before each test, so no extra
// cleanup is needed here.
async function seedUnrelatedBatchMeasurement(connection: Connection, fixture: SpeciesCorrectionFixture): Promise<UnrelatedBatchMeasurement> {
  const [treeRes] = await connection.query<ResultSetHeader>(
    'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) SELECT ?, SpeciesID, CensusID, IsActive FROM trees WHERE TreeID = ?',
    [UNRELATED_BATCH_TREE_TAG, fixture.soloTreeID]
  );
  const treeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    'INSERT INTO stems (TreeID, StemTag, QuadratID, CensusID, LocalX, LocalY, IsActive) SELECT ?, ?, QuadratID, CensusID, LocalX, LocalY, IsActive FROM stems WHERE StemGUID = ?',
    [treeID, UNRELATED_BATCH_STEM_TAG, fixture.soloStemGUID]
  );
  const stemGUID = stemRes.insertId;

  const [coreMeasurementRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements (
       StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
       RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
       RawCodes, RawComments, Description, IsValidated, IsActive
     )
     SELECT ?, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            ?, ?, RawSpCode, RawQuadrat, RawX, RawY,
            RawCodes, RawComments, Description, IsValidated, IsActive
     FROM coremeasurements WHERE CoreMeasurementID = ?`,
    [stemGUID, UNRELATED_BATCH_TREE_TAG, UNRELATED_BATCH_STEM_TAG, fixture.soloCoreMeasurementID]
  );
  const coreMeasurementID = coreMeasurementRes.insertId;

  return { treeID, stemGUID, coreMeasurementID };
}

// Mirrors the real route's own 409 response text
// (`RevisionApplyPlanHashMismatchError` handling in
// app/api/revisionupload/apply/route.ts) verbatim, so a wording change there
// fails this assertion instead of silently drifting out of sync.
const BULK_PLAN_HASH_MISMATCH_ERROR_MESSAGE = 'plan hash mismatch';

// A plan hash that can never match a freshly computed one.
const STALE_BULK_PLAN_HASH = 'stale-bulk-plan-hash-test-fixture';

// Fresh/stale plan-hash handshake: POSTs with `STALE_BULK_PLAN_HASH`,
// asserts the route rejects it with 409 plus the real mismatch message, that
// NOTHING was written (zero transactional-write attempts AND a
// byte-for-byte unchanged, unfiltered `edit_operations` ledger), then
// returns the route's own freshly computed `freshPlan.planHash` so the
// caller can retry with a hash the route will actually accept. Calls the
// REAL `ensureEditOperationsTable` before the request so both the before-
// and after-snapshot queries hit an existing (and, for a fresh caller,
// empty) ledger table rather than a missing one.
async function expectStaleBulkPlanHashRejectionAndReturnFreshPlanHash(
  connection: Connection,
  cm: ConnectionManager,
  input: Omit<BulkApplyRequestInput, 'bulkPlanHash'>
): Promise<string> {
  await ensureEditOperationsTable(cm, input.schema);
  const ledgerBeforeStaleAttempt = await captureAllEditOperationsLedger(connection);
  sharedState.transactionalWrites = [];

  const response = await performRevisionApplyPost({ ...input, bulkPlanHash: STALE_BULK_PLAN_HASH });

  expect(response.status, 'a stale bulkPlanHash must be rejected with 409, not applied').toBe(HTTPResponses.CONFLICT);
  const body = (await response.json()) as { error?: string; freshPlan?: { planHash?: string } };
  expect(body.error).toBe(BULK_PLAN_HASH_MISMATCH_ERROR_MESSAGE);
  expect(sharedState.transactionalWrites, 'a rejected stale-hash apply must attempt zero writes').toEqual([]);

  const ledgerAfterStaleAttempt = await captureAllEditOperationsLedger(connection);
  expect(ledgerAfterStaleAttempt, 'a rejected stale-hash apply must leave the edit_operations ledger byte-for-byte unchanged').toEqual(
    ledgerBeforeStaleAttempt
  );

  const freshPlanHash = body.freshPlan?.planHash;
  if (typeof freshPlanHash !== 'string' || freshPlanHash.trim() === '') {
    throw new Error('expected the 409 response body to include a non-empty freshPlan.planHash');
  }
  return freshPlanHash;
}

describe('tree-wide species correction (#427, integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  const cm = ConnectionManager.getInstance() as any;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    try {
      // The route's real `ensureUploadSessionsTable` path uses
      // `lib/db/primitives`'s real pool, outside the mocked ConnectionManager
      // above — only opened at all once `performRevisionApplyPost` has
      // actually run, so only close it in that case.
      if (usedActualRevisionApplyPostHelper) {
        await getPoolMonitorInstance().closeAllConnections();
      }
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  let fixture: SpeciesCorrectionFixture;
  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.transactionCounter = 0;
    sharedState.faultSpec = null;
    sharedState.faultArmed = false;
    sharedState.postReadHook = null;
    sharedState.postBeginTransactionHook = null;
    sharedState.transactionalWrites = [];
    sharedState.session = null;
    await connection.query('DROP TABLE IF EXISTS edit_operations');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query(`DELETE FROM quadrats WHERE QuadratName IN (?, ?, ?)`, [QUADRAT_NAME_A, QUADRAT_NAME_B, OTHER_CENSUS_QUADRAT_NAME]);
    // These three IDs (900100-range) are allocated and owned entirely by this
    // test file — never a pre-seeded production rule — so each test starts
    // from a clean slate and the in-test seedSiteSpecificValidationRule call
    // is the sole source of their state, not a leftover from a prior test.
    await connection.query('DELETE FROM sitespecificvalidations WHERE ValidationID IN (?, ?, ?)', [
      SITE_VALIDATION_ID_SUPPORTED,
      SITE_VALIDATION_ID_DISABLED,
      SITE_VALIDATION_ID_BLANK_DEFINITION
    ]);
    // Trim any extra census rows a previous test added via createAdditionalCensus.
    testData.census = testData.census.filter(c => c.plotCensusNumber === 1);
    fixture = await seedSpeciesCorrectionFixture(connection, testData);
  });

  // =========================================================================
  // 0. Real bulk revision-apply POST: one grouped tree-wide correction must
  //    produce the exact same final state regardless of which requesting
  //    row (cm1 or cm2) the client happens to submit first.
  // =========================================================================
  describe('bulk revision-apply: grouped species correction across requester submission orders (#427)', () => {
    const GROUPED_CORRECTION_DBH_CM1 = '21.1';
    const GROUPED_CORRECTION_DBH_CM2 = '22.2';
    const GROUPED_CORRECTION_LEDGER_OPERATION_TYPE = 'bulk-revision-row';

    const ROW_ORDERS: ReadonlyArray<{ label: string; order: ReadonlyArray<'cm1' | 'cm2'> }> = [
      { label: 'forward order (cm1 submitted before cm2)', order: ['cm1', 'cm2'] },
      { label: 'reversed order (cm2 submitted before cm1)', order: ['cm2', 'cm1'] }
    ];

    it.each(ROW_ORDERS)(
      'applies the grouped tree-wide correction to an identical final state regardless of requester submission order — $label',
      async ({ order }) => {
        const matchedRowByMember: Record<'cm1' | 'cm2', BulkApplyMatchedRowInput> = {
          cm1: {
            csvIndex: 0,
            coreMeasurementID: fixture.coreMeasurementIDs.cm1,
            csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM1 } as FileRow
          },
          cm2: {
            csvIndex: 1,
            coreMeasurementID: fixture.coreMeasurementIDs.cm2,
            csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM2 } as FileRow
          }
        };
        const requestInputWithoutHash = {
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          matchedRows: order.map(key => matchedRowByMember[key])
        };

        const treeCountBefore = await countRows(connection, 'trees');
        const stemCountBefore = await countRows(connection, 'stems');
        const cmCountBefore = await countRows(connection, 'coremeasurements');

        await ensureEditOperationsTable(cm, config.database);
        const snapshotBeforeHandshake = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);

        const freshBulkPlanHash = await expectStaleBulkPlanHashRejectionAndReturnFreshPlanHash(connection, cm, requestInputWithoutHash);
        expect(
          await captureSpeciesCorrectionRollbackSnapshot(connection, fixture),
          'the rejected stale-hash handshake must not mutate any domain/error/view state'
        ).toEqual(snapshotBeforeHandshake);

        sharedState.transactionalWrites = [];
        const response = await performRevisionApplyPost({ ...requestInputWithoutHash, bulkPlanHash: freshBulkPlanHash });
        expect(response.status, 'the fresh-hash apply must succeed').toBe(HTTPResponses.OK);
        const body = (await response.json()) as {
          updatedCount: number;
          skippedCount: number;
          speciesCorrections: AppliedSpeciesCorrectionBatchSummary;
        };
        expect(body.updatedCount, 'both requesting members must count as updated').toBe(2);
        expect(body.skippedCount, 'no submitted member should be skipped').toBe(0);

        const allMemberCoreMeasurementIDsAscending = [
          fixture.coreMeasurementIDs.cm1,
          fixture.coreMeasurementIDs.cm2,
          fixture.coreMeasurementIDs.cm3,
          fixture.coreMeasurementIDs.cm4
        ];
        const expectedBatchSummary: AppliedSpeciesCorrectionBatchSummary = {
          correctedTreeIDs: [fixture.treeID],
          updatedMemberCoreMeasurementIDs: [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2],
          additionalAffectedCoreMeasurementIDs: [fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4],
          allAffectedCoreMeasurementIDs: allMemberCoreMeasurementIDsAscending,
          groups: [
            {
              treeID: fixture.treeID,
              censusID: fixture.censusID,
              treeTag: TREE_TAG_SCT1,
              oldSpeciesID: fixture.speciesIDs[SPECIES_CODE_ACERRU],
              oldSpeciesCode: SPECIES_CODE_ACERRU,
              newSpeciesID: fixture.speciesIDs[SPECIES_CODE_QUERCO],
              newSpeciesCode: SPECIES_CODE_QUERCO,
              activeCoreMeasurementIDs: [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3],
              inactiveCoreMeasurementIDs: [fixture.coreMeasurementIDs.cm4],
              affectedCoreMeasurementIDs: allMemberCoreMeasurementIDsAscending,
              affectedStemGUIDs: [fixture.stemGUIDs.s1, fixture.stemGUIDs.s2, fixture.stemGUIDs.s3],
              submittedMemberCoreMeasurementIDs: [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2]
            }
          ]
        };
        expect(body.speciesCorrections, 'the returned batch summary must exactly match the grouped correction, regardless of submission order').toEqual(
          expectedBatchSummary
        );

        const treeSpeciesUpdateAttempts = sharedState.transactionalWrites.filter(write => matchesTreeSpeciesUpdate(write.query));
        expect(treeSpeciesUpdateAttempts, 'exactly one tree-wide SpeciesID UPDATE must be issued for the whole batch').toHaveLength(1);

        const treeAfter = await loadTree(connection, fixture.treeID);
        expect(Number(treeAfter.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

        const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
        const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
        const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
        const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
        const expectedStemGUIDByMember = [
          [cm1After, fixture.stemGUIDs.s1, true],
          [cm2After, fixture.stemGUIDs.s1, true],
          [cm3After, fixture.stemGUIDs.s2, true],
          [cm4After, fixture.stemGUIDs.s3, false]
        ] as const;
        for (const [row, expectedStemGUID, expectedActive] of expectedStemGUIDByMember) {
          expect(row.RawSpCode).toBe(SPECIES_CODE_QUERCO);
          expect(Number(row.StemGUID)).toBe(expectedStemGUID);
          expect(decodeBitFlag(row.IsActive)).toBe(expectedActive);
        }
        expect(Number(cm1After.MeasuredDBH)).toBeCloseTo(Number(GROUPED_CORRECTION_DBH_CM1), 2);
        expect(Number(cm2After.MeasuredDBH)).toBeCloseTo(Number(GROUPED_CORRECTION_DBH_CM2), 2);

        const s1After = await loadStem(connection, fixture.stemGUIDs.s1);
        const s2After = await loadStem(connection, fixture.stemGUIDs.s2);
        const s3After = await loadStem(connection, fixture.stemGUIDs.s3);
        for (const [stem, expectedActive] of [
          [s1After, true],
          [s2After, true],
          [s3After, false]
        ] as const) {
          expect(Number(stem.TreeID)).toBe(fixture.treeID);
          expect(decodeBitFlag(stem.IsActive)).toBe(expectedActive);
        }

        expect(await countRows(connection, 'trees'), 'no tree row may be created or destroyed by this correction').toBe(treeCountBefore);
        expect(await countRows(connection, 'stems'), 'no stem row may be created or destroyed by this correction').toBe(stemCountBefore);
        expect(await countRows(connection, 'coremeasurements'), 'no measurement row may be created or destroyed by this correction').toBe(cmCountBefore);

        const ledgerAfterApply = await captureAllEditOperationsLedger(connection);
        expect(ledgerAfterApply.count, 'exactly one ledger row summarizes the whole batch apply').toBe(1);
        const ledgerRow = ledgerAfterApply.rows[0];
        expect(ledgerRow.OperationType).toBe(GROUPED_CORRECTION_LEDGER_OPERATION_TYPE);
        expect(decodeBitFlag(ledgerRow.Revertable)).toBe(false);
        expect(ledgerRow.TargetID).toBeNull();

        const ledgerBeforeStateRows = parseEditOperationStateColumn(ledgerRow.BeforeState);
        const bulkRevisionApplyEntry = ledgerBeforeStateRows.find(entry => entry.table === 'bulk-revision-apply');
        expect(bulkRevisionApplyEntry, 'the ledger row must embed a bulk-revision-apply summary marker').toBeDefined();
        expect(bulkRevisionApplyEntry?.row?.speciesCorrections, 'the recorded summary must match what the route actually returned').toEqual(
          body.speciesCorrections
        );
        expect(bulkRevisionApplyEntry?.row?.updatedCoreMeasurementIDs, 'the recorded update list must match the submitted members, ascending').toEqual(
          expectedBatchSummary.updatedMemberCoreMeasurementIDs
        );
        expect(bulkRevisionApplyEntry?.row?.updatedCount).toBe(body.updatedCount);
        expect(bulkRevisionApplyEntry?.row?.skippedCount).toBe(body.skippedCount);

        const summaryRows = await loadMeasurementsSummaryRows(connection, allMemberCoreMeasurementIDsAscending);
        const fullTableRows = await loadViewFullTableRows(connection, allMemberCoreMeasurementIDsAscending);
        expect(summaryRows, 'all four members must appear in measurementssummaryview').toHaveLength(4);
        expect(fullTableRows, 'all four members must appear in viewfulltable').toHaveLength(4);
        for (const row of [...summaryRows, ...fullTableRows]) {
          expect(row.SpeciesCode).toBe(SPECIES_CODE_QUERCO);
          expect(Number(row.TreeID)).toBe(fixture.treeID);
        }
      }
    );

    const NEGATIVE_SEEDED_MEASURED_DBH = -5.5;
    const ERROR_CODE_NEGATIVE_DBH = 'NEGATIVE_DBH';
    const OMITTED_SPCODE_POSITIVE_DBH_CM2 = '15.5';
    const CM1_UPDATED_COMMENT = 'cm1 updated comment (#427 omitted-spcode case)';
    const CM2_UPDATED_COMMENT = 'cm2 updated comment (#427 omitted-spcode case)';
    const CM1_SUBMITTED_CODES = ATTR_CODE_DEAD;
    const CM2_SUBMITTED_CODES = `${ATTR_CODE_ALIVE};${ATTR_CODE_DEAD}`;
    const CM2_LX_DBH_EDIT_OMIT_COLUMNS = ['MeasuredDBH', 'RawX', 'RawSpCode', 'IsValidated', 'Description', 'RawComments', 'RawCodes'] as const;

    const SPCODE_OMISSION_VARIANTS: ReadonlyArray<{ label: string; buildCm2CsvRow: () => FileRow }> = [
      {
        label: 'spcode key omitted entirely',
        buildCm2CsvRow: () =>
          ({
            dbh: OMITTED_SPCODE_POSITIVE_DBH_CM2,
            lx: String(ACCOMPANYING_LOCAL_X),
            comments: CM2_UPDATED_COMMENT,
            codes: CM2_SUBMITTED_CODES
          }) as FileRow
      },
      {
        label: 'spcode present as an empty string',
        buildCm2CsvRow: () =>
          ({
            spcode: '',
            dbh: OMITTED_SPCODE_POSITIVE_DBH_CM2,
            lx: String(ACCOMPANYING_LOCAL_X),
            comments: CM2_UPDATED_COMMENT,
            codes: CM2_SUBMITTED_CODES
          }) as FileRow
      }
    ];

    it.each(SPCODE_OMISSION_VARIANTS)(
      "a sibling's omitted-vs-blank spcode cannot bypass the tree-wide correction another member requested — $label",
      async ({ buildCm2CsvRow }) => {
        await connection.query(
          'UPDATE coremeasurements SET MeasuredDBH = ?, RawTreeTag = NULL, RawStemTag = NULL, RawQuadrat = NULL, RawY = NULL WHERE CoreMeasurementID = ?',
          [NEGATIVE_SEEDED_MEASURED_DBH, fixture.coreMeasurementIDs.cm2]
        );
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_INGESTION, ERROR_CODE_NEGATIVE_DBH, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_VALIDATION, ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_VALIDATION, ERROR_CODE_UNKNOWN_RULE, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH, true);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION, false);

        const cm2Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
        const cm4Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
        const cm1LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1);
        const cm2LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
        const cm3LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
        const cm4LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);

        const matchedRows: BulkApplyMatchedRowInput[] = [
          {
            csvIndex: 0,
            coreMeasurementID: fixture.coreMeasurementIDs.cm1,
            csvRow: {
              spcode: SPECIES_CODE_QUERCO,
              lx: String(ACCOMPANYING_LOCAL_X),
              comments: CM1_UPDATED_COMMENT,
              codes: CM1_SUBMITTED_CODES
            } as FileRow
          },
          { csvIndex: 1, coreMeasurementID: fixture.coreMeasurementIDs.cm2, csvRow: buildCm2CsvRow() },
          { csvIndex: 2, coreMeasurementID: fixture.coreMeasurementIDs.cm3, csvRow: {} as FileRow }
        ];
        const requestInputWithoutHash = { schema: config.database, plotID: fixture.plotID, censusID: fixture.censusID, matchedRows };

        const freshBulkPlanHash = await expectStaleBulkPlanHashRejectionAndReturnFreshPlanHash(connection, cm, requestInputWithoutHash);

        sharedState.transactionalWrites = [];
        const response = await performRevisionApplyPost({ ...requestInputWithoutHash, bulkPlanHash: freshBulkPlanHash });
        expect(response.status, 'the fresh-hash apply must succeed even though cm2 never names its own spcode').toBe(HTTPResponses.OK);
        const body = (await response.json()) as {
          updatedCount: number;
          skippedCount: number;
          speciesCorrections: AppliedSpeciesCorrectionBatchSummary;
        };
        expect(body.updatedCount, 'cm1 (species+lx) and cm2 (dbh+lx) both have real local changes to apply').toBe(2);
        expect(body.skippedCount, "cm3's empty csvRow carries no local change and must be skipped").toBe(1);

        const treeSpeciesUpdateAttempts = sharedState.transactionalWrites.filter(write => matchesTreeSpeciesUpdate(write.query));
        expect(treeSpeciesUpdateAttempts, 'exactly one tree-wide SpeciesID UPDATE must still be issued for the whole batch').toHaveLength(1);

        const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
        const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
        const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
        const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
        for (const row of [cm1After, cm2After, cm3After, cm4After]) {
          expect(row.RawSpCode, "every member's RawSpCode must follow the tree-wide correction cm1 requested").toBe(SPECIES_CODE_QUERCO);
        }

        expect(Number(cm2After.MeasuredDBH), 'the negative seeded DBH must have been replaced by the exact submitted positive value').toBe(
          Number(OMITTED_SPCODE_POSITIVE_DBH_CM2)
        );

        const s1After = await loadStem(connection, fixture.stemGUIDs.s1);
        expect(Number(s1After.LocalX), 'cm1 and cm2 agree on the same lx for their shared stem').toBeCloseTo(ACCOMPANYING_LOCAL_X, 6);

        expect(
          omitColumns(cm2After, CM2_LX_DBH_EDIT_OMIT_COLUMNS),
          'every cm2 column besides dbh/lx/comments/codes/species/validation must be untouched — including the seeded unrelated raw NULLs'
        ).toEqual(omitColumns(cm2Before, CM2_LX_DBH_EDIT_OMIT_COLUMNS));

        expect(cm1After.Description, "cm1's own submitted comment must land on Description").toBe(CM1_UPDATED_COMMENT);
        expect(cm1After.RawComments, "cm1's own submitted comment must mirror onto RawComments").toBe(CM1_UPDATED_COMMENT);
        expect(cm1After.RawCodes, "cm1's own submitted codes must land on RawCodes verbatim").toBe(CM1_SUBMITTED_CODES);
        expect(cm2After.Description, "cm2's own submitted comment must land on Description").toBe(CM2_UPDATED_COMMENT);
        expect(cm2After.RawComments, "cm2's own submitted comment must mirror onto RawComments").toBe(CM2_UPDATED_COMMENT);
        expect(cm2After.RawCodes, "cm2's own submitted codes must land on RawCodes verbatim").toBe(CM2_SUBMITTED_CODES);

        const [cm1AttrRows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code', [
          fixture.coreMeasurementIDs.cm1
        ]);
        const [cm2AttrRows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code', [
          fixture.coreMeasurementIDs.cm2
        ]);
        expect(
          cm1AttrRows.map(row => row.Code),
          "cm1's codes rebuild to exactly its own submitted single code"
        ).toEqual([ATTR_CODE_DEAD]);
        expect(
          cm2AttrRows.map(row => row.Code),
          "cm2's codes rebuild to exactly its own submitted two codes"
        ).toEqual([ATTR_CODE_ALIVE, ATTR_CODE_DEAD]);

        const cm1LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1);
        const cm3LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
        const cm4LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);
        const findLogRow = (rows: RowDataPacket[], errorSource: string, errorCode: string) =>
          rows.find(row => row.ErrorSource === errorSource && row.ErrorCode === errorCode);

        expect(
          findLogRow(cm1LogAfter, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH),
          "cm1's unrelated previous-census-mismatch history must survive this correction untouched"
        ).toEqual(findLogRow(cm1LogBefore, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH));
        expect(
          findLogRow(cm3LogAfter, ERROR_SOURCE_VALIDATION, ERROR_CODE_UNKNOWN_RULE),
          "cm3's unrelated unknown-rule history must survive this correction untouched"
        ).toEqual(findLogRow(cm3LogBefore, ERROR_SOURCE_VALIDATION, ERROR_CODE_UNKNOWN_RULE));
        expect(
          findLogRow(cm3LogAfter, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH),
          "cm3's already-resolved previous-census-mismatch history must survive this correction untouched"
        ).toEqual(findLogRow(cm3LogBefore, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH));
        expect(
          findLogRow(cm4LogAfter, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION),
          "cm4's unrelated unsupported-ingestion history must survive this correction untouched"
        ).toEqual(findLogRow(cm4LogBefore, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION));

        expect(omitColumns(cm4After, ['RawSpCode']), 'cm4 is inactive and never submitted — only its RawSpCode may move from the tree-wide correction').toEqual(
          omitColumns(cm4Before, ['RawSpCode'])
        );

        const cm2LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
        expect(
          findLogRow(cm2LogAfter, ERROR_SOURCE_VALIDATION, ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT),
          "cm2's own unrelated same-batch-conflict history must survive this correction untouched"
        ).toEqual(findLogRow(cm2LogBefore, ERROR_SOURCE_VALIDATION, ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT));
        const negativeDbhOccurrence = cm2LogAfter.find(row => row.ErrorSource === ERROR_SOURCE_INGESTION && row.ErrorCode === ERROR_CODE_NEGATIVE_DBH);
        expect(negativeDbhOccurrence, "the seeded negative-DBH occurrence must still be present in cm2's history").toBeDefined();
        expect(decodeBitFlag(negativeDbhOccurrence!.IsResolved), 'the refresh must see the final (positive) stored DBH, not the submitted request').toBe(true);

        expect(body.speciesCorrections.updatedMemberCoreMeasurementIDs, 'only cm1 and cm2 actually changed a field of their own').toEqual([
          fixture.coreMeasurementIDs.cm1,
          fixture.coreMeasurementIDs.cm2
        ]);
        expect(
          body.speciesCorrections.additionalAffectedCoreMeasurementIDs,
          'cm4 is swept in by the tree-wide correction without ever being submitted'
        ).toEqual([fixture.coreMeasurementIDs.cm4]);
        expect(
          body.speciesCorrections.groups[0].submittedMemberCoreMeasurementIDs,
          'cm3 was matched/submitted even though its own csvRow produced no local change'
        ).toEqual([fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3]);

        const ledgerAfterApply = await captureAllEditOperationsLedger(connection);
        expect(ledgerAfterApply.count, 'exactly one ledger row summarizes the whole batch apply').toBe(1);
      }
    );

    it('rolls back the already-applied tree-wide write when the batch ledger INSERT fails', async () => {
      const matchedRowByMember: Record<'cm1' | 'cm2', BulkApplyMatchedRowInput> = {
        cm1: {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM1 } as FileRow
        },
        cm2: {
          csvIndex: 1,
          coreMeasurementID: fixture.coreMeasurementIDs.cm2,
          csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM2 } as FileRow
        }
      };
      const requestInputWithoutHash = {
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        matchedRows: [matchedRowByMember.cm1, matchedRowByMember.cm2]
      };

      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);
      const freshBulkPlanHash = await expectStaleBulkPlanHashRejectionAndReturnFreshPlanHash(connection, cm, requestInputWithoutHash);
      const snapshotBefore = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      const ledgerBefore = await captureAllEditOperationsLedger(connection);

      sharedState.transactionalWrites = [];
      sharedState.faultSpec = { matches: matchesLedgerInsert, failOn: 'match' };
      let response: NextResponse;
      try {
        response = await performRevisionApplyPost({ ...requestInputWithoutHash, bulkPlanHash: freshBulkPlanHash });
      } finally {
        sharedState.faultSpec = null;
        sharedState.faultArmed = false;
      }

      expect(response.status, 'the injected ledger-insert fault must surface as a server error').toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

      const treeUpdateIndex = sharedState.transactionalWrites.findIndex(write => matchesTreeSpeciesUpdate(write.query));
      const ledgerInsertIndex = sharedState.transactionalWrites.findIndex(write => matchesLedgerInsert(write.query));
      expect(treeUpdateIndex, 'the tree-wide SpeciesID UPDATE must have been attempted').not.toBe(-1);
      expect(ledgerInsertIndex, 'the ledger INSERT must have been attempted and faulted').not.toBe(-1);
      expect(treeUpdateIndex, 'the tree write must execute before the faulted ledger insert').toBeLessThan(ledgerInsertIndex);

      expect(await captureSpeciesCorrectionRollbackSnapshot(connection, fixture), 'the transaction must roll back to the pre-apply domain state').toEqual(
        snapshotBefore
      );
      expect(await captureAllEditOperationsLedger(connection), 'no ledger row may persist from a rolled-back batch apply').toEqual(ledgerBefore);
    });

    it('rejects an otherwise-valid batch that pairs a species correction with an unrelated new row (#427, F43)', async () => {
      const UNRELATED_NEW_ROW_TAG = 'SCNEW427';
      const UNRELATED_NEW_ROW_STEMTAG = 'SNEW427';
      const UNRELATED_NEW_ROW_LX = '3';
      const UNRELATED_NEW_ROW_LY = '4';
      const UNRELATED_NEW_ROW_DBH = '11';
      const UNRELATED_NEW_ROW_HOM = '1.3';
      const PLAN_NOT_APPLICABLE_ERROR = 'plan not applicable';
      const GROUP_NEW_ROWS_REQUIRE_SEPARATE_BATCH_REASON = 'group_new_rows_require_separate_batch';

      const matchedRows: BulkApplyMatchedRowInput[] = [
        {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM1 } as FileRow
        }
      ];
      const unrelatedNewRow = {
        tag: UNRELATED_NEW_ROW_TAG,
        stemtag: UNRELATED_NEW_ROW_STEMTAG,
        spcode: SPECIES_CODE_ACERRU,
        quadrat: QUADRAT_NAME_A,
        lx: UNRELATED_NEW_ROW_LX,
        ly: UNRELATED_NEW_ROW_LY,
        dbh: UNRELATED_NEW_ROW_DBH,
        hom: UNRELATED_NEW_ROW_HOM,
        date: MEASUREMENT_DATE
      } as FileRow;

      await ensureEditOperationsTable(cm, config.database);
      const snapshotBefore = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      const ledgerBefore = await captureAllEditOperationsLedger(connection);
      const treeCountBefore = await countRows(connection, 'trees');
      const stemCountBefore = await countRows(connection, 'stems');
      const cmCountBefore = await countRows(connection, 'coremeasurements');

      sharedState.transactionalWrites = [];
      const response = await performRevisionApplyPost({
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        matchedRows,
        newRows: [unrelatedNewRow],
        confirmNewRows: true,
        bulkPlanHash: STALE_BULK_PLAN_HASH
      });

      expect(response.status, 'an unrelated new row paired with a species correction must be rejected as inapplicable').toBe(
        HTTPResponses.UNPROCESSABLE_ENTITY
      );
      const body = (await response.json()) as { error: string; blockingErrors: Array<{ reason: string }> };
      expect(body.error).toBe(PLAN_NOT_APPLICABLE_ERROR);
      expect(body.blockingErrors.map(blockingError => blockingError.reason)).toEqual([GROUP_NEW_ROWS_REQUIRE_SEPARATE_BATCH_REASON]);

      expect(sharedState.transactionalWrites, 'a rejected-as-inapplicable batch must not attempt any write').toHaveLength(0);
      expect(await captureSpeciesCorrectionRollbackSnapshot(connection, fixture), 'the domain state must be untouched').toEqual(snapshotBefore);
      expect(await captureAllEditOperationsLedger(connection), 'no ledger row may be written').toEqual(ledgerBefore);
      expect(await countRows(connection, 'trees')).toBe(treeCountBefore);
      expect(await countRows(connection, 'stems')).toBe(stemCountBefore);
      expect(await countRows(connection, 'coremeasurements')).toBe(cmCountBefore);
    });

    // Reusable blocked/race-case assertion for the remaining bulk-apply
    // conflict cases: proves the batch is rejected as inapplicable with a
    // SINGLE, consistent reason across every blocking entry, attempts zero
    // writes, and leaves the FULL database state (not just this fixture's
    // own trees/stems/coremeasurements) byte-for-byte unchanged.
    type BatchConflictBlockingError = { reason: string; rowIndexes?: number[] };
    const PLAN_NOT_APPLICABLE_ERROR = 'plan not applicable';

    async function expectBatchConflictWithoutWrites(
      matchedRows: BulkApplyMatchedRowInput[],
      newRows: FileRow[],
      expectedReason: string
    ): Promise<BatchConflictBlockingError[]> {
      await ensureEditOperationsTable(cm, config.database);
      const stateBefore = await captureBatchDatabaseState(connection);
      sharedState.transactionalWrites = [];

      const response = await performRevisionApplyPost({
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        matchedRows,
        newRows,
        confirmNewRows: newRows.length > 0,
        bulkPlanHash: STALE_BULK_PLAN_HASH
      });

      expect(response.status, 'a conflicting/blocked batch must be rejected as inapplicable').toBe(HTTPResponses.UNPROCESSABLE_ENTITY);
      const body = (await response.json()) as { error: string; blockingErrors: BatchConflictBlockingError[] };
      expect(body.error).toBe(PLAN_NOT_APPLICABLE_ERROR);
      expect(body.blockingErrors.length, 'at least one blocking reason must be reported').toBeGreaterThan(0);
      for (const blockingError of body.blockingErrors) {
        expect(blockingError.reason, 'every blocking reason must match the expected conflict').toBe(expectedReason);
      }

      expect(sharedState.transactionalWrites, 'a rejected-as-inapplicable batch must not attempt any write').toHaveLength(0);
      expect(await captureBatchDatabaseState(connection), 'the full database state must be untouched by a rejected batch').toEqual(stateBefore);

      return body.blockingErrors;
    }

    it('rejects a batch where one member explicitly re-submits the unchanged species while another requests a correction (#427, group conflict)', async () => {
      const GROUP_SPECIES_CONFLICT_REASON = 'group_species_conflict';

      const matchedRows: BulkApplyMatchedRowInput[] = [
        {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_QUERCO } as FileRow
        },
        {
          csvIndex: 1,
          coreMeasurementID: fixture.coreMeasurementIDs.cm2,
          csvRow: { spcode: SPECIES_CODE_ACERRU } as FileRow
        }
      ];

      const blockingErrors = await expectBatchConflictWithoutWrites(matchedRows, [], GROUP_SPECIES_CONFLICT_REASON);
      expect(
        blockingErrors.length,
        'cm1 requesting QUERCO while cm2 explicitly keeps its unchanged ACERRU must surface at least one species conflict'
      ).toBeGreaterThan(0);
    });

    it('rejects a batch whose new row tag collates equal to the corrected tree tag under a different case (#427, identity overlap new row)', async () => {
      const GROUP_IDENTITY_OVERLAP_REASON = 'group_identity_overlap';
      const LOWERCASE_TREE_TAG = TREE_TAG_SCT1.toLowerCase();
      const NEW_ROW_STEMTAG_IDENTITY_OVERLAP = 'SNEWB427';
      const NEW_ROW_SPCODE_TILIAA = 'TILIAA';
      const NEW_ROW_LX = '3';
      const NEW_ROW_LY = '4';
      const NEW_ROW_DBH = '11';
      const NEW_ROW_HOM = '1.3';

      const [sameTagRows] = await connection.query<RowDataPacket[]>('SELECT TreeTag = ? AS SameTag FROM trees WHERE TreeID = ?', [
        LOWERCASE_TREE_TAG,
        fixture.treeID
      ]);
      expect(Number(sameTagRows[0].SameTag), 'the database collation must treat the lowercase tag as equal to the fixture tree tag').toBe(1);

      const matchedRows: BulkApplyMatchedRowInput[] = [
        {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM1 } as FileRow
        }
      ];
      const newRow = {
        tag: LOWERCASE_TREE_TAG,
        stemtag: NEW_ROW_STEMTAG_IDENTITY_OVERLAP,
        spcode: NEW_ROW_SPCODE_TILIAA,
        quadrat: QUADRAT_NAME_A,
        lx: NEW_ROW_LX,
        ly: NEW_ROW_LY,
        dbh: NEW_ROW_DBH,
        hom: NEW_ROW_HOM,
        date: MEASUREMENT_DATE
      } as FileRow;

      const blockingErrors = await expectBatchConflictWithoutWrites(matchedRows, [newRow], GROUP_IDENTITY_OVERLAP_REASON);
      expect(
        blockingErrors.length,
        'a new row whose tag collates equal to the corrected tree must surface a specific identity-overlap conflict, not the generic new-rows restriction'
      ).toBeGreaterThan(0);
    });

    it('rejects a batch where an unrelated solo fixture row re-submits a tag that collates equal to the corrected tree (#427, identity overlap solo row)', async () => {
      const GROUP_IDENTITY_OVERLAP_REASON = 'group_identity_overlap';
      const LOWERCASE_TREE_TAG = TREE_TAG_SCT1.toLowerCase();

      const matchedRows: BulkApplyMatchedRowInput[] = [
        {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: GROUPED_CORRECTION_DBH_CM1 } as FileRow
        },
        {
          csvIndex: 1,
          coreMeasurementID: fixture.soloCoreMeasurementID,
          csvRow: { tag: LOWERCASE_TREE_TAG } as FileRow
        }
      ];

      const blockingErrors = await expectBatchConflictWithoutWrites(matchedRows, [], GROUP_IDENTITY_OVERLAP_REASON);
      expect(
        blockingErrors.length,
        'the unrelated solo-fixture row re-submitting a tag that collates equal to the corrected tree must surface an identity-overlap conflict'
      ).toBeGreaterThan(0);
    });

    it('rejects a batch where two independently-submitted species corrections would collide on the same prospective destination tag (#427, prospective group collision)', async () => {
      const GROUP_IDENTITY_OVERLAP_REASON = 'group_identity_overlap';
      const SPECIES_CODE_TILIAA = 'TILIAA';
      const LOWERCASE_TREE_TAG = TREE_TAG_SCT1.toLowerCase();

      await connection.query('UPDATE trees SET TreeTag = ?, SpeciesID = ? WHERE TreeID = ?', [
        LOWERCASE_TREE_TAG,
        fixture.speciesIDs[SPECIES_CODE_QUERCO],
        fixture.soloTreeID
      ]);
      await connection.query('UPDATE coremeasurements SET RawTreeTag = ?, RawSpCode = ? WHERE CoreMeasurementID = ?', [
        LOWERCASE_TREE_TAG,
        SPECIES_CODE_QUERCO,
        fixture.soloCoreMeasurementID
      ]);

      const [sameTagRows] = await connection.query<RowDataPacket[]>(
        'SELECT t1.TreeTag = t2.TreeTag AS SameTag FROM trees t1 JOIN trees t2 ON t2.TreeID = ? WHERE t1.TreeID = ?',
        [fixture.soloTreeID, fixture.treeID]
      );
      expect(
        Number(sameTagRows[0].SameTag),
        'the solo tree must now actually collate equal to the main tree tag (differing only by case) before the conflict is exercised'
      ).toBe(1);

      const matchedRows: BulkApplyMatchedRowInput[] = [
        {
          csvIndex: 0,
          coreMeasurementID: fixture.coreMeasurementIDs.cm1,
          csvRow: { spcode: SPECIES_CODE_TILIAA } as FileRow
        },
        {
          csvIndex: 1,
          coreMeasurementID: fixture.soloCoreMeasurementID,
          csvRow: { spcode: SPECIES_CODE_TILIAA } as FileRow
        }
      ];

      const blockingErrors = await expectBatchConflictWithoutWrites(matchedRows, [], GROUP_IDENTITY_OVERLAP_REASON);
      const flaggedRowIndexes = blockingErrors
        .flatMap(blockingError => blockingError.rowIndexes ?? [])
        .slice()
        .sort((a, b) => a - b);
      expect(
        flaggedRowIndexes,
        'both independently-submitted rows proposing the same prospective destination must be identified as conflicting, even though neither destination tag/species pair exists yet'
      ).toEqual([0, 1]);
    });

    const SECOND_GROUP_RACE_TEST_TIMEOUT_MS = 15000;

    it(
      'rejects an otherwise-valid batch when an independent second group is raced by a conflicting committed MeasuredDBH on its own locking re-read, leaving every other row untouched (#427, second-group race)',
      async () => {
        const ORDINARY_ROW_UPDATED_COMMENT = 'ordinary row updated comment (#427 second-group race)';
        const SOLO_GROUP_RACE_DBH = '27.5';
        const CONNECTION_B_SOLO_RACE_DBH = 37.25;
        const CONNECTION_B_SOLO_RACE_DBH_STORED = '37.250000';
        const SPECIES_CORRECTION_CONFLICT_CODE = 'species-correction-conflict';

        const unrelated = await seedUnrelatedBatchMeasurement(connection, fixture);

        const allSixCoreMeasurementIDs = [
          fixture.coreMeasurementIDs.cm1,
          fixture.coreMeasurementIDs.cm2,
          fixture.coreMeasurementIDs.cm3,
          fixture.coreMeasurementIDs.cm4,
          fixture.soloCoreMeasurementID,
          unrelated.coreMeasurementID
        ];
        await refreshMeasurementViewsForCoreMeasurements(cm, config.database, allSixCoreMeasurementIDs, undefined);

        const matchedRows: BulkApplyMatchedRowInput[] = [
          {
            csvIndex: 0,
            coreMeasurementID: unrelated.coreMeasurementID,
            csvRow: { comments: ORDINARY_ROW_UPDATED_COMMENT } as FileRow
          },
          {
            csvIndex: 1,
            coreMeasurementID: fixture.coreMeasurementIDs.cm1,
            csvRow: { spcode: SPECIES_CODE_QUERCO } as FileRow
          },
          {
            csvIndex: 2,
            coreMeasurementID: fixture.soloCoreMeasurementID,
            csvRow: { spcode: SPECIES_CODE_QUERCO, dbh: SOLO_GROUP_RACE_DBH } as FileRow
          }
        ];
        const requestInputWithoutHash: Omit<BulkApplyRequestInput, 'bulkPlanHash'> = {
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          matchedRows,
          newRows: [],
          confirmNewRows: false
        };
        const freshBulkPlanHash = await expectStaleBulkPlanHashRejectionAndReturnFreshPlanHash(connection, cm, requestInputWithoutHash);

        const stateBefore = await captureBatchDatabaseState(connection);
        sharedState.transactionalWrites = [];
        const soloRowBefore = stateBefore.coreMeasurements.find(row => Number(row.CoreMeasurementID) === fixture.soloCoreMeasurementID);
        expect(soloRowBefore, 'the solo fixture measurement must exist in the pre-POST baseline snapshot').toBeDefined();
        const soloBaselineMeasuredDBHStored = String(soloRowBefore!.MeasuredDBH);

        await withInterleavedConnectionB(async b => {
          let hookFireCount = 0;
          sharedState.postReadHook = {
            matches: matchesOrdinaryTargetMeasurementRead,
            run: async () => {
              hookFireCount += 1;
              await b.beginTransaction();
              await b.execute('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [
                CONNECTION_B_SOLO_RACE_DBH,
                fixture.soloCoreMeasurementID
              ]);
              await b.commit();
              const [bVerifyRows] = await b.execute<RowDataPacket[]>('SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?', [
                fixture.soloCoreMeasurementID
              ]);
              expect(String(bVerifyRows[0].MeasuredDBH), "connection B's own post-commit read must observe its own committed solo MeasuredDBH exactly").toBe(
                CONNECTION_B_SOLO_RACE_DBH_STORED
              );

              const [staleRows] = await connection.execute<RowDataPacket[]>('SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?', [
                fixture.soloCoreMeasurementID
              ]);
              expect(
                String(staleRows[0].MeasuredDBH),
                "connection A's existing REPEATABLE READ snapshot must still show the PRE-B solo MeasuredDBH here, proving that snapshot is stale before any group-locking re-read"
              ).toBe(soloBaselineMeasuredDBHStored);
            }
          };

          const response = await performRevisionApplyPost({ ...requestInputWithoutHash, bulkPlanHash: freshBulkPlanHash });

          expect(
            hookFireCount,
            'the post-read interleave hook must fire exactly once — a count of 0 means the second group was never actually exercised and every assertion below would pass vacuously'
          ).toBe(1);
          expect(response.status, 'a second group raced by a conflicting committed MeasuredDBH must be rejected, not applied').toBe(
            HTTPResponses.UNPROCESSABLE_ENTITY
          );
          const body = (await response.json()) as { error: string; code: string };
          expect(body.code, 'this must be a locked second-group write conflict, not an early plan-hash mismatch or an invalid-plan rejection').toBe(
            SPECIES_CORRECTION_CONFLICT_CODE
          );
          expect(sharedState.transactionalWrites, 'a rejected second-group race must not attempt any write of its own').toEqual([]);

          const stateAfter = await captureBatchDatabaseState(connection);
          const soloRowAfter = stateAfter.coreMeasurements.find(row => Number(row.CoreMeasurementID) === fixture.soloCoreMeasurementID);
          expect(soloRowAfter, 'the solo fixture measurement must still exist after the rejected batch').toBeDefined();
          expect(Number(soloRowAfter!.MeasuredDBH), "connection B's committed solo MeasuredDBH must survive connection A's rolled-back attempt").toBe(
            CONNECTION_B_SOLO_RACE_DBH
          );

          const expectedState: BatchDatabaseStateSnapshot = {
            ...stateBefore,
            coreMeasurements: stateBefore.coreMeasurements.map(row =>
              Number(row.CoreMeasurementID) === fixture.soloCoreMeasurementID ? { ...row, MeasuredDBH: soloRowAfter!.MeasuredDBH } : row
            )
          };
          expect(
            stateAfter,
            'every table/column/row must equal the pre-POST baseline EXCEPT the solo MeasuredDBH connection B committed — the ordinary row, the first group, all history/views, and the unfiltered ledger must remain exactly as they were'
          ).toEqual(expectedState);
        });
      },
      SECOND_GROUP_RACE_TEST_TIMEOUT_MS
    );
  });

  // =========================================================================
  // 1. Planner/preview structured outcomes via analyzeEdit (Stage 1 — complete today).
  // =========================================================================
  describe('preview: planSpeciesCorrection surfaced through analyzeEdit', () => {
    it('reports the full tree-wide correction summary for a multi-stem, multi-measurement tree', async () => {
      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );

      expect(plan.canApply).toBe(true);
      expect(plan.errors ?? []).toEqual([]);
      expect(plan.speciesCorrection).toBeDefined();
      const correction = plan.speciesCorrection!;

      expect(correction.targetTreeID).toBe(fixture.treeID);
      expect(correction.treeTag).toBe(TREE_TAG_SCT1);
      expect(correction.oldSpeciesCode).toBe(SPECIES_CODE_ACERRU);
      expect(correction.newSpeciesCode).toBe(SPECIES_CODE_QUERCO);
      expect(correction.oldSpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
      expect(correction.newSpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      expect(correction.activeStemCount).toBe(2);
      expect(correction.inactiveStemCount).toBe(1);
      expect(correction.activeMeasurementCount).toBe(3);
      expect(correction.inactiveMeasurementCount).toBe(1);

      const stemGUIDsSorted = [fixture.stemGUIDs.s1, fixture.stemGUIDs.s2, fixture.stemGUIDs.s3].sort((a, b) => a - b);
      expect(correction.stems.map(s => s.stemGUID)).toEqual(stemGUIDsSorted);
      expect(correction.stems.find(s => s.stemGUID === fixture.stemGUIDs.s3)!.isActive).toBe(false);

      const cmIDsSorted = Object.values(fixture.coreMeasurementIDs).sort((a, b) => a - b);
      expect(correction.measurements.map(m => m.coreMeasurementID)).toEqual(cmIDsSorted);

      // Exact prior RawSpCode preserved per member — including NULL and a differing spelling — for undo.
      const byID = new Map(correction.measurements.map(m => [m.coreMeasurementID, m]));
      expect(byID.get(fixture.coreMeasurementIDs.cm1)!.priorRawSpCode).toBe(SPECIES_CODE_ACERRU);
      expect(byID.get(fixture.coreMeasurementIDs.cm2)!.priorRawSpCode).toBeNull();
      expect(byID.get(fixture.coreMeasurementIDs.cm3)!.priorRawSpCode).toBe('acerru');
      expect(byID.get(fixture.coreMeasurementIDs.cm4)!.priorRawSpCode).toBe(SPECIES_CODE_ACERRU);
      expect(byID.get(fixture.coreMeasurementIDs.cm4)!.isActive).toBe(false);

      // The preview effect (R1a) surfaces the expanded sibling counts in its detail text.
      const effect = plan.effects.find(e => e.id === 'R1a');
      expect(effect).toBeDefined();
      expect(effect!.detail).toContain('3 stem(s) (2 active, 1 inactive)');
      expect(effect!.detail).toContain('4 measurement(s) (3 active, 1 inactive)');
      expect(effect!.references?.treeIDs).toEqual([fixture.treeID]);
      expect(effect!.references?.coreMeasurementIDs?.slice().sort((a, b) => a - b)).toEqual(cmIDsSorted);
    });

    it('reports a single-stem tree correctly (activeStemCount=1, no siblings), and applying it corrects exactly that tree/stem/measurement with no new rows', async () => {
      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.soloCoreMeasurementID,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(true);
      const correction = plan.speciesCorrection!;
      expect(correction.targetTreeID).toBe(fixture.soloTreeID);
      expect(correction.activeStemCount).toBe(1);
      expect(correction.inactiveStemCount).toBe(0);
      expect(correction.activeMeasurementCount).toBe(1);
      expect(correction.inactiveMeasurementCount).toBe(0);
      expect(correction.stems.map(s => s.stemGUID)).toEqual([fixture.soloStemGUID]);
      expect(correction.measurements.map(m => m.coreMeasurementID)).toEqual([fixture.soloCoreMeasurementID]);

      // --- Real-apply evidence: the preview above is not enough on its own —
      // prove the write actually produces exactly this outcome. -------------
      const treeCountBefore = await countRows(connection, 'trees');
      const stemCountBefore = await countRows(connection, 'stems');
      const cmBefore = await loadCoreMeasurement(connection, fixture.soloCoreMeasurementID);

      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.soloCoreMeasurementID,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      // No new tree/stem was allocated — the single stem's own tree row was
      // corrected in place, not re-linked to a freshly created one.
      expect(await countRows(connection, 'trees')).toBe(treeCountBefore);
      expect(await countRows(connection, 'stems')).toBe(stemCountBefore);

      // Identity/link/activity are exactly as before: same TreeID, same
      // StemGUID, same CM-to-stem link, both still active — only the tree's
      // SpeciesID and the measurement's RawSpCode actually changed.
      const treeAfter = await loadTree(connection, fixture.soloTreeID);
      expect(Number(treeAfter.TreeID)).toBe(fixture.soloTreeID);
      expect(Boolean(treeAfter.IsActive)).toBe(true);
      expect(Number(treeAfter.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      const stemAfter = await loadStem(connection, fixture.soloStemGUID);
      expect(Number(stemAfter.StemGUID)).toBe(fixture.soloStemGUID);
      expect(Number(stemAfter.TreeID)).toBe(fixture.soloTreeID);
      expect(Boolean(stemAfter.IsActive)).toBe(true);

      const cmAfter = await loadCoreMeasurement(connection, fixture.soloCoreMeasurementID);
      expect(Number(cmAfter.CoreMeasurementID)).toBe(fixture.soloCoreMeasurementID);
      expect(Number(cmAfter.StemGUID)).toBe(fixture.soloStemGUID);
      expect(Boolean(cmAfter.IsActive)).toBe(true);
      // Canonical code, not whatever casing the user happened to type.
      expect(cmAfter.RawSpCode).toBe(SPECIES_CODE_QUERCO);

      // Every other persisted field on the measurement is byte-identical to
      // before the correction — the omit list is exactly {RawSpCode,
      // IsValidated}, nothing else is allowed to move.
      expect(omitColumns(cmAfter, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cmBefore, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
    });

    it('treats the same TreeTag in a different census as an entirely distinct tree, and applying the correction in THIS census leaves that other census completely untouched', async () => {
      const otherCensus = await createAdditionalCensus(connection, testData, {
        plotCensusNumber: 2,
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });

      // Seeded with the OLD species (ACERRU), NOT the corrected one — if the
      // writer's WHERE clause ever broadened past this exact
      // (TreeTag, CensusID) pair, this row would get silently "corrected"
      // too, which seeding it already-QUERCO would mask completely.
      const [otherTreeRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
        TREE_TAG_SCT1,
        fixture.speciesIDs[SPECIES_CODE_ACERRU],
        otherCensus.censusID
      ]);
      const otherCensusTreeID = otherTreeRes.insertId;

      // One real stem + measurement attached to that other-census tree, in
      // the SAME plot (quadrats carries no CensusID of its own, so a quadrat
      // already belonging to this plot is a perfectly valid, existing FK
      // target for a stem in ANY census of that plot).
      const [otherQuadratRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
         VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
        [fixture.plotID, OTHER_CENSUS_QUADRAT_NAME]
      );
      const otherQuadratID = otherQuadratRes.insertId;
      const [otherStemRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [otherCensusTreeID, otherQuadratID, otherCensus.censusID, OTHER_CENSUS_STEM_TAG, STEM_X, STEM_Y]
      );
      const otherStemGUID = otherStemRes.insertId;
      const [otherCmRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          otherStemGUID,
          otherCensus.censusID,
          DBH_CM1,
          HOM_DEFAULT,
          OTHER_CENSUS_MEASUREMENT_DATE,
          TREE_TAG_SCT1,
          OTHER_CENSUS_STEM_TAG,
          SPECIES_CODE_ACERRU,
          OTHER_CENSUS_QUADRAT_NAME,
          STEM_X,
          STEM_Y,
          ATTR_CODE_ALIVE,
          null,
          null
        ]
      );
      const otherCmID = otherCmRes.insertId;

      // Whole-row "before" snapshots, captured prior to touching the
      // original census at all.
      const otherTreeBefore = await loadTree(connection, otherCensusTreeID);
      const otherStemBefore = await loadStem(connection, otherStemGUID);
      const otherCmBefore = await loadCoreMeasurement(connection, otherCmID);

      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );

      expect(plan.canApply).toBe(true);
      // The correction targets THIS census's tree row, a different TreeID than
      // the same-tag tree living in the other census.
      expect(plan.speciesCorrection!.targetTreeID).toBe(fixture.treeID);
      expect(plan.speciesCorrection!.targetTreeID).not.toBe(otherCensusTreeID);
      expect(plan.speciesCorrection!.censusID).toBe(fixture.censusID);

      // The other census's same-tag tree is untouched by merely previewing this edit.
      expect(await loadTree(connection, otherCensusTreeID)).toEqual(otherTreeBefore);

      // --- Real-apply evidence: correct THIS census's tree, then prove the
      // other census's rows never moved at all. ------------------------------
      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      // The original census's tree is corrected.
      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      // The other census's same-tag tree/stem/measurement are byte-identical
      // to their pre-apply snapshots — species, raw fields, IDs, and activity
      // all unchanged. A correction scoped to (TreeTag, CensusID) must never
      // leak across a census boundary merely because the tag matches.
      expect(await loadTree(connection, otherCensusTreeID)).toEqual(otherTreeBefore);
      expect(await loadStem(connection, otherStemGUID)).toEqual(otherStemBefore);
      expect(await loadCoreMeasurement(connection, otherCmID)).toEqual(otherCmBefore);

      const otherTreeAfter = await loadTree(connection, otherCensusTreeID);
      expect(Number(otherTreeAfter.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
      expect(Boolean(otherTreeAfter.IsActive)).toBe(true);
      const otherCmAfter = await loadCoreMeasurement(connection, otherCmID);
      expect(otherCmAfter.RawSpCode).toBe(SPECIES_CODE_ACERRU);
      expect(Number(otherCmAfter.StemGUID)).toBe(otherStemGUID);
      expect(Boolean(otherCmAfter.IsActive)).toBe(true);
    });

    it('is a no-op (no speciesCorrection, no effects, no allocation) for a case-only spelling match, and applying it changes nothing', async () => {
      const lowerCaseCode = SPECIES_CODE_ACERRU.toLowerCase();
      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: lowerCaseCode },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(true);
      expect(plan.speciesCorrection).toBeUndefined();
      expect(plan.effects.find(e => e.id === 'R1a')).toBeUndefined();

      // Species identity is stable (no new/duplicate species row allocated
      // for the differently-cased spelling): resolveSpeciesByCode matches
      // case-insensitively, so this resolves to the SAME SpeciesID.
      const speciesCountBefore = await countRows(connection, 'species');
      const treeCountBefore = await countRows(connection, 'trees');
      const stemCountBefore = await countRows(connection, 'stems');

      // APPLY identity stability: actually applying the case-only edit must
      // not correct/re-link anything. TreeID/StemGUIDs/CoreMeasurementID stay
      // exactly as they were, and the tree's SpeciesID is untouched.
      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: lowerCaseCode },
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      expect(await countRows(connection, 'species')).toBe(speciesCountBefore);
      expect(await countRows(connection, 'trees')).toBe(treeCountBefore);
      expect(await countRows(connection, 'stems')).toBe(stemCountBefore);

      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);

      const cm1 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      expect(Number(cm1.CoreMeasurementID)).toBe(fixture.coreMeasurementIDs.cm1);
      expect(Number(cm1.StemGUID)).toBe(fixture.stemGUIDs.s1);
    });

    it('throws SpeciesNotFoundError for an unknown species code', async () => {
      await expect(
        analyzeEdit(
          cm,
          config.database,
          'measurementssummary',
          fixture.plotID,
          fixture.censusID,
          fixture.coreMeasurementIDs.cm1,
          { SpeciesCode: SPECIES_CODE_UNKNOWN },
          undefined,
          { role: ADMIN_ROLE }
        )
      ).rejects.toBeInstanceOf(SpeciesNotFoundError);
    });

    // resolveSpeciesByCode (frontend/config/editplan/resolvers.ts) filters
    // `IsActive = 1` unconditionally. applySpeciesRules calls it FIRST, before
    // planSpeciesCorrection ever runs, so a destination species that is
    // already inactive when the preview is requested takes the exact same
    // path as an unknown code: SpeciesNotFoundError, mapped to 422 by
    // app/api/edits/{preview,apply}/route.ts. planSpeciesCorrection's own
    // 'destination_species_inactive' outcome is reachable only for a narrower
    // TOCTOU race (species deactivated AFTER this resolve, DURING the same
    // planning call) — not exercised by this test, which deactivates before
    // calling analyzeEdit at all. This is the existing, already-reviewed API
    // contract; this correction only fixes a wrong expectation about which
    // branch handles the "inactive before preview" case, not the contract
    // itself.
    it('throws SpeciesNotFoundError (existing API) when the destination species is already inactive before preview, identically to an unknown code', async () => {
      await connection.query('UPDATE species SET IsActive = 0 WHERE SpeciesCode = ?', [SPECIES_CODE_QUERCO]);
      try {
        await expect(
          analyzeEdit(
            cm,
            config.database,
            'measurementssummary',
            fixture.plotID,
            fixture.censusID,
            fixture.coreMeasurementIDs.cm1,
            { SpeciesCode: SPECIES_CODE_QUERCO },
            undefined,
            { role: ADMIN_ROLE }
          )
        ).rejects.toBeInstanceOf(SpeciesNotFoundError);

        // No partial state: the source tree is untouched by the rejected preview.
        const treeRow = await loadTree(connection, fixture.treeID);
        expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
      } finally {
        await connection.query('UPDATE species SET IsActive = 1 WHERE SpeciesCode = ?', [SPECIES_CODE_QUERCO]);
      }
    });

    it('blocks with a structured tree/missing error when the measurement is not linked to an active tree', async () => {
      await connection.query('UPDATE trees SET IsActive = 0 WHERE TreeID = ?', [fixture.treeID]);
      try {
        // With the source tree inactive, loadCurrentRow's own
        // `cm.IsActive = 1 AND cm.StemGUID IS NOT NULL` filter still finds the
        // row (that filter is on the measurement, not the tree), so analyzeEdit
        // succeeds through to the species rule, which then reports the
        // source_inactive planner outcome.
        const plan = await analyzeEdit(
          cm,
          config.database,
          'measurementssummary',
          fixture.plotID,
          fixture.censusID,
          fixture.coreMeasurementIDs.cm1,
          { SpeciesCode: SPECIES_CODE_QUERCO },
          undefined,
          { role: ADMIN_ROLE }
        );
        expect(plan.canApply).toBe(false);
        const error = plan.errors!.find(e => e.kind === 'TreeStemResolution') as any;
        expect(error.subject).toBe('tree');
        expect(error.reason).toBe('inactive');
      } finally {
        await connection.query('UPDATE trees SET IsActive = 1 WHERE TreeID = ?', [fixture.treeID]);
      }
    });

    it('blocks with destination_exists (active) and never attaches a speciesCorrection when the destination tree already exists and is active', async () => {
      const [collideRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
        TREE_TAG_SCT1,
        fixture.speciesIDs[SPECIES_CODE_QUERCO],
        fixture.censusID
      ]);
      const collideTreeID = collideRes.insertId;

      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(false);
      expect(plan.speciesCorrection).toBeUndefined();
      const error = plan.errors!.find(e => e.kind === 'TreeStemResolution') as any;
      expect(error.subject).toBe('species');
      expect(error.reason).toBe('destination_exists');

      // No auto-merge: the colliding tree's own species is untouched by the preview.
      const collideRow = await loadTree(connection, collideTreeID);
      expect(Number(collideRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);
    });

    it('blocks with destination_exists even when the colliding tree is inactive (no auto-merge into inactive membership)', async () => {
      await connection.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 0)`, [
        TREE_TAG_SCT1,
        fixture.speciesIDs[SPECIES_CODE_QUERCO],
        fixture.censusID
      ]);

      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(false);
      const error = plan.errors!.find(e => e.kind === 'TreeStemResolution') as any;
      expect(error.reason).toBe('destination_exists');
    });

    it('blocks with mixed_identity and attaches no speciesCorrection when SpeciesCode and TreeTag change in the same edit', async () => {
      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO, TreeTag: 'SCNEW' },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(false);
      expect(plan.speciesCorrection).toBeUndefined();
      expect(plan.effects.find(e => e.id === 'R1a')).toBeUndefined();
      const error = plan.errors!.find(e => e.kind === 'TreeStemResolution') as any;
      expect(error.reason).toBe('mixed_identity');
      expect(error.message).toContain('TreeTag');
    });

    it('allows a species correction to coexist with DBH/coordinate/comment/attribute changes on the same row, writing each accompanying field sparsely and leaving everything else — including the shared stem and every sibling — untouched', async () => {
      // CM1's RawCodes is already 'A' (seedSpeciesCorrectionFixture) but no
      // actual cmattributes association row exists yet for it — seed one so
      // the Attributes edit below has a real association to rebuild, not an
      // empty set.
      await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [fixture.coreMeasurementIDs.cm1, ATTR_CODE_ALIVE]);

      const cm1Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      const s1Before = await loadStem(connection, fixture.stemGUIDs.s1);
      const s2Before = await loadStem(connection, fixture.stemGUIDs.s2);
      const s3Before = await loadStem(connection, fixture.stemGUIDs.s3);

      const newRow = {
        SpeciesCode: SPECIES_CODE_QUERCO,
        MeasuredDBH: ACCOMPANYING_DBH_VALUE,
        Description: ACCOMPANYING_DESCRIPTION_VALUE,
        StemLocalX: ACCOMPANYING_LOCAL_X,
        StemPlotX: ACCOMPANYING_PLOT_X,
        Attributes: ACCOMPANYING_ATTR_CODE
      };

      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        newRow,
        undefined,
        {
          role: ADMIN_ROLE
        }
      );
      expect(plan.canApply).toBe(true);
      expect(plan.speciesCorrection).toBeDefined();
      expect(plan.fieldChanges.some(fc => fc.field === 'MeasuredDBH' && fc.to === ACCOMPANYING_DBH_VALUE)).toBe(true);
      expect(plan.fieldChanges.some(fc => fc.field === 'Description' && fc.to === ACCOMPANYING_DESCRIPTION_VALUE)).toBe(true);
      expect(plan.fieldChanges.some(fc => fc.field === 'StemLocalX' && fc.to === ACCOMPANYING_LOCAL_X)).toBe(true);
      expect(plan.fieldChanges.some(fc => fc.field === 'StemPlotX' && fc.to === ACCOMPANYING_PLOT_X)).toBe(true);
      expect(plan.fieldChanges.some(fc => fc.field === 'Attributes' && fc.to === ACCOMPANYING_ATTR_CODE)).toBe(true);

      // --- Real-apply evidence. ----------------------------------------------
      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow,
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);

      // Every accompanying field lands exactly on the target — DBH,
      // Description (and its self-referential RawComments mirror), the ONE
      // edited raw axis (RawX, not RawY), the ONE edited raw plot axis
      // (RawPlotX, not RawPlotY), and RawCodes carrying the new attribute
      // string verbatim.
      expect(Number(cm1After.MeasuredDBH)).toBeCloseTo(ACCOMPANYING_DBH_VALUE, 6);
      expect(cm1After.Description).toBe(ACCOMPANYING_DESCRIPTION_VALUE);
      expect(cm1After.RawComments).toBe(ACCOMPANYING_DESCRIPTION_VALUE);
      expect(Number(cm1After.RawX)).toBeCloseTo(ACCOMPANYING_LOCAL_X, 6);
      expect(Number(cm1After.RawPlotX)).toBeCloseTo(ACCOMPANYING_PLOT_X, 6);
      expect(cm1After.RawCodes).toBe(ACCOMPANYING_ATTR_CODE);
      expect(cm1After.RawSpCode).toBe(SPECIES_CODE_QUERCO);

      // Unedited fields on the SAME row are untouched: the other raw axis,
      // HOM, measurement date, identity/link, and activity.
      expect(Number(cm1After.RawY)).toBeCloseTo(STEM_Y, 6);
      expect(cm1After.RawPlotY).toBeNull();
      expect(Number(cm1After.MeasuredHOM)).toBeCloseTo(HOM_DEFAULT, 6);
      expect(Number(cm1After.StemGUID)).toBe(fixture.stemGUIDs.s1);
      expect(Boolean(cm1After.IsActive)).toBe(true);

      // Whole-row check: nothing OTHER than the fields just asserted above
      // (plus the always-allowed RawSpCode/IsValidated) moved at all.
      const CM1_ACCOMPANYING_EDIT_OMIT_COLUMNS = [
        ...COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS,
        'MeasuredDBH',
        'Description',
        'RawComments',
        'RawCodes',
        'RawX',
        'RawPlotX'
      ];
      expect(omitColumns(cm1After, CM1_ACCOMPANYING_EDIT_OMIT_COLUMNS)).toEqual(omitColumns(cm1Before, CM1_ACCOMPANYING_EDIT_OMIT_COLUMNS));

      // The cmattributes association is rebuilt (DELETE + re-INSERT, so the
      // CMAID itself is expected to change) — assert on the surviving Code,
      // never on the now-irrelevant old CMAID.
      const [attrRows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ?', [fixture.coreMeasurementIDs.cm1]);
      expect(attrRows.map(r => r.Code)).toEqual([ACCOMPANYING_ATTR_CODE]);

      // The shared stem (S1, also carrying CM2) has ONLY its edited axes
      // moved — LocalY/PlotY, TreeID, activity all untouched.
      const s1After = await loadStem(connection, fixture.stemGUIDs.s1);
      expect(Number(s1After.LocalX)).toBeCloseTo(ACCOMPANYING_LOCAL_X, 6);
      expect(Number(s1After.PlotX)).toBeCloseTo(ACCOMPANYING_PLOT_X, 6);
      expect(omitColumns(s1After, ['LocalX', 'PlotX'])).toEqual(omitColumns(s1Before, ['LocalX', 'PlotX']));

      // Other stems on this tree (S2 inactive-adjacent S3, and S2 itself) are
      // entirely untouched — the coordinate edit never leaks past the one
      // stem CM1 actually lives on.
      expect(await loadStem(connection, fixture.stemGUIDs.s2)).toEqual(s2Before);
      expect(await loadStem(connection, fixture.stemGUIDs.s3)).toEqual(s3Before);

      // CM2 shares S1's now-moved geometry through the join, but CM2's OWN
      // stored row — including its own RawX snapshot — is untouched: the
      // per-field sparse sync only ever writes the EDITED row.
      const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      expect(omitColumns(cm2After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm2Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(cm2After.RawSpCode).toBe(SPECIES_CODE_QUERCO);

      // CM3 (on S2) and CM4 (inactive, on S3) are likewise untouched except
      // for the canonical species projection every member gets.
      const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      expect(omitColumns(cm3After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm3Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(cm3After.RawSpCode).toBe(SPECIES_CODE_QUERCO);

      const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      expect(omitColumns(cm4After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm4Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(cm4After.RawSpCode).toBe(SPECIES_CODE_QUERCO);
    });

    it('never produces a speciesCorrection for failedmeasurements rows (unlinked rows keep their existing resolution path)', async () => {
      const [failedRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
        [fixture.censusID, DBH_CM1, HOM_DEFAULT, MEASUREMENT_DATE, 'UNLINKEDTAG', 'US1', SPECIES_CODE_ACERRU, QUADRAT_NAME_A, STEM_X, STEM_Y, null, null, null]
      );
      const failedCoreMeasurementID = failedRes.insertId;

      const plan = await analyzeEdit(
        cm,
        config.database,
        'failedmeasurements',
        fixture.plotID,
        fixture.censusID,
        failedCoreMeasurementID,
        { SpCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.speciesCorrection).toBeUndefined();
      expect(plan.effects.find(e => e.id === 'R1a')).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Plan-hash drift from species-correction membership (Stage 1 — complete today).
  // =========================================================================
  describe('plan-hash drift when tree membership changes between preview and apply', () => {
    it('changes the hash when a new active stem is added to the tree, causing applyEdit to throw HashDriftError on a stale hash', async () => {
      const preview = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      const staleHash = preview.planHash;

      // Out-of-band: a new active stem (with a measurement) is added to the tree.
      const [newStemRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [fixture.treeID, fixture.quadratIDs[QUADRAT_NAME_A], fixture.censusID, 'SSNEW', STEM_X + 5, STEM_Y + 5]
      );
      await connection.query<ResultSetHeader>(
        `INSERT INTO coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          newStemRes.insertId,
          fixture.censusID,
          DBH_CM1,
          HOM_DEFAULT,
          MEASUREMENT_DATE,
          TREE_TAG_SCT1,
          'SSNEW',
          SPECIES_CODE_ACERRU,
          QUADRAT_NAME_A,
          STEM_X + 5,
          STEM_Y + 5,
          null,
          null,
          null
        ]
      );

      await expect(
        applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: staleHash,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        })
      ).rejects.toBeInstanceOf(HashDriftError);

      // No partial write: the source tree's species is unchanged.
      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
    });

    it('changes the hash on an equal-count activity swap between two siblings (stem count unchanged, membership state changed)', async () => {
      const preview = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      const staleHash = preview.planHash;
      expect(preview.speciesCorrection!.activeStemCount).toBe(2);
      expect(preview.speciesCorrection!.inactiveStemCount).toBe(1);

      // Swap activity: S2 (previously active) becomes inactive, S3 (previously
      // inactive) becomes active. activeStemCount/inactiveStemCount stay 2/1 —
      // only the per-member hash (which hashes full records, not just counts)
      // can detect this.
      await connection.query('UPDATE stems SET IsActive = 0 WHERE StemGUID = ?', [fixture.stemGUIDs.s2]);
      await connection.query('UPDATE stems SET IsActive = 1 WHERE StemGUID = ?', [fixture.stemGUIDs.s3]);

      const replan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(replan.speciesCorrection!.activeStemCount).toBe(2);
      expect(replan.speciesCorrection!.inactiveStemCount).toBe(1);
      expect(replan.planHash).not.toBe(staleHash);

      await expect(
        applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: staleHash,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        })
      ).rejects.toBeInstanceOf(HashDriftError);
    });
  });

  // =========================================================================
  // 3. Pre-write destination-collision race (Stage 1 — complete today).
  //
  // applyEditInTransaction calls assertEditPlanCanApply(freshPlan) BEFORE the
  // expectedPlanHash comparison (frontend/config/editplan/apply.ts:111-119),
  // so a destination that appears between preview and apply surfaces as
  // EditPlanUnapplicableError, not HashDriftError, even though the hash would
  // also differ.
  // =========================================================================
  describe('pre-write destination-collision race', () => {
    it('throws EditPlanUnapplicableError (not HashDriftError) and makes no writes when a colliding tree appears after preview', async () => {
      const preview = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        { SpeciesCode: SPECIES_CODE_QUERCO },
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(preview.canApply).toBe(true);
      const previewHash = preview.planHash;

      await connection.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
        TREE_TAG_SCT1,
        fixture.speciesIDs[SPECIES_CODE_QUERCO],
        fixture.censusID
      ]);

      const treeCountBefore = await countRows(connection, 'trees');
      const stemCountBefore = await countRows(connection, 'stems');
      const cmCountBefore = await countRows(connection, 'coremeasurements');

      await expect(
        applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: previewHash,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        })
      ).rejects.toBeInstanceOf(EditPlanUnapplicableError);

      expect(await countRows(connection, 'trees')).toBe(treeCountBefore);
      expect(await countRows(connection, 'stems')).toBe(stemCountBefore);
      expect(await countRows(connection, 'coremeasurements')).toBe(cmCountBefore);

      const sourceTreeRow = await loadTree(connection, fixture.treeID);
      expect(Number(sourceTreeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
    });
  });

  // =========================================================================
  // 4. Tree-wide write behavior: applyEdit on a species-only change must
  //    correct the EXISTING tree's SpeciesID in place — preserving TreeID,
  //    every StemGUID, and every measurement-to-stem link — and project the
  //    corrected species onto every member's RawSpCode (active and
  //    inactive), while leaving unrelated sibling fields, validation-error
  //    history, and the taxonomy rows themselves untouched. Also covers
  //    exact undo via revertEdit and rollback-on-failure.
  // =========================================================================
  describe('tree-wide write behavior', () => {
    it('corrects the tree SpeciesID in place: stable TreeID/StemGUIDs, no new tree/stem rows, every sibling measurement shows the corrected species, unrelated sibling fields preserved', async () => {
      const treeCountBefore = await countRows(connection, 'trees');
      const stemCountBefore = await countRows(connection, 'stems');

      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      // No new tree or stem rows — this is a correction of the existing tree,
      // not a re-link to a new/different tree or stem.
      expect(await countRows(connection, 'trees')).toBe(treeCountBefore);
      expect(await countRows(connection, 'stems')).toBe(stemCountBefore);

      // The tree's own SpeciesID moved to the corrected species.
      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      // Every sibling measurement's CoreMeasurementID and StemGUID are unchanged
      // (identity preserved) and its RawSpCode now reflects the corrected code —
      // including the one that started NULL and the one that started differently-cased.
      const cm1 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);

      expect(Number(cm1.StemGUID)).toBe(fixture.stemGUIDs.s1);
      expect(Number(cm2.StemGUID)).toBe(fixture.stemGUIDs.s1);
      expect(Number(cm3.StemGUID)).toBe(fixture.stemGUIDs.s2);
      expect(Number(cm4.StemGUID)).toBe(fixture.stemGUIDs.s3);

      expect(cm1.RawSpCode).toBe(SPECIES_CODE_QUERCO);
      expect(cm2.RawSpCode).toBe(SPECIES_CODE_QUERCO);
      expect(cm3.RawSpCode).toBe(SPECIES_CODE_QUERCO);
      expect(cm4.RawSpCode).toBe(SPECIES_CODE_QUERCO); // inactive measurement still corrected

      // Unrelated sibling fields (DBH, Description) on CM3 are preserved exactly.
      expect(Number(cm3.MeasuredDBH)).toBeCloseTo(DBH_CM3, 2);
      expect(cm3.Description).toBe(DESCRIPTION_CM3);

      // Exact unrelated raw-field preservation (F11): a species-only
      // correction must not rewrite CM3's own identity/position raw columns
      // with read-model fallback values, and must not touch CM2's HOM/date —
      // only RawSpCode may have changed on either row.
      expect(cm3.RawTreeTag).toBe(TREE_TAG_SCT1);
      expect(cm3.RawStemTag).toBe(STEM_TAG_S2);
      expect(cm3.RawQuadrat).toBe(QUADRAT_NAME_A);
      expect(Number(cm3.RawX)).toBeCloseTo(STEM_X + 1, 6);
      expect(Number(cm3.RawY)).toBeCloseTo(STEM_Y + 1, 6);
      expect(Number(cm2.MeasuredDBH)).toBeCloseTo(DBH_CM2, 2);
      expect(Number(cm2.MeasuredHOM)).toBeCloseTo(HOM_DEFAULT, 2);

      // Taxonomy row itself is untouched — no new species, no SpeciesName mutation.
      const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID, SpeciesCode, SpeciesName FROM species WHERE SpeciesCode = ?', [
        SPECIES_CODE_QUERCO
      ]);
      expect(speciesRows).toHaveLength(1);
      expect(speciesRows[0].SpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);
    });

    it("preserves the edited row's own Raw* identity/position snapshot exactly when it started NULL (no fabrication from the canonical join) while correcting its RawSpCode to the canonical code, and leaves every sibling's raw columns completely untouched", async () => {
      // A measurement whose Raw* identity/position snapshot was never
      // captured (all NULL) — e.g. an older or directly-inserted row — is
      // still a full member of the tree and must be correctable. A
      // species-only correction edits exactly one field (SpeciesCode) on
      // this submit, so the row's unrelated Raw* identity/position columns
      // must come out of the correction byte-identical to how they went
      // in — including when they started NULL. The row's own stem/tree DO
      // resolve to real, non-NULL canonical values (TREE_TAG_SCT1 /
      // STEM_TAG_S1 / QUADRAT_NAME_A / STEM_X / STEM_Y — shared with the
      // siblings on fixture.stemGUIDs.s1, asserted below), so a writer that
      // re-stamped Raw* from that join on every species edit WOULD produce
      // non-NULL values here; this test proves it does not. RawCodes/
      // RawComments stay NULL for the same "unrelated field, not edited"
      // reason.
      const [cm5Res] = await connection.query<ResultSetHeader>(
        `INSERT INTO coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, Description, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)`,
        [fixture.stemGUIDs.s1, fixture.censusID, RAW_NULL_TARGET_DBH, HOM_DEFAULT, MEASUREMENT_DATE, SPECIES_CODE_ACERRU]
      );
      const cm5ID = cm5Res.insertId;

      const cm5Before = await loadCoreMeasurement(connection, cm5ID);
      expect(cm5Before.RawTreeTag).toBeNull();
      expect(cm5Before.RawStemTag).toBeNull();
      expect(cm5Before.RawQuadrat).toBeNull();
      expect(cm5Before.RawX).toBeNull();
      expect(cm5Before.RawY).toBeNull();
      expect(cm5Before.RawCodes).toBeNull();
      expect(cm5Before.RawComments).toBeNull();
      expect(cm5Before.RawSpCode).toBe(SPECIES_CODE_ACERRU);

      const siblingIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];
      const siblingsBefore = new Map(await Promise.all(siblingIDs.map(async id => [id, await loadCoreMeasurement(connection, id)] as const)));
      const acerruBefore = await loadSpeciesRow(connection, SPECIES_CODE_ACERRU);
      const quercoBefore = await loadSpeciesRow(connection, SPECIES_CODE_QUERCO);

      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: cm5ID,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      const cm5After = await loadCoreMeasurement(connection, cm5ID);

      // Whole-row comparison against the SAME omit list used for siblings
      // below (RawSpCode, IsValidated — the only two columns a species-only
      // correction is ever allowed to touch on ANY attached row): the target
      // row gets no weaker guarantee than a sibling does.
      expect(omitColumns(cm5After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm5Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );

      // Named NULLs survive exactly — not fabricated from the canonical join,
      // despite that join existing and resolving to real, non-NULL values.
      expect(cm5After.RawTreeTag).toBeNull();
      expect(cm5After.RawStemTag).toBeNull();
      expect(cm5After.RawQuadrat).toBeNull();
      expect(cm5After.RawX).toBeNull();
      expect(cm5After.RawY).toBeNull();
      expect(cm5After.RawCodes).toBeNull();
      expect(cm5After.RawComments).toBeNull();

      // The one field this correction IS supposed to change on the target.
      expect(cm5After.RawSpCode).toBe(SPECIES_CODE_QUERCO);

      // Every sibling (not the edited row) is byte-identical except the two
      // columns the tree-wide correction is intended to touch on every member.
      for (const id of siblingIDs) {
        const after = await loadCoreMeasurement(connection, id);
        expect(omitColumns(after, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
          omitColumns(siblingsBefore.get(id)!, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
        );
      }

      // Taxonomy rows themselves are byte-identical — no mutation of either species row.
      expect(await loadSpeciesRow(connection, SPECIES_CODE_ACERRU)).toEqual(acerruBefore);
      expect(await loadSpeciesRow(connection, SPECIES_CODE_QUERCO)).toEqual(quercoBefore);

      // Derived read-model rows for every member reflect the corrected
      // species while keeping CoreMeasurementID/StemGUID/TreeID stable.
      const allMemberIDs = [cm5ID, ...siblingIDs];
      const summaryRows = await loadMeasurementsSummaryRows(connection, allMemberIDs);
      const fullTableRows = await loadViewFullTableRows(connection, allMemberIDs);
      expect(summaryRows).toHaveLength(allMemberIDs.length);
      expect(fullTableRows).toHaveLength(allMemberIDs.length);
      for (const row of [...summaryRows, ...fullTableRows]) {
        expect(row.SpeciesCode).toBe(SPECIES_CODE_QUERCO);
        expect(Number(row.TreeID)).toBe(fixture.treeID);
      }
    });

    it('tolerates MySQL rounding a 9-decimal StemPlotX request to its stored 6-decimal precision: applyEdit still succeeds, the recorded domainDiff/metadata agree with the LIVE rounded DB value (never the raw 9-decimal request), and revertEdit exactly undoes it via the real drift-then-confirm handshake — the failed unconfirmed attempt mutating nothing, the confirmed retry restoring the original NULL PlotX/PlotY and linking the ledger rows', async () => {
      // Real pre-apply state, read from the DB rather than assumed — the
      // fixture's own INSERTs (seedSpeciesCorrectionFixture) never set
      // RawPlotX/PlotX, so both start NULL; every domainDiff/"before"
      // assertion below compares against THESE captured values, never a
      // hardcoded null literal.
      const cm1Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      const s1Before = await loadStem(connection, fixture.stemGUIDs.s1);
      const s2Before = await loadStem(connection, fixture.stemGUIDs.s2);
      const s3Before = await loadStem(connection, fixture.stemGUIDs.s3);
      const preApplyRawPlotX = cm1Before.RawPlotX;
      const preApplyStemPlotX = s1Before.PlotX;
      expect(preApplyRawPlotX, 'fixture precondition for this regression: cm1.RawPlotX must start NULL, read from the DB rather than assumed').toBeNull();
      expect(preApplyStemPlotX, "fixture precondition for this regression: the shared stem's PlotX must start NULL for the same reason").toBeNull();

      const newRow = { SpeciesCode: SPECIES_CODE_QUERCO, StemPlotX: PRECISION_REQUESTED_PLOT_X };

      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm1,
        newRow,
        undefined,
        {
          role: ADMIN_ROLE
        }
      );
      expect(
        plan.speciesCorrection,
        'a SpeciesCode change on a row already linked to an active tree must still surface a speciesCorrection even with an accompanying StemPlotX edit'
      ).toBeDefined();
      expect(
        plan.fieldChanges.some(fc => fc.field === 'StemPlotX' && fc.to === PRECISION_REQUESTED_PLOT_X),
        "the 9-decimal StemPlotX request must register verbatim as a field change — rounding is MySQL's job at storage time, never the planner's"
      ).toBe(true);
      expect(plan.planHash, "a plan carrying a speciesCorrection must still produce a stable planHash for applyEdit's own drift check").toBeTruthy();

      // --- Real-apply evidence: this MUST succeed, with no try/catch. A
      // writer that mistook MySQL's inevitable 9-decimal -> 6-decimal
      // rounding for concurrent drift would wrongly throw
      // SpeciesCorrectionWriteConflictError or HashDriftError here; this
      // call is the regression guard against exactly that. -------------------
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow,
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const s1After = await loadStem(connection, fixture.stemGUIDs.s1);

      // --- Prove MySQL actually rounded: exact 6-scale rounding of the
      // 9-decimal request, and explicitly NOT the request verbatim — the
      // one assertion that stops this test from passing vacuously on a
      // column that never truncated anything. mysql2 returns DECIMAL
      // columns as strings; compare with exact string equality, never
      // toBeCloseTo, since approximate matching is exactly what this test
      // must NOT tolerate. -----------------------------------------------
      expect(
        String(cm1After.RawPlotX),
        'coremeasurements.RawPlotX is DECIMAL(12,6) — the stored value must be the exact 6-decimal rounding of the 9-decimal request'
      ).toBe(PRECISION_STORED_PLOT_X);
      expect(String(s1After.PlotX), "the shared stem's PlotX is also DECIMAL(12,6) and must round identically to the coremeasurements mirror").toBe(
        PRECISION_STORED_PLOT_X
      );
      expect(String(cm1After.RawPlotX), 'the stored value must not equal the 9-decimal request verbatim — MySQL must have actually rounded it').not.toBe(
        String(PRECISION_REQUESTED_PLOT_X)
      );

      // Only the X axis was edited: Y stays exactly as it started on both
      // the coremeasurements row and the shared stem.
      expect(cm1After.RawPlotY, 'RawPlotY was never part of this edit and must stay exactly as it started').toBeNull();
      expect(s1After.PlotY, "the shared stem's PlotY must likewise stay untouched by an X-only edit").toBeNull();

      // The species correction itself landed.
      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      // --- The recorded metadata agrees with what is ACTUALLY STORED, never
      // with the JS request. ----------------------------------------------
      const editOperationRows = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
      expect(editOperationRows, 'exactly one ledger row must be recorded for this single applyEdit call on cm1').toHaveLength(1);

      const beforeState = parseEditOperationStateColumn(editOperationRows[0].BeforeState);
      const afterState = parseEditOperationStateColumn(editOperationRows[0].AfterState);

      const metadataBeforeRow = findSpeciesCorrectionMetadataStateRow(beforeState);
      const metadataAfterRow = findSpeciesCorrectionMetadataStateRow(afterState);
      expect(metadataBeforeRow, 'a species correction must always embed its species_correction_metadata marker row on BeforeState').not.toBeNull();
      expect(metadataAfterRow, 'a species correction must always embed its species_correction_metadata marker row on AfterState').not.toBeNull();

      const metadataBefore = metadataBeforeRow!.row as unknown as SpeciesCorrectionMetadata;
      const metadataAfter = metadataAfterRow!.row as unknown as SpeciesCorrectionMetadata;

      expect(metadataBefore.domainDiff, 'the writer builds domainDiff once and records it symmetrically on both marker rows').toBeDefined();
      expect(metadataAfter.domainDiff).toBeDefined();
      expect(metadataBefore.domainDiff, 'domainDiff must be deep-equal between the before- and after-state marker rows').toEqual(metadataAfter.domainDiff);

      expect(
        metadataAfter.domainDiff.coremeasurements.RawPlotX?.after,
        'the recorded "after" must equal the LIVE stored DB value, never the raw 9-decimal request the writer was asked to apply'
      ).toBe(String(cm1After.RawPlotX));
      expect(metadataAfter.domainDiff.coremeasurements.RawPlotX?.after).toBe(PRECISION_STORED_PLOT_X);
      expect(metadataAfter.domainDiff.stems.PlotX?.after, 'the recorded stem "after" must likewise equal the LIVE stored DB value').toBe(String(s1After.PlotX));
      expect(metadataAfter.domainDiff.stems.PlotX?.after).toBe(PRECISION_STORED_PLOT_X);

      expect(
        metadataBefore.domainDiff.coremeasurements.RawPlotX?.before,
        'the recorded "before" must equal the captured pre-apply DB value, never a fabricated or assumed default'
      ).toBe(preApplyRawPlotX);
      expect(metadataBefore.domainDiff.stems.PlotX?.before, 'the recorded stem "before" must likewise equal the captured pre-apply DB value').toBe(
        preApplyStemPlotX
      );

      expect(
        'RawPlotY' in metadataAfter.domainDiff.coremeasurements,
        'domainDiff.coremeasurements must declare no column that did not actually change — RawPlotY was never edited'
      ).toBe(false);

      // Ledger snapshot vs live agreement: the coremeasurements state row
      // embedded for cm1 on AfterState must carry the same rounded
      // RawPlotX the live row now has, and the BeforeState row must carry
      // the captured original.
      const cm1AfterStateRow = findCoreMeasurementStateRow(afterState, fixture.coreMeasurementIDs.cm1);
      const cm1BeforeStateRow = findCoreMeasurementStateRow(beforeState, fixture.coreMeasurementIDs.cm1);
      expect(cm1AfterStateRow, "the generic writer always owns the edited row's own coremeasurements AfterState row").not.toBeNull();
      expect(cm1BeforeStateRow, "the generic writer always owns the edited row's own coremeasurements BeforeState row").not.toBeNull();
      expect(String(cm1AfterStateRow!.row!.RawPlotX), 'the ledger AfterState snapshot must agree with the live post-write row').toBe(PRECISION_STORED_PLOT_X);
      expect(cm1BeforeStateRow!.row!.RawPlotX, 'the ledger BeforeState snapshot must carry the captured pre-apply original').toBe(preApplyRawPlotX);

      // --- Whole-row sparseness on cm1/s1: nothing other than
      // RawSpCode/IsValidated (species correction) and RawPlotX (this
      // edit's one field) moved at all. -----------------------------------
      const CM1_PRECISION_EDIT_OMIT_COLUMNS = [...COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS, 'RawPlotX'];
      expect(omitColumns(cm1After, CM1_PRECISION_EDIT_OMIT_COLUMNS)).toEqual(omitColumns(cm1Before, CM1_PRECISION_EDIT_OMIT_COLUMNS));
      expect(omitColumns(s1After, ['PlotX'])).toEqual(omitColumns(s1Before, ['PlotX']));

      // --- Rest of the write stays correct and sparse: untouched stems,
      // and siblings differing from their pre-apply rows only in the
      // columns a tree-wide correction is allowed to touch on ANY member.
      // -------------------------------------------------------------------
      expect(await loadStem(connection, fixture.stemGUIDs.s2), 'S2 carries no part of this edit and must be byte-identical').toEqual(s2Before);
      expect(await loadStem(connection, fixture.stemGUIDs.s3), 'S3 carries no part of this edit and must be byte-identical').toEqual(s3Before);

      const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      expect(omitColumns(cm2After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm2Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(omitColumns(cm3After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm3Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(omitColumns(cm4After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
        omitColumns(cm4Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
      );
      expect(cm2After.RawSpCode, 'every attached sibling gets the canonical species projection, active or otherwise').toBe(SPECIES_CODE_QUERCO);
      expect(cm3After.RawSpCode).toBe(SPECIES_CODE_QUERCO);
      expect(cm4After.RawSpCode, 'the inactive sibling still gets the canonical species projection').toBe(SPECIES_CODE_QUERCO);

      // --- revertEdit undo coverage: the restore plan (QUERCO -> ACERRU)
      // is itself a tree-wide species correction, so the real
      // confirm-then-retry handshake applies here too. --------------------
      const editOperationID = applyResult.editOperationID!;
      const revertInput: RevertInput = { schema: config.database, editOperationID, createdBy: CREATED_BY_REVERT, role: ADMIN_ROLE };
      const driftError = await expectRevertDriftError(cm, revertInput);

      // The unconfirmed drift error's freshPlan must surface the SAME full
      // tree-wide impact the original apply's plan did (#427 contract) —
      // not a narrower single-row view of the restore.
      expect(driftError.freshPlan.speciesCorrection, 'the unconfirmed restore plan must surface the full tree-wide species correction').toBeDefined();
      const freshCorrection = driftError.freshPlan.speciesCorrection!;
      expect(freshCorrection.targetTreeID).toBe(fixture.treeID);
      expect(freshCorrection.treeTag).toBe(TREE_TAG_SCT1);
      expect(freshCorrection.oldSpeciesCode, 'the restore plan analyzes the CURRENT post-apply species as its "old" side').toBe(SPECIES_CODE_QUERCO);
      expect(freshCorrection.newSpeciesCode, 'and the ORIGINAL pre-apply species as its "new" (restore target) side').toBe(SPECIES_CODE_ACERRU);
      expect(freshCorrection.oldSpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);
      expect(freshCorrection.newSpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
      expect(freshCorrection.activeStemCount).toBe(2);
      expect(freshCorrection.inactiveStemCount).toBe(1);
      expect(freshCorrection.activeMeasurementCount).toBe(3);
      expect(freshCorrection.inactiveMeasurementCount).toBe(1);
      const expectedStemGUIDsSorted = [fixture.stemGUIDs.s1, fixture.stemGUIDs.s2, fixture.stemGUIDs.s3].sort((a, b) => a - b);
      expect(freshCorrection.stems.map(s => s.stemGUID)).toEqual(expectedStemGUIDsSorted);
      const expectedCmIDsSorted = Object.values(fixture.coreMeasurementIDs).sort((a, b) => a - b);
      expect(freshCorrection.measurements.map(m => m.coreMeasurementID)).toEqual(expectedCmIDsSorted);
      expect(
        driftError.freshPlan.planHash,
        'a speciesCorrection-bearing restore plan must still produce a stable planHash for the confirmed retry'
      ).toBeTruthy();

      // --- The failed unconfirmed attempt mutated NOTHING: re-read cm1,
      // the shared stem, the tree, and the original ledger row and assert
      // byte-identical equality to the post-apply state captured above. ---
      expect(
        await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1),
        'a thrown RevertDriftError must leave cm1 exactly as the post-apply write left it'
      ).toEqual(cm1After);
      expect(
        await loadStem(connection, fixture.stemGUIDs.s1),
        'a thrown RevertDriftError must leave the shared stem exactly as the post-apply write left it'
      ).toEqual(s1After);
      expect(await loadTree(connection, fixture.treeID), 'a thrown RevertDriftError must leave the tree row exactly as the post-apply write left it').toEqual(
        treeRow
      );
      const ledgerRowsAfterDrift = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
      expect(ledgerRowsAfterDrift, 'the drift throw happens before any write, so still exactly the one original apply ledger row').toHaveLength(1);
      expect(ledgerRowsAfterDrift[0], 'the original ledger row must be byte-identical to its captured post-apply state').toEqual(editOperationRows[0]);
      expect(
        ledgerRowsAfterDrift[0].RevertedByEditOperationID,
        'the original ledger row must still be unreverted after the failed unconfirmed attempt'
      ).toBeNull();

      // --- Only NOW does the confirmed retry run, after proving the
      // unconfirmed attempt above mutated nothing. -------------------------
      const confirmedResult = await revertEdit(cm, { ...revertInput, confirmedPlanHash: driftError.freshPlan.planHash });

      // --- Confirmed retry succeeds and records a DIFFERENT ledger row. ---
      expect(confirmedResult.editOperationID, 'the confirmed revert must record its own ledger row').not.toBeNull();
      expect(confirmedResult.editOperationID, "the revert's own ledger row must be distinct from the original apply's").not.toBe(editOperationID);

      // --- The original pre-apply values are restored EXACTLY: back to
      // the captured pre-apply NULLs, never merely "changed". -------------
      const cm1Restored = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const s1Restored = await loadStem(connection, fixture.stemGUIDs.s1);
      expect(cm1Restored.RawPlotX, 'the confirmed revert must restore RawPlotX to the captured pre-apply value').toBe(preApplyRawPlotX);
      expect(cm1Restored.RawPlotX).toBeNull();
      expect(s1Restored.PlotX, "the confirmed revert must restore the shared stem's PlotX to the captured pre-apply value").toBe(preApplyStemPlotX);
      expect(s1Restored.PlotX).toBeNull();
      expect(cm1Restored.RawPlotY, 'RawPlotY was never part of this edit or its revert and must stay NULL').toBeNull();
      expect(s1Restored.PlotY, "the shared stem's PlotY must likewise stay untouched by the revert").toBeNull();

      // --- The original ledger row is now linked to the revert that undid it. ---
      const ledgerRowsAfterRevert = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
      const originalLedgerRowAfterRevert = ledgerRowsAfterRevert.find(row => Number(row.EditOperationID) === editOperationID);
      expect(originalLedgerRowAfterRevert, 'the original apply ledger row must still exist after the revert').toBeDefined();
      expect(
        Number(originalLedgerRowAfterRevert!.RevertedByEditOperationID),
        "the original ledger row's RevertedByEditOperationID must equal the revert's own editOperationID"
      ).toBe(confirmedResult.editOperationID);
    });

    it('exactly undoes the correction via revertEdit: trees.SpeciesID and every sibling RawSpCode (including NULL and differing spelling) return to their prior values', async () => {
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      const editOperationID = applyResult.editOperationID!;

      // revertEdit's restore plan is itself a species correction (warn
      // severity, since it re-analyzes "set SpeciesCode back to ACERRU" the
      // same way the original edit was analyzed), so the first unconfirmed
      // call is REQUIRED to throw RevertDriftError
      // (frontend/config/editplan/revert.ts: SEVERITY_RANK[...] > info &&
      // confirmedPlanHash !== restorePlan.planHash). This test proves the
      // real confirm-then-retry handshake, not a bypass of that guard.
      const driftError = await expectRevertDriftError(cm, {
        schema: config.database,
        editOperationID,
        createdBy: CREATED_BY_REVERT,
        role: ADMIN_ROLE
      });
      expect(driftError).not.toBeNull();
      expect(driftError.freshPlan.planHash).toBeTruthy();

      // Confirmed retry: the client re-posts with the hash from the drift
      // response to explicitly accept the restore's consequences.
      await revertEdit(cm, {
        schema: config.database,
        editOperationID,
        createdBy: CREATED_BY_REVERT,
        role: ADMIN_ROLE,
        confirmedPlanHash: driftError.freshPlan.planHash
      });

      const treeRow = await loadTree(connection, fixture.treeID);
      expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);

      const cm1 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);

      expect(cm1.RawSpCode).toBe(SPECIES_CODE_ACERRU);
      expect(cm2.RawSpCode).toBeNull();
      expect(cm3.RawSpCode).toBe('acerru');
      expect(cm4.RawSpCode).toBe(SPECIES_CODE_ACERRU);

      // Sibling DBH/comment untouched by the round trip.
      expect(Number(cm3.MeasuredDBH)).toBeCloseTo(DBH_CM3, 2);
      expect(cm3.Description).toBe(DESCRIPTION_CM3);
    });

    it("undoes a species correction on the tree's non-first member (cm2) exactly and sparsely via the real drift-then-confirm handshake — even when the second rejected attempt carries a stale plan hash from the original forward apply — leaving an unrelated later comment on the target, a sibling's own later DBH/comment edit, an inactive sibling's later validation-state flip, a cmattributes rebuild under new CMAIDs, and an unrelated error-log entry all exactly as the later edits left them, while only the fields/associations the correction itself changed roll back to their captured pre-apply values", async () => {
      // cm2's fixture RawCodes ('A') is overwritten with a historical string
      // that also carries an unknown raw code; only the known semantic codes
      // get their own cmattributes rows, mirroring real ingested history.
      await connection.query('UPDATE coremeasurements SET RawCodes = ? WHERE CoreMeasurementID = ?', [
        CM2_HISTORICAL_RAW_CODES,
        fixture.coreMeasurementIDs.cm2
      ]);
      await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?), (?, ?)', [
        fixture.coreMeasurementIDs.cm2,
        ATTR_CODE_ALIVE,
        fixture.coreMeasurementIDs.cm2,
        ATTR_CODE_DEAD
      ]);

      const cm1Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      const treeBefore = await loadTree(connection, fixture.treeID);
      const s1Before = await loadStem(connection, fixture.stemGUIDs.s1);
      const s2Before = await loadStem(connection, fixture.stemGUIDs.s2);
      const s3Before = await loadStem(connection, fixture.stemGUIDs.s3);
      const cmAttrCountBefore = await countRows(connection, 'cmattributes');

      // Preconditions this test's own later assertions depend on — captured
      // from the DB, not assumed, so a fixture drift fails loudly right here.
      expect(cm2Before.RawSpCode).toBeNull();
      expect(cm2Before.RawCodes).toBe(CM2_HISTORICAL_RAW_CODES);
      expect(decodeBitFlag(cm4Before.IsValidated)).toBe(true);

      const [cm2CodesBeforeRows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code', [
        fixture.coreMeasurementIDs.cm2
      ]);
      const cm2CodesBefore = cm2CodesBeforeRows.map(row => row.Code as string);
      expect(cm2CodesBefore).toEqual([ATTR_CODE_ALIVE, ATTR_CODE_DEAD]);

      const newRow = { SpeciesCode: SPECIES_CODE_QUERCO, MeasuredDBH: CM2_CORRECTED_DBH, Attributes: ATTR_CODE_DEAD };
      const plan = await analyzeEdit(
        cm,
        config.database,
        'measurementssummary',
        fixture.plotID,
        fixture.censusID,
        fixture.coreMeasurementIDs.cm2,
        newRow,
        undefined,
        { role: ADMIN_ROLE }
      );
      expect(plan.canApply).toBe(true);
      expect(plan.speciesCorrection).toBeDefined();

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm2,
        newRow,
        expectedPlanHash: plan.planHash,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      const originalEditOperationID = applyResult.editOperationID!;

      // --- Independent later edits, applied by direct SQL (not through the
      // edit-plan API) after the correction, which the undo below must leave
      // untouched: cm2's own comment, a sibling's own DBH/comment, an
      // inactive sibling's validation flag, cm2's cmattributes rebuilt under
      // brand-new CMAIDs with the same semantic codes, and an unrelated
      // error-log entry. ---
      await connection.query('UPDATE coremeasurements SET RawComments = ? WHERE CoreMeasurementID = ?', [
        CM2_LATER_RAW_COMMENTS,
        fixture.coreMeasurementIDs.cm2
      ]);
      await connection.query('UPDATE coremeasurements SET MeasuredDBH = ?, RawComments = ? WHERE CoreMeasurementID = ?', [
        CM3_LATER_DBH,
        CM3_LATER_RAW_COMMENTS,
        fixture.coreMeasurementIDs.cm3
      ]);
      await connection.query('UPDATE coremeasurements SET IsValidated = 0 WHERE CoreMeasurementID = ?', [fixture.coreMeasurementIDs.cm4]);
      await connection.query('DELETE FROM cmattributes WHERE CoreMeasurementID = ?', [fixture.coreMeasurementIDs.cm2]);
      await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [fixture.coreMeasurementIDs.cm2, ATTR_CODE_DEAD]);
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION, false);

      const cm1PostLater = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const cm2PostLater = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
      const cm3PostLater = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
      const cm4PostLater = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      const treePostLater = await loadTree(connection, fixture.treeID);
      const s1PostLater = await loadStem(connection, fixture.stemGUIDs.s1);
      const s2PostLater = await loadStem(connection, fixture.stemGUIDs.s2);
      const s3PostLater = await loadStem(connection, fixture.stemGUIDs.s3);
      const [cm2AttrRowsPostLater] = await connection.query<RowDataPacket[]>('SELECT CMAID, Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code', [
        fixture.coreMeasurementIDs.cm2
      ]);
      const cm2LogPostLater = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
      const ledgerRowsPostLater = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm2]);
      const treeCountFixed = await countRows(connection, 'trees');
      const stemCountFixed = await countRows(connection, 'stems');
      const cmCountFixed = await countRows(connection, 'coremeasurements');
      const cmAttrCountPostLater = await countRows(connection, 'cmattributes');

      expect(cm2AttrRowsPostLater.map(row => row.Code as string)).toEqual([ATTR_CODE_DEAD]);
      expect(ledgerRowsPostLater).toHaveLength(1);
      expect(ledgerRowsPostLater[0].RevertedByEditOperationID).toBeNull();

      // --- First rejected attempt: no confirmedPlanHash at all. The
      // restore plan is itself a species correction (above-info severity),
      // so revertEdit MUST throw RevertDriftError before writing anything. ---
      const revertInputBase: RevertInput = {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT,
        role: ADMIN_ROLE
      };
      const driftError1 = await expectRevertDriftError(cm, revertInputBase);
      expect(driftError1.freshPlan.planHash).toBeTruthy();

      // --- Second rejected attempt: a plan hash IS supplied, but it is the
      // ORIGINAL forward apply's stale hash, not the restore plan's fresh
      // one — revertEdit must reject this exactly as it rejects "no hash". ---
      const driftError2 = await expectRevertDriftError(cm, { ...revertInputBase, confirmedPlanHash: plan.planHash });
      expect(driftError2.freshPlan.planHash).toBe(driftError1.freshPlan.planHash);

      // --- Nothing mutated by either rejected attempt: every row this
      // correction could touch is still exactly where the later direct-SQL
      // edits left it. ---
      expect(await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1)).toEqual(cm1PostLater);
      expect(await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2)).toEqual(cm2PostLater);
      expect(await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3)).toEqual(cm3PostLater);
      expect(await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4)).toEqual(cm4PostLater);
      expect(await loadTree(connection, fixture.treeID)).toEqual(treePostLater);
      expect(await loadStem(connection, fixture.stemGUIDs.s1)).toEqual(s1PostLater);
      expect(await loadStem(connection, fixture.stemGUIDs.s2)).toEqual(s2PostLater);
      expect(await loadStem(connection, fixture.stemGUIDs.s3)).toEqual(s3PostLater);
      const [cm2AttrRowsAfterRejected] = await connection.query<RowDataPacket[]>(
        'SELECT CMAID, Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code',
        [fixture.coreMeasurementIDs.cm2]
      );
      expect(cm2AttrRowsAfterRejected).toEqual(cm2AttrRowsPostLater);
      expect(await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2)).toEqual(cm2LogPostLater);
      expect(await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm2])).toEqual(ledgerRowsPostLater);
      expect(await countRows(connection, 'trees')).toBe(treeCountFixed);
      expect(await countRows(connection, 'stems')).toBe(stemCountFixed);
      expect(await countRows(connection, 'coremeasurements')).toBe(cmCountFixed);
      expect(await countRows(connection, 'cmattributes')).toBe(cmAttrCountPostLater);

      // --- CONFIRMED_RETRY_MARKER ---
    });

    it("resolves the one supported site-specific validation occurrence per the IsEnabled/non-blank-Definition policy, retains every other validation occurrence (disabled rule, blank-definition rule, unknown code, ErrorCode 20/21, manager-marker) unchanged, resets active members to pending, and leaves the inactive member's validation state untouched", async () => {
      // Per the #427 writer-step3 contract (relay-local-427-writer-step3-plan.md):
      // a tree-wide correction resolves ONLY a validation occurrence whose
      // ErrorCode exactly matches CAST(ValidationID AS CHAR) of an
      // sitespecificvalidations row that is both IsEnabled=1 AND has a
      // non-blank Definition — never a blanket "ErrorSource = validation"
      // sweep. Every other occurrence, including ErrorCode 20/21 (inline
      // ingestion-stage codes, never enabled/defined as a rerunnable
      // site-specific rule) and an already-resolved history row, is
      // retained verbatim — never deleted. cm4 is the INACTIVE measurement:
      // its history AND its IsValidated state must both survive untouched,
      // not be dropped or reset as if it were an active member.
      //
      // Codes 20/21 are deliberately flipped to IsEnabled=1 with a
      // non-blank Definition for the duration of this test (restored in
      // `finally` below), so their protection is proven categorical — not
      // merely a side effect of their rule being disabled or undefined.
      const siteValidation20Before = await captureSiteSpecificValidationRow(connection, SITE_VALIDATION_ID_PREVIOUS_CENSUS_SPECIES_MISMATCH);
      const siteValidation21Before = await captureSiteSpecificValidationRow(connection, SITE_VALIDATION_ID_SAME_BATCH_SPECIES_CONFLICT);
      try {
        await seedSiteSpecificValidationRule(connection, SITE_VALIDATION_ID_SUPPORTED, PROCEDURE_NAME_SUPPORTED_RULE, SITE_VALIDATION_TEST_DEFINITION, true);
        await seedSiteSpecificValidationRule(connection, SITE_VALIDATION_ID_DISABLED, PROCEDURE_NAME_DISABLED_RULE, SITE_VALIDATION_TEST_DEFINITION, false);
        await seedSiteSpecificValidationRule(connection, SITE_VALIDATION_ID_BLANK_DEFINITION, PROCEDURE_NAME_BLANK_DEFINITION_RULE, '', true);
        await seedSiteSpecificValidationRule(
          connection,
          SITE_VALIDATION_ID_PREVIOUS_CENSUS_SPECIES_MISMATCH,
          PROCEDURE_NAME_PREVIOUS_CENSUS_SPECIES_MISMATCH_RERUNNABLE,
          SITE_VALIDATION_TEST_DEFINITION,
          true
        );
        await seedSiteSpecificValidationRule(
          connection,
          SITE_VALIDATION_ID_SAME_BATCH_SPECIES_CONFLICT,
          PROCEDURE_NAME_SAME_BATCH_SPECIES_CONFLICT_RERUNNABLE,
          SITE_VALIDATION_TEST_DEFINITION,
          true
        );

        // cm1 (the edited target, active): one resolvable occurrence (the
        // SUPPORTED rule) alongside the pre-existing, never-rerunnable
        // ErrorCode 20.
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1, ERROR_SOURCE_VALIDATION, ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1, ERROR_SOURCE_VALIDATION, ERROR_CODE_SUPPORTED_RULE, false);
        // cm2 (active sibling): a disabled rule and a blank-definition rule —
        // both match a real sitespecificvalidations row by ID, but neither
        // qualifies as "rerunnable", so both must stay unresolved. A SECOND,
        // independent SUPPORTED-rule occurrence proves resolution applies to
        // every active member, not only the edited target row.
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_VALIDATION, ERROR_CODE_DISABLED_RULE, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_VALIDATION, ERROR_CODE_BLANK_DEFINITION_RULE, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_VALIDATION, ERROR_CODE_SUPPORTED_RULE, false);
        // cm3 (active sibling): ErrorCode 21 plus a code matching no
        // sitespecificvalidations row at all. An ALREADY-RESOLVED
        // SUPPORTED-rule history occurrence (fixed CreatedAt/ResolvedAt,
        // seeded directly like the cm4 manager marker below) proves a past
        // resolution is never re-stamped or duplicated by a later
        // correction — placed on cm3 rather than cm2 so it never shares a
        // MeasurementID with the still-unresolved SUPPORTED occurrence
        // seeded on cm2 above.
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_VALIDATION, ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT, false);
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_VALIDATION, ERROR_CODE_UNKNOWN_RULE, false);
        await connection.query('INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES (?, ?, ?)', [
          ERROR_SOURCE_VALIDATION,
          ERROR_CODE_SUPPORTED_RULE,
          `seeded for #427 acceptance: ${ERROR_SOURCE_VALIDATION}/${ERROR_CODE_SUPPORTED_RULE}`
        ]);
        const [supportedErrorRows] = await connection.query<RowDataPacket[]>(
          'SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ? LIMIT 1',
          [ERROR_SOURCE_VALIDATION, ERROR_CODE_SUPPORTED_RULE]
        );
        const supportedErrorID = supportedErrorRows[0].ErrorID as number;
        await connection.query(
          `INSERT INTO measurement_error_log (MeasurementID, ErrorID, CreatedAt, IsResolved, ResolvedAt)
           VALUES (?, ?, ?, 1, ?)`,
          [fixture.coreMeasurementIDs.cm3, supportedErrorID, SUPPORTED_RULE_HISTORY_CREATED_AT, SUPPORTED_RULE_HISTORY_RESOLVED_AT]
        );

        // cm4 (inactive): an already-resolved manager-marker occurrence with
        // FIXED, deterministic immutable-history fields — seeded directly
        // (not through seedMeasurementErrorLog, which stamps "now") so every
        // column can be compared byte-for-byte, not merely re-derived from a
        // clock read. There is no ResolutionReason column on this base and no
        // override-provenance subsystem; ERROR_CODE_MANAGER_OVERRIDE_LIKE is
        // only an arbitrary string proving a resolved history row survives.
        // An UNRESOLVED SUPPORTED-rule occurrence is added alongside it:
        // validation-occurrence resolution is activeMemberIDs-only, so this
        // occurrence must stay unresolved even though the SAME rule resolves
        // on cm1/cm2 below.
        await connection.query('INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES (?, ?, ?)', [
          ERROR_SOURCE_VALIDATION,
          ERROR_CODE_MANAGER_OVERRIDE_LIKE,
          `seeded for #427 acceptance: ${ERROR_SOURCE_VALIDATION}/${ERROR_CODE_MANAGER_OVERRIDE_LIKE}`
        ]);
        const [managerErrorRows] = await connection.query<RowDataPacket[]>(
          'SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ? LIMIT 1',
          [ERROR_SOURCE_VALIDATION, ERROR_CODE_MANAGER_OVERRIDE_LIKE]
        );
        const managerErrorID = managerErrorRows[0].ErrorID as number;
        await connection.query(
          `INSERT INTO measurement_error_log (MeasurementID, ErrorID, CreatedAt, IsResolved, ResolvedAt, PriorCensusID, PriorDBH, PriorHOM)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            fixture.coreMeasurementIDs.cm4,
            managerErrorID,
            MANAGER_OVERRIDE_CREATED_AT,
            MANAGER_OVERRIDE_RESOLVED_AT,
            fixture.censusID,
            MANAGER_OVERRIDE_PRIOR_DBH,
            MANAGER_OVERRIDE_PRIOR_HOM
          ]
        );
        await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4, ERROR_SOURCE_VALIDATION, ERROR_CODE_SUPPORTED_RULE, false);

        const cm1LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1);
        const cm2LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
        const cm3LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
        const cm4LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);
        expect(cm1LogBefore).toHaveLength(2);
        expect(cm2LogBefore).toHaveLength(3);
        expect(cm3LogBefore).toHaveLength(3);
        expect(cm4LogBefore).toHaveLength(2);
        const cm1SupportedBefore = cm1LogBefore.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm1SupportedBefore.IsResolved)).toBe(false); // genuinely unresolved before the correction
        const cm2SupportedBefore = cm2LogBefore.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm2SupportedBefore.IsResolved)).toBe(false); // genuinely unresolved before the correction
        const cm3SupportedHistoryBefore = cm3LogBefore.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm3SupportedHistoryBefore.IsResolved)).toBe(true); // already resolved before the correction — must not be re-stamped
        const cm4SupportedBefore = cm4LogBefore.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm4SupportedBefore.IsResolved)).toBe(false); // genuinely unresolved before the correction

        // This applyEdit call is itself the proof that no live science SQL
        // runs: SITE_VALIDATION_TEST_DEFINITION is deliberately not valid
        // SQL — if the writer ever executed a Definition instead of merely
        // reading IsEnabled/non-blank as metadata, this call would throw a
        // MySQL syntax error and fail the test right here.
        await applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: null,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        });

        // --- cm1 (target, active): ErrorCode 20 retained byte-for-byte; the
        // SUPPORTED rule's occurrence resolved and RETAINED (not deleted). ---
        const cm1LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm1);
        expect(cm1LogAfter).toHaveLength(2); // never deleted — the conservative retain/resolve contract, not a generic target-row DELETE
        const cm1MismatchAfter = cm1LogAfter.find(r => r.ErrorCode === ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH)!;
        // Code 20's own sitespecificvalidations row is seeded IsEnabled=1
        // with a non-blank Definition above — it still must not resolve.
        // Expected to fail until F24 (categorical protection of inline
        // ingestion-stage ErrorCodes 20/21, independent of whether their
        // rule looks "rerunnable") is fixed.
        expect(cm1MismatchAfter).toEqual(cm1LogBefore.find(r => r.ErrorCode === ERROR_CODE_PREVIOUS_CENSUS_SPECIES_MISMATCH));
        expect(Boolean(cm1MismatchAfter.IsResolved)).toBe(false);

        const cm1SupportedAfter = cm1LogAfter.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm1SupportedAfter.IsResolved)).toBe(true); // resolved — IsEnabled=1 AND non-blank Definition AND ErrorCode matched
        expect(cm1SupportedAfter.ResolvedAt).not.toBeNull();
        expect((cm1SupportedAfter.CreatedAt as Date).getTime()).toBe((cm1SupportedBefore.CreatedAt as Date).getTime()); // resolved in place, not deleted and re-inserted

        // --- cm2 (active sibling): disabled rule + blank-definition rule
        // stay untouched; its OWN SUPPORTED occurrence resolves in place —
        // proving resolution is not limited to the edited target row. ---
        const cm2LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
        expect(cm2LogAfter).toHaveLength(3);
        expect(cm2LogAfter.find(r => r.ErrorCode === ERROR_CODE_DISABLED_RULE)).toEqual(cm2LogBefore.find(r => r.ErrorCode === ERROR_CODE_DISABLED_RULE));
        expect(cm2LogAfter.find(r => r.ErrorCode === ERROR_CODE_BLANK_DEFINITION_RULE)).toEqual(
          cm2LogBefore.find(r => r.ErrorCode === ERROR_CODE_BLANK_DEFINITION_RULE)
        );
        const cm2SupportedAfter = cm2LogAfter.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(Boolean(cm2SupportedAfter.IsResolved)).toBe(true); // an active sibling's own occurrence of the SAME rule resolves too, not only the target's
        expect(cm2SupportedAfter.ResolvedAt).not.toBeNull();
        expect((cm2SupportedAfter.CreatedAt as Date).getTime()).toBe((cm2SupportedBefore.CreatedAt as Date).getTime()); // resolved in place, not deleted and re-inserted

        // --- cm3 (active sibling): ErrorCode 21 + an unrecognized code stay
        // untouched; its pre-existing already-resolved SUPPORTED-rule
        // history row is byte-identical — not re-stamped, not duplicated. ---
        const cm3LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
        expect(cm3LogAfter).toHaveLength(3);
        const cm3ConflictAfter = cm3LogAfter.find(r => r.ErrorCode === ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT)!;
        // Code 21's own sitespecificvalidations row is seeded IsEnabled=1
        // with a non-blank Definition above — it still must not resolve.
        // Expected to fail until F24 is fixed (same categorical-protection
        // gap as code 20 on cm1 above).
        expect(cm3ConflictAfter).toEqual(cm3LogBefore.find(r => r.ErrorCode === ERROR_CODE_SAME_BATCH_SPECIES_CONFLICT));
        expect(Boolean(cm3ConflictAfter.IsResolved)).toBe(false);
        expect(cm3LogAfter.find(r => r.ErrorCode === ERROR_CODE_UNKNOWN_RULE)).toEqual(cm3LogBefore.find(r => r.ErrorCode === ERROR_CODE_UNKNOWN_RULE));
        const cm3SupportedHistoryAfter = cm3LogAfter.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(cm3SupportedHistoryAfter).toEqual(cm3SupportedHistoryBefore); // already-resolved — immutable, never re-stamped or duplicated

        // --- cm4 (inactive): already-resolved manager-marker history is
        // immutable — every column, including CreatedAt/ResolvedAt/
        // PriorCensusID/PriorDBH/PriorHOM, survives byte-for-byte. Its
        // SUPPORTED occurrence also survives unresolved: validation-
        // occurrence resolution is activeMemberIDs-only, so the inactive
        // member is never touched even though the same rule resolves on
        // cm1/cm2. Looked up by ErrorCode (not array index/order), since
        // this row now carries two entries. ---
        const cm4LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);
        expect(cm4LogAfter).toHaveLength(2);
        const cm4ManagerAfter = cm4LogAfter.find(r => r.ErrorCode === ERROR_CODE_MANAGER_OVERRIDE_LIKE)!;
        expect(cm4ManagerAfter).toEqual(cm4LogBefore.find(r => r.ErrorCode === ERROR_CODE_MANAGER_OVERRIDE_LIKE));
        const cm4SupportedAfter = cm4LogAfter.find(r => r.ErrorCode === ERROR_CODE_SUPPORTED_RULE)!;
        expect(cm4SupportedAfter).toEqual(cm4SupportedBefore);
        expect(Boolean(cm4SupportedAfter.IsResolved)).toBe(false);
        expect(cm4SupportedAfter.ResolvedAt).toBeNull();

        // --- Pending/validation state: every ACTIVE affected member becomes
        // pending (IsValidated -> NULL); the INACTIVE member's IsValidated
        // and IsActive are byte-identical to before — not reset, not
        // reactivated. ---
        const cm1Row = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
        const cm2Row = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
        const cm3Row = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
        const cm4Row = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);

        expect(decodeBitFlag(cm1Row.IsValidated)).toBeNull();
        expect(decodeBitFlag(cm2Row.IsValidated)).toBeNull();
        expect(decodeBitFlag(cm3Row.IsValidated)).toBeNull();

        expect(decodeBitFlag(cm4Row.IsValidated)).toBe(true); // fixture seeded IsValidated=1 on the inactive member — untouched by resetValidationPending (active siblings only)
        expect(Boolean(cm4Row.IsActive)).toBe(false); // never reactivated by a species correction
      } finally {
        // Mandatory even on assertion failure: 20/21 are production-seeded
        // rows other tests/suites depend on, never owned by this test file.
        await restoreSiteSpecificValidationRow(connection, SITE_VALIDATION_ID_PREVIOUS_CENSUS_SPECIES_MISMATCH, siteValidation20Before);
        await restoreSiteSpecificValidationRow(connection, SITE_VALIDATION_ID_SAME_BATCH_SPECIES_CONFLICT, siteValidation21Before);
      }
    });

    it("ingestion-error refresh after a tree-wide correction re-checks every attached member's own current effective values — active sibling, edited target's sibling, AND the inactive member alike — resolving only the #307-provable INVALID_SPECIES occurrence while retaining an unsupported ingestion code and a sibling's own still-genuine issue untouched", async () => {
      // cm3's own unrelated issue: DBH/HOM/Codes are made genuinely EMPTY
      // here, independent of species — a species edit cannot fix this, so
      // the per-row #307 checker must keep reporting MISSING_MEASUREMENT_DATA
      // rather than sweeping it away as collateral "resolve everything for
      // this measurement" cleanup.
      await connection.query('UPDATE coremeasurements SET MeasuredDBH = NULL, MeasuredHOM = NULL, RawCodes = NULL WHERE CoreMeasurementID = ?', [
        fixture.coreMeasurementIDs.cm3
      ]);

      // cm2 (active sibling): the one #307-provable code (INVALID_SPECIES —
      // the checker's joined read of this active sibling's effective SpCode
      // becomes the tree's new, active canonical species) alongside an
      // unsupported code that must never resolve.
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_INGESTION, ERROR_CODE_INVALID_SPECIES, false);
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION, false);
      // cm3 (active sibling): its own still-genuine missing-measurement-data issue.
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3, ERROR_SOURCE_INGESTION, ERROR_CODE_MISSING_MEASUREMENT_DATA, false);
      // cm4 (inactive, on the inactive stem s3 — but attached to the SAME
      // tree as cm1-cm3): per refreshCorrectionErrorsAndValidationPending's
      // own contract, the #307 ingestion refresh runs over allMemberIDs
      // — "active or inactive, edited target included" — unlike the
      // validation-occurrence resolution and pending-reset, which are
      // activeMemberIDs-only. cm4's effective SpCode is read through the
      // same tree, so it also becomes the new canonical species: this
      // INVALID_SPECIES occurrence is expected to resolve too, proving the
      // ingestion checker is genuinely per-member/per-row and does not
      // special-case IsActive the way the validation/pending half does.
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4, ERROR_SOURCE_INGESTION, ERROR_CODE_INVALID_SPECIES, false);
      await seedMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4, ERROR_SOURCE_INGESTION, ERROR_CODE_UNSUPPORTED_INGESTION, false);

      const cm2LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
      const cm3LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
      const cm4LogBefore = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);
      expect(cm2LogBefore).toHaveLength(2);
      expect(cm3LogBefore).toHaveLength(1);
      expect(cm4LogBefore).toHaveLength(2);
      expect(Boolean(cm3LogBefore[0].IsResolved)).toBe(false); // genuinely unresolved before the correction

      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });

      // --- cm2: INVALID_SPECIES resolved (the tree's post-correction
      // canonical species is active, so the #307 checker's own joined read
      // proves it); DUPLICATE_ENTRY is never in checkedCodes, so it stays
      // unresolved no matter what the row's current fields are. ---
      const cm2LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm2);
      expect(cm2LogAfter).toHaveLength(2);
      const cm2InvalidSpeciesAfter = cm2LogAfter.find(r => r.ErrorCode === ERROR_CODE_INVALID_SPECIES)!;
      expect(Boolean(cm2InvalidSpeciesAfter.IsResolved)).toBe(true);
      const cm2UnsupportedAfter = cm2LogAfter.find(r => r.ErrorCode === ERROR_CODE_UNSUPPORTED_INGESTION)!;
      expect(cm2UnsupportedAfter).toEqual(cm2LogBefore.find(r => r.ErrorCode === ERROR_CODE_UNSUPPORTED_INGESTION)); // never a checked code — never touched

      // --- cm3: own still-genuine MISSING_MEASUREMENT_DATA issue survives
      // — still present, still unresolved, still the only entry (not swept
      // away and not duplicated by the species correction). ---
      const cm3LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm3);
      expect(cm3LogAfter).toHaveLength(1);
      expect(cm3LogAfter[0].ErrorCode).toBe(ERROR_CODE_MISSING_MEASUREMENT_DATA);
      expect(Boolean(cm3LogAfter[0].IsResolved)).toBe(false); // still genuinely missing — correctly NOT resolved by an unrelated species edit

      // --- cm4 (inactive): STILL re-checked by the #307 ingestion refresh
      // (allMemberIDs, not activeMemberIDs) — its INVALID_SPECIES resolves
      // for exactly the same per-row reason cm2's did, while its
      // never-checked DUPLICATE_ENTRY-style code is retained unchanged.
      // This is deliberately NOT a copy of cm1's pending/IsActive state
      // (see the previous test): resolving an ingestion-error occurrence
      // never reactivates a member or touches IsValidated. ---
      const cm4LogAfter = await loadMeasurementErrorLog(connection, fixture.coreMeasurementIDs.cm4);
      expect(cm4LogAfter).toHaveLength(2);
      const cm4InvalidSpeciesAfter = cm4LogAfter.find(r => r.ErrorCode === ERROR_CODE_INVALID_SPECIES)!;
      expect(Boolean(cm4InvalidSpeciesAfter.IsResolved)).toBe(true);
      const cm4UnsupportedAfter = cm4LogAfter.find(r => r.ErrorCode === ERROR_CODE_UNSUPPORTED_INGESTION)!;
      expect(cm4UnsupportedAfter).toEqual(cm4LogBefore.find(r => r.ErrorCode === ERROR_CODE_UNSUPPORTED_INGESTION)); // never a checked code — never touched

      const cm4RowAfterIngestion = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
      expect(Boolean(cm4RowAfterIngestion.IsActive)).toBe(false); // ingestion-error resolution never reactivates a member
    });

    it('rolls back the tree/raw/ledger state when a write fails AFTER the tree SpeciesID update is observed (proves the mutation happened, not merely that no error was thrown)', async () => {
      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);

      const baseline = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);

      // Item B invariant: both derived read models already carry a real row
      // for every fixture measurement before the fault is armed — otherwise
      // "unchanged after rollback" could trivially mean "stayed empty".
      const expectedMemberIDsSorted = [
        fixture.coreMeasurementIDs.cm1,
        fixture.coreMeasurementIDs.cm2,
        fixture.coreMeasurementIDs.cm3,
        fixture.coreMeasurementIDs.cm4
      ].sort((a, b) => a - b);
      expect(baseline.measurementsSummaryRows.map(row => Number(row.CoreMeasurementID))).toEqual(expectedMemberIDsSorted);
      expect(baseline.viewFullTableRows.map(row => Number(row.CoreMeasurementID))).toEqual(expectedMemberIDsSorted);

      sharedState.faultSpec = { matches: matchesTreeSpeciesUpdate, failOn: 'next-after' };

      let caughtError: unknown = null;
      let faultArmedBeforeClear = false;
      try {
        await applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: null,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        });
      } catch (err) {
        caughtError = err;
      } finally {
        // Captured BEFORE clearing, and cleared unconditionally, so a
        // failing assertion below can never leak an armed fault into the
        // next test.
        faultArmedBeforeClear = sharedState.faultArmed;
        sharedState.faultSpec = null;
        sharedState.faultArmed = false;
      }

      // The error must propagate — never swallowed into a resolved promise —
      // AND the tree UPDATE that triggered the fault must actually have been
      // issued: `faultArmed` only flips true once matchesTreeSpeciesUpdate
      // matched a REAL statement inside the transaction. A writer that never
      // issues that UPDATE would leave this false, failing the test outright
      // instead of silently passing on a fault that never actually fired.
      expect(caughtError).not.toBeNull();
      expect((caughtError as Error).message).toContain('Injected fault');
      expect(faultArmedBeforeClear).toBe(true);

      // Full rollback evidence: every row the correction could have touched
      // — the tree, all 3 stems, all 4 measurements, all 4 error-log
      // histories, the edit_operations rows for this fixture, and both
      // prepopulated read models — is byte-identical to the pre-fault
      // baseline.
      const after = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      expect(after).toEqual(baseline);
    });

    it('rolls back the edit_operations ledger insert itself when it is the write that fails (late-write rollback, separate from the tree-update trigger above)', async () => {
      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);

      const baseline = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);

      // Item B invariant: both derived read models already carry a real row
      // for every fixture measurement before the fault is armed.
      const expectedMemberIDsSorted = [
        fixture.coreMeasurementIDs.cm1,
        fixture.coreMeasurementIDs.cm2,
        fixture.coreMeasurementIDs.cm3,
        fixture.coreMeasurementIDs.cm4
      ].sort((a, b) => a - b);
      expect(baseline.measurementsSummaryRows.map(row => Number(row.CoreMeasurementID))).toEqual(expectedMemberIDsSorted);
      expect(baseline.viewFullTableRows.map(row => Number(row.CoreMeasurementID))).toEqual(expectedMemberIDsSorted);

      sharedState.faultSpec = { matches: matchesLedgerInsert, failOn: 'match' };

      let caughtError: unknown = null;
      try {
        await applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: null,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        });
      } catch (err) {
        caughtError = err;
      } finally {
        sharedState.faultSpec = null;
        sharedState.faultArmed = false;
      }

      // This fault only fires when matchesLedgerInsert matches a REAL
      // `INSERT INTO edit_operations` statement — if the writer never
      // reached that statement, no fault would throw and caughtError would
      // stay null, failing this assertion outright.
      expect(caughtError).not.toBeNull();
      expect((caughtError as Error).message).toContain('Injected fault');

      // A failure on the LAST write of the transaction (the ledger insert)
      // must roll back everything earlier in the same transaction too —
      // the tree, stems, measurements, error-log history, and both
      // prepopulated read models all compared whole-row/whole-array against
      // the pre-fault baseline, not merely "ledger count stayed zero".
      const after = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      expect(after).toEqual(baseline);
    });
  });

  // ---------------------------------------------------------------------
  // Undo rollback under an injected write failure, and exact SQL DATE
  // restoration. Unlike the forward-apply rollback describe above, every
  // test here first completes a REAL, unfaulted forward applyEdit and a
  // REAL, unfaulted drift-confirmation handshake — only the CONFIRMED
  // revertEdit call itself runs under fault injection (or, for the DATE
  // test, runs to completion so the restored value can be checked).
  // ---------------------------------------------------------------------
  describe('confirmed undo rollback on an injected write failure', () => {
    it("rolls back the tree/raw/ledger state when a write fails AFTER the undo's own tree SpeciesID UPDATE is observed (proves the undo mutation happened, not merely that no error was thrown)", async () => {
      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      const editOperationID = applyResult.editOperationID!;

      const revertInput: RevertInput = { schema: config.database, editOperationID, createdBy: CREATED_BY_REVERT, role: ADMIN_ROLE };
      const driftError = await expectRevertDriftError(cm, revertInput);
      const confirmedPlanHash = driftError.freshPlan.planHash;

      const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];

      // Pre-undo baseline: this IS the post-forward-apply state (no manual
      // tampering, no fault armed yet) — exactly what a rolled-back undo
      // must leave behind.
      const baseline = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      const ledgerBaseline = await loadEditOperationRowsForTargets(connection, allMemberIDs);

      sharedState.faultSpec = { matches: matchesTreeSpeciesUpdate, failOn: 'next-after' };

      let caughtError: unknown = null;
      let faultArmedBeforeClear = false;
      try {
        await revertEdit(cm, { ...revertInput, confirmedPlanHash });
      } catch (err) {
        caughtError = err;
      } finally {
        // Captured BEFORE clearing, and cleared unconditionally, so a
        // failing assertion below can never leak an armed fault into the
        // next test.
        faultArmedBeforeClear = sharedState.faultArmed;
        sharedState.faultSpec = null;
        sharedState.faultArmed = false;
      }

      // The INJECTED PRIMARY FAILURE must be what surfaced — never a
      // secondary rollback/connection error masking it.
      expect(caughtError, 'the confirmed undo under an injected fault must throw, never resolve').not.toBeNull();
      expect((caughtError as Error).message, 'the propagated error must be the injected fault itself, not some other error masking it').toContain(
        'Injected fault'
      );

      // faultArmed only flips true once matchesTreeSpeciesUpdate matched a
      // REAL undo UPDATE inside this transaction. A test that passed because
      // the undo's own tree SpeciesID UPDATE was never reached would prove
      // nothing about rollback — it would just be an undo that errored early.
      expect(
        faultArmedBeforeClear,
        "the undo's own tree SpeciesID UPDATE must have actually been issued (and let through) before the injected failure on the NEXT write fired"
      ).toBe(true);

      const after = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      expect(after, 'a failed confirmed undo must roll back every row it could have touched to exactly the post-forward-apply baseline').toEqual(baseline);

      const ledgerAfter = await loadEditOperationRowsForTargets(connection, allMemberIDs);
      expect(ledgerAfter, 'no revert ledger row may survive a rolled-back undo').toEqual(ledgerBaseline);

      const originalRowAfter = ledgerAfter.find(row => Number(row.EditOperationID) === editOperationID);
      expect(originalRowAfter, 'the original forward ledger row must still exist after the rolled-back undo').toBeDefined();
      expect(
        originalRowAfter!.RevertedByEditOperationID,
        "the original ledger row's RevertedByEditOperationID must still be NULL — the undo that failed must not have marked it reverted"
      ).toBeNull();
    });

    it("rolls back the edit_operations ledger insert when the undo's OWN revert-ledger INSERT is the write that fails (late-write rollback)", async () => {
      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      const editOperationID = applyResult.editOperationID!;

      const revertInput: RevertInput = { schema: config.database, editOperationID, createdBy: CREATED_BY_REVERT, role: ADMIN_ROLE };
      const driftError = await expectRevertDriftError(cm, revertInput);
      const confirmedPlanHash = driftError.freshPlan.planHash;

      const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];

      const baseline = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      const ledgerBaseline = await loadEditOperationRowsForTargets(connection, allMemberIDs);

      // matchesLedgerInsert only matches a statement that literally STARTS
      // with INSERT (`/^\s*INSERT/i`), so it can never match
      // markEditOperationReverted's UPDATE ... SET RevertedByEditOperationID
      // statement — and editoperations.ts's revert path only calls that
      // UPDATE with the newly-inserted row's own ID (revert.ts:236/324), so
      // it is literally issued AFTER this INSERT. Rejecting this INSERT
      // therefore unambiguously targets the undo's own ledger row and
      // guarantees the mark-as-reverted UPDATE is never even attempted.
      sharedState.faultSpec = { matches: matchesLedgerInsert, failOn: 'match' };

      let caughtError: unknown = null;
      try {
        await revertEdit(cm, { ...revertInput, confirmedPlanHash });
      } catch (err) {
        caughtError = err;
      } finally {
        sharedState.faultSpec = null;
        sharedState.faultArmed = false;
      }

      // This fault only fires when matchesLedgerInsert matches a REAL
      // `INSERT INTO edit_operations` statement issued by the undo itself —
      // if the undo never reached that statement, caughtError would stay
      // null and the assertion below would fail outright, never pass by
      // accident.
      expect(caughtError, 'the confirmed undo under an injected fault must throw, never resolve').not.toBeNull();
      expect((caughtError as Error).message, 'the propagated error must be the injected fault itself, not some other error masking it').toContain(
        'Injected fault'
      );

      const after = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
      expect(
        after,
        "a failure on the undo's own ledger INSERT must still roll back every domain row the undo had already restored earlier in the same transaction"
      ).toEqual(baseline);

      const ledgerAfter = await loadEditOperationRowsForTargets(connection, allMemberIDs);
      expect(ledgerAfter, 'no revert ledger row may survive a rolled-back undo, even when the ledger INSERT itself was the failing statement').toEqual(
        ledgerBaseline
      );

      const originalRowAfter = ledgerAfter.find(row => Number(row.EditOperationID) === editOperationID);
      expect(originalRowAfter, 'the original forward ledger row must still exist after the rolled-back undo').toBeDefined();
      expect(
        originalRowAfter!.RevertedByEditOperationID,
        "the original ledger row's RevertedByEditOperationID must still be NULL — markEditOperationReverted is only called with the failed INSERT's own (never-issued) result ID, so it can never have run"
      ).toBeNull();
    });
  });

  describe('confirmed undo restores a stored SQL DATE exactly', () => {
    it('restores coremeasurements.MeasurementDate to its exact pre-apply stored value (not a timezone-shifted approximation) after a confirmed species-correction undo', async () => {
      const cm1BeforeApply = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      const preApplyMeasurementDate = cm1BeforeApply.MeasurementDate;

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO, MeasurementDate: DATE_RESTORATION_MEASUREMENT_DATE },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      const editOperationID = applyResult.editOperationID!;

      const cm1AfterApply = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      // The restore assertion below is only meaningful if the apply actually
      // moved the stored date away from its pre-apply value first.
      expect(
        cm1AfterApply.MeasurementDate,
        'the apply must actually move the stored MeasurementDate to a new value before any "restored" claim means anything'
      ).not.toEqual(preApplyMeasurementDate);

      const revertInput: RevertInput = { schema: config.database, editOperationID, createdBy: CREATED_BY_REVERT, role: ADMIN_ROLE };
      const driftError = await expectRevertDriftError(cm, revertInput);
      const confirmedResult = await revertEdit(cm, { ...revertInput, confirmedPlanHash: driftError.freshPlan.planHash });

      const cm1AfterRevert = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
      // Exact comparison against the RAW pre-apply stored value — same
      // connection/driver, no re-parsing, no loosened prefix/closeness check
      // — so a one-day timezone shift in the JSON-ISO <-> SQL DATE round
      // trip fails this exactly as it should.
      expect(
        cm1AfterRevert.MeasurementDate,
        'the confirmed undo must restore MeasurementDate to the exact pre-apply stored value, not a timezone-shifted approximation'
      ).toEqual(preApplyMeasurementDate);

      const ledgerRows = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
      const originalRow = ledgerRows.find(row => Number(row.EditOperationID) === editOperationID);
      expect(originalRow, 'the original forward ledger row must still exist after a successful confirmed undo').toBeDefined();
      expect(
        Number(originalRow!.RevertedByEditOperationID),
        "the original ledger row's RevertedByEditOperationID must equal the revert's own editOperationID"
      ).toBe(confirmedResult.editOperationID);
    });
  });

  // ---------------------------------------------------------------------
  // Real two-connection REPEATABLE READ interleaving through the public
  // applyEdit entry point. Connection A is the shared test `connection`.
  // Connection B is a separate mysql2 connection that commits its own
  // change exactly when `sharedState.postReadHook` fires: right after A's
  // first non-locking read returns its (now-stale) snapshot, and before
  // any FOR UPDATE re-read in the writer. Since `hook.run()` is awaited
  // before those rows reach the caller, B always commits before A reaches
  // a locking read — the bounded timeouts below are only a defensive
  // floor in case that assumption is ever violated.
  // ---------------------------------------------------------------------
  const CONNECTION_B_CONNECT_TIMEOUT_MS = 5000;
  const CONNECTION_B_LOCK_WAIT_TIMEOUT_SECONDS = 2;
  const APPLY_EDIT_INTERLEAVING_TEST_TIMEOUT_MS = 15000;

  const SESSION_ISOLATION_LEVEL_REPEATABLE_READ = 'REPEATABLE READ';
  const KNOWN_SESSION_TRANSACTION_ISOLATION_LEVELS: ReadonlySet<string> = new Set(['REPEATABLE READ', 'READ COMMITTED', 'READ UNCOMMITTED', 'SERIALIZABLE']);

  const CONNECTION_B_SIBLING_RAW_SPCODE = 'BCONFLICT';
  const CONNECTION_B_TARGET_DBH = 55.5;
  const CONNECTION_B_TARGET_DBH_STORED = '55.500000';
  // coremeasurements.MeasuredDBH is DECIMAL(12,6), so this sixth-decimal-only
  // divergence from the seeded DBH_CM1 (10.1) is stored exactly — it is a
  // genuine committed conflict, not a rounding artifact.
  const CONNECTION_B_TARGET_DBH_SIXTH_DECIMAL = 10.100001;
  const CONNECTION_B_TARGET_DBH_SIXTH_DECIMAL_STORED = '10.100001';
  const CONNECTION_B_SIBLING_DESCRIPTION = 'connection-b-committed-comment';
  const CONNECTION_B_SIBLING_RAW_COMMENTS = 'connection-b-committed-raw-comment';

  // MySQL reports the isolation level with a hyphen (e.g. 'REPEATABLE-READ'),
  // but `SET SESSION TRANSACTION ISOLATION LEVEL` requires a space — this is
  // the only translation needed to round-trip @@SESSION.transaction_isolation
  // back into a valid SET statement. Refuses to interpolate anything outside
  // the known four-value enum, since this string is spliced directly into a
  // SQL statement (isolation level is syntax, not a bindable parameter).
  function toSetSessionIsolationLevelClause(reportedLevel: string): string {
    const normalized = reportedLevel.replace('-', ' ').toUpperCase();
    if (!KNOWN_SESSION_TRANSACTION_ISOLATION_LEVELS.has(normalized)) {
      throw new Error(`refusing to restore unrecognized session isolation level: ${JSON.stringify(reportedLevel)}`);
    }
    return normalized;
  }

  async function readSessionIsolationLevel(conn: Connection): Promise<string> {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT @@SESSION.transaction_isolation AS level');
    return String(rows[0].level);
  }

  async function createIsolatedConnectionB(dbConfig: TestDatabaseConfig): Promise<Connection> {
    const connectionB = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      connectTimeout: CONNECTION_B_CONNECT_TIMEOUT_MS
    });
    try {
      await connectionB.query('SET SESSION innodb_lock_wait_timeout = ?', [CONNECTION_B_LOCK_WAIT_TIMEOUT_SECONDS]);
    } catch (originalError) {
      try {
        await connectionB.end();
      } catch {
        connectionB.destroy();
      }
      throw originalError;
    }
    return connectionB;
  }

  // Always-run cleanup for connection B: rollback() is harmless after a
  // commit or if no transaction was ever started, so the connection can
  // always be closed regardless of what happened above.
  async function cleanupConnectionB(connectionB: Connection | null): Promise<void> {
    if (!connectionB) return;
    try {
      await connectionB.rollback();
    } catch {
      /* best-effort: no active transaction, or already rolled back/ended */
    }
    await connectionB.end();
  }

  // Runs `body` with a freshly isolated connection B while connection A's
  // session is set to REPEATABLE READ, then tears both down independently
  // of each other and of `body`'s outcome. A failure inside `body` always
  // takes precedence over any teardown failure; teardown failures only
  // surface when `body` itself succeeded, and a failure in one teardown
  // step never prevents the other step from being attempted.
  async function withInterleavedConnectionB(body: (b: Connection) => Promise<void>): Promise<void> {
    const priorIsolationLevel = await readSessionIsolationLevel(connection);
    await connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${SESSION_ISOLATION_LEVEL_REPEATABLE_READ}`);

    let primaryError: unknown = null;
    let primaryFailed = false;
    let connectionB: Connection | null = null;
    try {
      connectionB = await createIsolatedConnectionB(config);
      await body(connectionB);
    } catch (error) {
      primaryError = error;
      primaryFailed = true;
    }

    sharedState.postReadHook = null;
    const cleanupErrors: unknown[] = [];
    try {
      await cleanupConnectionB(connectionB);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${toSetSessionIsolationLevelClause(priorIsolationLevel)}`);
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (primaryFailed) throw primaryError;
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'connection B teardown and session isolation restore both failed');
  }

  // Mirrors editoperations.ts's private `parseStateColumn` exactly: mysql2
  // may hand back a JSON column as an already-parsed array (typical for
  // this driver/column type), or as a raw string — this helper must accept
  // whichever shape the REAL driver actually returns here, not just the
  // shape the mocked ConnectionManager exercises in every other test in
  // this file.
  function parseEditOperationStateColumn(value: unknown): EditOperationStateRow[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value as EditOperationStateRow[];
    if (typeof value === 'string') {
      if (value.length === 0) return [];
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as EditOperationStateRow[]) : [];
    }
    if (typeof value === 'object') return value as unknown as EditOperationStateRow[];
    return [];
  }

  // Locates one member's own `coremeasurements` entry inside a parsed
  // before/after state array (tree-species-correction-writer.ts's
  // `buildCoreMeasurementStateRow` is the only producer of these entries:
  // table literal 'coremeasurements', primaryKeyValue the member's own
  // CoreMeasurementID).
  function findCoreMeasurementStateRow(stateRows: readonly EditOperationStateRow[], coreMeasurementID: number): EditOperationStateRow | null {
    return stateRows.find(entry => entry.table === 'coremeasurements' && Number(entry.primaryKeyValue) === coreMeasurementID) ?? null;
  }

  // Locates the species-correction metadata marker row inside a parsed
  // before/after state array (tree-species-correction-writer.ts's
  // `buildMetadataStateRow` is the only producer: table literal
  // SPECIES_CORRECTION_METADATA_TABLE, exactly one such row per state array).
  function findSpeciesCorrectionMetadataStateRow(stateRows: readonly EditOperationStateRow[]): EditOperationStateRow | null {
    return stateRows.find(entry => entry.table === SPECIES_CORRECTION_METADATA_TABLE) ?? null;
  }

  describe('real two-connection REPEATABLE READ interleaving (public applyEdit path)', () => {
    it(
      "rejects a species correction when connection B commits a conflicting RawSpCode on an active sibling after A's REPEATABLE READ snapshot was taken — the writer's locked current re-read catches this race, not an outside-the-transaction plan-hash comparison",
      async () => {
        const newRow = { SpeciesCode: SPECIES_CODE_QUERCO };

        // Preview BEFORE connection B commits anything and BEFORE the hook
        // is armed. Connection A's applyEdit re-runs analyzeEdit INSIDE its
        // own REPEATABLE READ transaction, and that transaction's snapshot
        // gets fixed by the very read the hook fires after — so that
        // internal re-analysis also sees the stale (pre-B) sibling row,
        // and its planHash equals THIS preview's hash. Passing that hash
        // as `expectedPlanHash` below is deliberate: it proves a
        // plan-hash comparison taken outside the transaction cannot see
        // this race at all (A's snapshot still shows the old row) — only
        // the writer's later FOR UPDATE replan (prepareTreeSpeciesCorrection),
        // which re-reads current committed data regardless of the
        // snapshot, can.
        const preview = await analyzeEdit(
          cm,
          config.database,
          'measurementssummary',
          fixture.plotID,
          fixture.censusID,
          fixture.coreMeasurementIDs.cm1,
          newRow,
          undefined,
          { role: ADMIN_ROLE }
        );
        expect(preview.speciesCorrection, 'fixture setup must produce a species-correction preview for this edit').toBeTruthy();
        expect(preview.planHash).toBeTruthy();

        let hookFireCount = 0;
        await withInterleavedConnectionB(async b => {
          sharedState.postReadHook = {
            matches: matchesOrdinaryTargetMeasurementRead,
            run: async () => {
              hookFireCount += 1;
              await b.beginTransaction();
              await b.execute('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [
                CONNECTION_B_SIBLING_RAW_SPCODE,
                fixture.coreMeasurementIDs.cm3
              ]);
              await b.commit();
              const [verifyRows] = await b.execute<RowDataPacket[]>('SELECT RawSpCode FROM coremeasurements WHERE CoreMeasurementID = ?', [
                fixture.coreMeasurementIDs.cm3
              ]);
              expect(verifyRows[0].RawSpCode, "connection B's own post-commit read must observe its own committed write").toBe(CONNECTION_B_SIBLING_RAW_SPCODE);
            }
          };

          let caughtError: unknown = null;
          try {
            await applyEdit(cm, {
              dataType: 'measurementssummary',
              schema: config.database,
              plotID: fixture.plotID,
              censusID: fixture.censusID,
              targetID: fixture.coreMeasurementIDs.cm1,
              newRow,
              expectedPlanHash: preview.planHash,
              createdBy: CREATED_BY_APPLY,
              role: ADMIN_ROLE
            });
          } catch (err) {
            caughtError = err;
          }

          expect(
            hookFireCount,
            "the post-read interleave hook must fire exactly once inside applyEdit's own transaction — a count of 0 means the race was never actually exercised and every assertion below would pass vacuously"
          ).toBe(1);
          expect(caughtError, 'applyEdit must reject this write, not silently succeed against a stale snapshot').not.toBeNull();
          expect(caughtError).toBeInstanceOf(SpeciesCorrectionWriteConflictError);

          // None of connection A's intended changes persisted.
          const treeRow = await loadTree(connection, fixture.treeID);
          expect(Number(treeRow.SpeciesID), "the tree's SpeciesID must remain the ORIGINAL species — A's correction never committed").toBe(
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          );
          const cm1 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
          const cm2 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
          const cm4 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
          expect(cm1.RawSpCode, 'the edited target row must keep its ORIGINAL RawSpCode — the rejected write never ran its Raw* sync').toBe(
            SPECIES_CODE_ACERRU
          );
          expect(cm2.RawSpCode).toBeNull();
          expect(cm4.RawSpCode).toBe(SPECIES_CODE_ACERRU);

          // Connection B's committed value survives EXACTLY — connection A's
          // rollback must not touch it, and A's (rejected) correction must
          // not have overwritten it either.
          const cm3 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
          expect(cm3.RawSpCode, "connection B's committed RawSpCode must survive A's rollback exactly").toBe(CONNECTION_B_SIBLING_RAW_SPCODE);

          // No correction ledger row was ever written for this rejected attempt.
          expect(await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1])).toEqual([]);
        });
      },
      APPLY_EDIT_INTERLEAVING_TEST_TIMEOUT_MS
    );

    // The sixth-decimal row exists because a 2-decimal toBeCloseTo would
    // pass vacuously on such a tiny divergence; stored values below are
    // therefore compared as exact decimal(12,6) strings, not approximations.
    it.each<[string, number, string]>([
      ['a grossly different value', CONNECTION_B_TARGET_DBH, CONNECTION_B_TARGET_DBH_STORED],
      ['a sixth-decimal-only divergence from the seeded DBH', CONNECTION_B_TARGET_DBH_SIXTH_DECIMAL, CONNECTION_B_TARGET_DBH_SIXTH_DECIMAL_STORED]
    ])(
      'rejects a species correction, before writing anything, when connection B commits %s as MeasuredDBH on the same target row alongside an accompanying field edit on that row',
      async (_magnitude, committedDBH, expectedStoredDBH) => {
        // The species correction (SpeciesCode) is accompanied by an ordinary
        // value edit (MeasuredDBH) on the SAME target row. The current-target
        // preflight (assertNoEditedFieldDriftForSpeciesCorrection) throws
        // SpeciesCorrectionWriteConflictError here — the same exported class
        // as the sibling-conflict case above, since this check is just the
        // species-correction drift guard applied to a non-species field.
        const newRow = { SpeciesCode: SPECIES_CODE_QUERCO, MeasuredDBH: ACCOMPANYING_DBH_VALUE };

        const preview = await analyzeEdit(
          cm,
          config.database,
          'measurementssummary',
          fixture.plotID,
          fixture.censusID,
          fixture.coreMeasurementIDs.cm1,
          newRow,
          undefined,
          { role: ADMIN_ROLE }
        );
        expect(preview.speciesCorrection).toBeTruthy();
        expect(
          preview.fieldChanges.some(fc => fc.field === 'MeasuredDBH'),
          'the preview must register MeasuredDBH as an edited field, otherwise the current-target drift preflight this test exercises would never actually run'
        ).toBe(true);
        expect(preview.planHash).toBeTruthy();

        let hookFireCount = 0;
        await withInterleavedConnectionB(async b => {
          sharedState.postReadHook = {
            matches: matchesOrdinaryTargetMeasurementRead,
            run: async () => {
              hookFireCount += 1;
              await b.beginTransaction();
              await b.execute('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [committedDBH, fixture.coreMeasurementIDs.cm1]);
              await b.commit();
              const [verifyRows] = await b.execute<RowDataPacket[]>('SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?', [
                fixture.coreMeasurementIDs.cm1
              ]);
              expect(String(verifyRows[0].MeasuredDBH), "connection B's own post-commit read must observe its own committed DBH exactly").toBe(
                expectedStoredDBH
              );
            }
          };

          let caughtError: unknown = null;
          try {
            await applyEdit(cm, {
              dataType: 'measurementssummary',
              schema: config.database,
              plotID: fixture.plotID,
              censusID: fixture.censusID,
              targetID: fixture.coreMeasurementIDs.cm1,
              newRow,
              expectedPlanHash: preview.planHash,
              createdBy: CREATED_BY_APPLY,
              role: ADMIN_ROLE
            });
          } catch (err) {
            caughtError = err;
          }

          expect(
            hookFireCount,
            "the post-read interleave hook must fire exactly once inside applyEdit's own transaction — a count of 0 means the race was never actually exercised"
          ).toBe(1);
          expect(caughtError, 'applyEdit must refuse this write BEFORE mutating anything, not silently overwrite a concurrently committed DBH').not.toBeNull();
          expect(caughtError).toBeInstanceOf(SpeciesCorrectionWriteConflictError);

          // Connection B's committed DBH survives EXACTLY — an exact string
          // comparison on the decimal(12,6) column, since toBeCloseTo would
          // pass vacuously for the sixth-decimal-only row above.
          const cm1 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
          expect(String(cm1.MeasuredDBH), "connection B's committed MeasuredDBH must survive A's rollback exactly").toBe(expectedStoredDBH);

          // No write of ANY kind landed: tree species, every member's
          // RawSpCode, and the ledger are all exactly as before.
          const treeRow = await loadTree(connection, fixture.treeID);
          expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);
          expect(cm1.RawSpCode).toBe(SPECIES_CODE_ACERRU);
          const cm2 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
          const cm3 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
          const cm4 = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
          expect(cm2.RawSpCode).toBeNull();
          expect(cm3.RawSpCode).toBe('acerru');
          expect(cm4.RawSpCode).toBe(SPECIES_CODE_ACERRU);

          expect(await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1])).toEqual([]);
        });
      },
      APPLY_EDIT_INTERLEAVING_TEST_TIMEOUT_MS
    );

    interface SiblingInterleaveRaceCase {
      readonly title: string;
      readonly siblingKey: 'cm3' | 'cm4';
      readonly isNoOpSibling: boolean;
      readonly beforePreviewSetup?: (connection: Connection, fixture: SpeciesCorrectionFixture) => Promise<void>;
    }

    // Row 2 pins the #427 no-op-update regression: pre-seeding cm4's
    // RawSpCode to the correction's OWN destination code makes the writer's
    // canonical RawSpCode UPDATE on cm4 a genuine no-op (matched=1,
    // changed=0), which under REPEATABLE READ never advances A's read view
    // for that row — only a FOR UPDATE after-snapshot, not a plain SELECT,
    // can then observe B's current comment there.
    const NO_OP_SIBLING_COMMENT_OMIT_COLUMNS = ['Description', 'RawComments'] as const;

    const siblingInterleaveRaceCases: readonly SiblingInterleaveRaceCase[] = [
      {
        title:
          "connection B commits an unrelated Description/RawComments change on an ACTIVE sibling whose own RawSpCode genuinely changes after A's REPEATABLE READ snapshot was taken — the writer's locked sibling snapshot reads current committed data, not A's stale snapshot",
        siblingKey: 'cm3',
        isNoOpSibling: false
      },
      {
        title:
          "connection B commits an unrelated Description/RawComments change on the INACTIVE sibling whose own correction UPDATE is itself a no-op (matched=1, changed=0) after A's REPEATABLE READ snapshot was taken — a no-op UPDATE never advances A's REPEATABLE READ view for that row, so only the writer's locked (FOR UPDATE) after-snapshot read, not a plain SELECT, can observe B's current comment",
        siblingKey: 'cm4',
        isNoOpSibling: true,
        beforePreviewSetup: async (connection, fixture) => {
          // Pre-seed the correction's OWN destination code so the writer's
          // canonical RawSpCode UPDATE on cm4 below is a genuine no-op.
          await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [
            SPECIES_CODE_QUERCO,
            fixture.coreMeasurementIDs.cm4
          ]);
        }
      }
    ];

    it.each<SiblingInterleaveRaceCase>(siblingInterleaveRaceCases)(
      "succeeds, and records B's current comment in both ledger states, when $title",
      async scenario => {
        const { siblingKey, isNoOpSibling, beforePreviewSetup } = scenario;
        if (beforePreviewSetup) await beforePreviewSetup(connection, fixture);
        const touchedCoreMeasurementID = fixture.coreMeasurementIDs[siblingKey];

        const newRow = { SpeciesCode: SPECIES_CODE_QUERCO };

        // Same reasoning as the two tests above: take the preview before
        // arming the hook. Because B's change here touches neither
        // RawSpCode nor any field the drift guards compare, A's internal
        // replan sees no drift at all — this edit is expected to SUCCEED,
        // and expectedPlanHash is passed to prove the hash comparison
        // genuinely agrees (no spurious HashDriftError), not to prove a
        // conflict (there is none to catch here).
        const preview = await analyzeEdit(
          cm,
          config.database,
          'measurementssummary',
          fixture.plotID,
          fixture.censusID,
          fixture.coreMeasurementIDs.cm1,
          newRow,
          undefined,
          { role: ADMIN_ROLE }
        );
        expect(preview.speciesCorrection).toBeTruthy();
        expect(preview.planHash).toBeTruthy();

        // Captured on the real connection via a plain (pre-transaction,
        // autocommit) read — the true original fixture values for every
        // member, used below to prove the ones B does NOT touch in THIS
        // row come out of the correction with every unrelated column
        // preserved. Loaded for all four so either row can treat either of
        // cm3/cm4 as the one member B actually touches.
        const cm1Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
        const cm2Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
        const cm3Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
        const cm4Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
        const touchedBeforeErrorLog = await loadMeasurementErrorLog(connection, touchedCoreMeasurementID);

        let hookFireCount = 0;
        await withInterleavedConnectionB(async b => {
          sharedState.postReadHook = {
            matches: matchesOrdinaryTargetMeasurementRead,
            run: async () => {
              hookFireCount += 1;
              await b.beginTransaction();
              await b.execute('UPDATE coremeasurements SET Description = ?, RawComments = ? WHERE CoreMeasurementID = ?', [
                CONNECTION_B_SIBLING_DESCRIPTION,
                CONNECTION_B_SIBLING_RAW_COMMENTS,
                touchedCoreMeasurementID
              ]);
              await b.commit();
              const [verifyRows] = await b.execute<RowDataPacket[]>('SELECT Description, RawComments FROM coremeasurements WHERE CoreMeasurementID = ?', [
                touchedCoreMeasurementID
              ]);
              expect(verifyRows[0].Description, "connection B's own post-commit read must observe its own committed Description").toBe(
                CONNECTION_B_SIBLING_DESCRIPTION
              );
              expect(verifyRows[0].RawComments, "connection B's own post-commit read must observe its own committed RawComments").toBe(
                CONNECTION_B_SIBLING_RAW_COMMENTS
              );
            }
          };

          // Must SUCCEED — no try/catch: if applyEdit rejects, the test
          // fails here with that rejection, which is exactly the desired
          // failure mode (this edit has no legitimate conflict to reject).
          await applyEdit(cm, {
            dataType: 'measurementssummary',
            schema: config.database,
            plotID: fixture.plotID,
            censusID: fixture.censusID,
            targetID: fixture.coreMeasurementIDs.cm1,
            newRow,
            expectedPlanHash: preview.planHash,
            createdBy: CREATED_BY_APPLY,
            role: ADMIN_ROLE
          });

          expect(
            hookFireCount,
            "the post-read interleave hook must fire exactly once inside applyEdit's own transaction — a count of 0 means the race was never actually exercised"
          ).toBe(1);

          // The correction itself still lands correctly tree-wide.
          const treeRow = await loadTree(connection, fixture.treeID);
          expect(Number(treeRow.SpeciesID)).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);
          const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
          const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
          const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
          const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);
          expect(cm1After.RawSpCode).toBe(SPECIES_CODE_QUERCO);
          expect(cm2After.RawSpCode).toBe(SPECIES_CODE_QUERCO);
          expect(cm3After.RawSpCode).toBe(SPECIES_CODE_QUERCO);
          expect(cm4After.RawSpCode).toBe(SPECIES_CODE_QUERCO);

          // Members B never touched come out byte-identical except the two
          // columns any species-only correction is allowed to change.
          expect(omitColumns(cm1After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
            omitColumns(cm1Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
          );
          expect(omitColumns(cm2After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
            omitColumns(cm2Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
          );
          if (siblingKey !== 'cm3') {
            expect(omitColumns(cm3After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
              omitColumns(cm3Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
            );
          }
          if (siblingKey !== 'cm4') {
            expect(omitColumns(cm4After, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
              omitColumns(cm4Before, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
            );
          }

          // --- Ledger: exactly one correction row, and BOTH its recorded
          // before/after states for the touched sibling carry B's CURRENT
          // comment — not the stale pre-B value connection A's own snapshot
          // read saw. ---
          const editOperationRows = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
          expect(editOperationRows, 'exactly one correction ledger row must be recorded for this applyEdit call').toHaveLength(1);
          const beforeState = parseEditOperationStateColumn(editOperationRows[0].BeforeState);
          const afterState = parseEditOperationStateColumn(editOperationRows[0].AfterState);

          const touchedBeforeStateRow = findCoreMeasurementStateRow(beforeState, touchedCoreMeasurementID);
          const touchedAfterStateRow = findCoreMeasurementStateRow(afterState, touchedCoreMeasurementID);
          expect(touchedBeforeStateRow, 'the touched sibling must have its own recorded before-state row in the ledger').not.toBeNull();
          expect(touchedAfterStateRow, 'the touched sibling must have its own recorded after-state row in the ledger').not.toBeNull();

          // The invariant under test: the writer's locked (FOR UPDATE)
          // sibling snapshot — taken in prepareTreeSpeciesCorrection,
          // strictly AFTER the hook let connection B commit — reads
          // CURRENT committed data. So EVEN THE "before" ledger state
          // already reflects B's commit, which lands temporally between
          // connection A's snapshot-establishing read and this locked
          // re-read.
          expect(
            touchedBeforeStateRow!.row!.Description,
            "ledger BEFORE-state for the touched sibling must carry connection B's CURRENT comment, not the stale pre-B snapshot value — proving the sibling snapshot is a locked, current read"
          ).toBe(CONNECTION_B_SIBLING_DESCRIPTION);
          expect(touchedBeforeStateRow!.row!.RawComments).toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);

          if (!isNoOpSibling) {
            // --- cm3: an ACTIVE sibling whose RawSpCode genuinely changes
            // — every assertion below is unchanged from the original
            // single-row forward-race test. ---
            expect(cm3After.RawSpCode, 'the sibling species correction must still apply even though B edited an unrelated field on this exact row').toBe(
              SPECIES_CODE_QUERCO
            );
            expect(cm3After.Description, "connection B's committed Description must survive the correction verbatim").toBe(CONNECTION_B_SIBLING_DESCRIPTION);
            expect(cm3After.RawComments, "connection B's committed RawComments must survive the correction verbatim").toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);
            expect(Number(cm3After.MeasuredDBH)).toBeCloseTo(DBH_CM3, 2);
            expect(cm3After.RawTreeTag).toBe(TREE_TAG_SCT1);
            expect(cm3After.RawStemTag).toBe(STEM_TAG_S2);
            expect(cm3After.RawQuadrat).toBe(QUADRAT_NAME_A);
            expect(Number(cm3After.RawX)).toBeCloseTo(STEM_X + 1, 6);
            expect(Number(cm3After.RawY)).toBeCloseTo(STEM_Y + 1, 6);

            expect(touchedAfterStateRow!.row!.Description, "ledger AFTER-state for cm3 must also carry connection B's CURRENT comment").toBe(
              CONNECTION_B_SIBLING_DESCRIPTION
            );
            expect(touchedAfterStateRow!.row!.RawComments).toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);

            // The correction's own effect on cm3 is captured correctly either
            // side of it: RawSpCode moves from the original differently-cased
            // spelling to the canonical corrected code.
            expect(touchedBeforeStateRow!.row!.RawSpCode).toBe('acerru');
            expect(touchedAfterStateRow!.row!.RawSpCode).toBe(SPECIES_CODE_QUERCO);

            // Every OTHER persisted column on cm3's ledger row is identical
            // before vs after — only {RawSpCode, IsValidated} may differ,
            // the exact same omit list every live-row comparison above uses.
            expect(omitColumns(touchedAfterStateRow!.row!, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)).toEqual(
              omitColumns(touchedBeforeStateRow!.row!, COREMEASUREMENT_SPECIES_CORRECTION_OMIT_COLUMNS)
            );
          } else {
            // --- cm4: the INACTIVE sibling whose own correction UPDATE is
            // a genuine no-op (RawSpCode pre-seeded to the destination code
            // above). This is the #427 regression this row pins. ---
            expect(
              touchedAfterStateRow!.row!.Description,
              "ledger AFTER-state for cm4 must ALSO carry connection B's CURRENT comment — a plain (non-FOR UPDATE) after-snapshot read would have recorded the STALE pre-interleave comment here instead, since cm4's own RawSpCode UPDATE never advanced A's REPEATABLE READ view for this no-op row; this is precisely the regression being pinned"
            ).toBe(CONNECTION_B_SIBLING_DESCRIPTION);
            expect(touchedAfterStateRow!.row!.RawComments).toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);

            // cm4's own RawSpCode was ALREADY the destination code
            // (beforePreviewSetup above), so the correction's UPDATE on it
            // is a no-op — both ledger states show it unchanged.
            expect(touchedBeforeStateRow!.row!.RawSpCode).toBe(SPECIES_CODE_QUERCO);
            expect(touchedAfterStateRow!.row!.RawSpCode).toBe(SPECIES_CODE_QUERCO);

            // Only {Description, RawComments} may differ on cm4's ledger row
            // before vs after — RawSpCode/IsValidated/every other column,
            // including the ones the standard omit list would normally
            // hide, must stay byte-identical, proving nothing but B's own
            // edit moved.
            expect(omitColumns(touchedAfterStateRow!.row!, NO_OP_SIBLING_COMMENT_OMIT_COLUMNS)).toEqual(
              omitColumns(touchedBeforeStateRow!.row!, NO_OP_SIBLING_COMMENT_OMIT_COLUMNS)
            );

            // Live row: B's comment survives verbatim, and every other
            // column — RawSpCode (still the destination code), IsValidated,
            // IsActive, StemGUID, position/raw identity — stays exactly as
            // it was, proving the correction's own UPDATE here really was a
            // matched=1, changed=0 no-op.
            expect(cm4After.Description, "connection B's committed Description must survive the correction verbatim").toBe(CONNECTION_B_SIBLING_DESCRIPTION);
            expect(cm4After.RawComments, "connection B's committed RawComments must survive the correction verbatim").toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);
            expect(omitColumns(cm4After, NO_OP_SIBLING_COMMENT_OMIT_COLUMNS)).toEqual(omitColumns(cm4Before, NO_OP_SIBLING_COMMENT_OMIT_COLUMNS));

            expect(
              decodeBitFlag(cm4After.IsValidated),
              'cm4 is INACTIVE, so resetValidationPending must never touch its IsValidated — it must stay exactly as seeded, unlike an active sibling'
            ).toBe(decodeBitFlag(cm4Before.IsValidated));
            expect(Number(cm4After.IsActive), 'cm4 must stay INACTIVE — this correction never reactivates an inactive member').toBe(0);
            expect(Number(cm4After.StemGUID), "cm4's StemGUID must still point at the inactive stem it was seeded on").toBe(fixture.stemGUIDs.s3);
            const s3AfterCorrection = await loadStem(connection, fixture.stemGUIDs.s3);
            expect(Number(s3AfterCorrection.TreeID), 'the inactive stem cm4 lives on must still belong to the corrected tree').toBe(fixture.treeID);

            const touchedAfterErrorLog = await loadMeasurementErrorLog(connection, touchedCoreMeasurementID);
            expect(touchedAfterErrorLog, "cm4's measurement_error_log / science state must stay completely untouched by this no-op correction").toEqual(
              touchedBeforeErrorLog
            );
          }
        });
      },
      APPLY_EDIT_INTERLEAVING_TEST_TIMEOUT_MS
    );

    // F32 regression: every snapshot read the species-correction UNDO path
    // issues (preflightSpeciesCorrectionUndo -> planSpeciesCorrection with
    // forUpdate:true, plus writeSpeciesCorrectionUndo's own before/after
    // reads) is now FOR UPDATE, exactly like the forward writer above. This
    // mirrors that forward test, but for revertEdit: connection B commits an
    // unrelated sibling edit immediately after A's confirmed-undo
    // transaction begins (via postBeginTransactionHook — the undo path has
    // no non-locking read to hang a postReadHook off). The hook also takes
    // two plain (non-locking) reads on A itself, straddling B's commit, to
    // prove A's own REPEATABLE READ snapshot goes stale — so the undo's
    // ledger recording B's CURRENT values afterward can only be explained by
    // its snapshot reads being FOR UPDATE, not by A's snapshot never having
    // gone stale in the first place.
    it(
      "succeeds, and preserves B's current comment in both the DB and the undo's own ledger states, when connection B commits an unrelated Description/RawComments change on an active sibling immediately after A's confirmed-undo transaction begins — every undo snapshot read is FOR UPDATE (F32), so it reads current committed data, not a stale snapshot",
      async () => {
        const cm3Before = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);

        // Real, unfaulted forward correction — no hook armed yet.
        const applyResult = await applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: null,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        });
        const forwardEditOperationID = applyResult.editOperationID!;

        // Real, unfaulted drift-confirmation handshake — also no hook armed.
        // A species-correction undo always requires an explicit confirmed
        // hash (revert.ts), regardless of whether anything has actually
        // drifted yet.
        const revertInput: RevertInput = {
          schema: config.database,
          editOperationID: forwardEditOperationID,
          createdBy: CREATED_BY_REVERT,
          role: ADMIN_ROLE
        };
        const driftError = await expectRevertDriftError(cm, revertInput);
        const confirmedPlanHash = driftError.freshPlan.planHash;

        let hookFireCount = 0;
        await withInterleavedConnectionB(async b => {
          try {
            sharedState.postBeginTransactionHook = async () => {
              hookFireCount += 1;

              // Plain (non-locking) read through A's own real connection,
              // BEFORE B's transaction starts. Under REPEATABLE READ this is
              // what ESTABLISHES A's snapshot (snapshots are created on the
              // first consistent read, not on BEGIN) — without it, B's later
              // commit could never make A's snapshot stale, and the whole
              // race below would be meaningless.
              const [preInterleaveRows] = await connection.execute<RowDataPacket[]>(
                'SELECT Description, RawComments FROM coremeasurements WHERE CoreMeasurementID = ?',
                [fixture.coreMeasurementIDs.cm3]
              );
              expect(
                preInterleaveRows[0].Description,
                "A's pre-interleave read must see cm3's ORIGINAL Description — this read is what establishes A's REPEATABLE READ snapshot"
              ).toBe(cm3Before.Description);
              expect(
                preInterleaveRows[0].RawComments,
                "A's pre-interleave read must see cm3's ORIGINAL RawComments — this read is what establishes A's REPEATABLE READ snapshot"
              ).toBe(cm3Before.RawComments);

              await b.beginTransaction();
              await b.execute('UPDATE coremeasurements SET Description = ?, RawComments = ? WHERE CoreMeasurementID = ?', [
                CONNECTION_B_SIBLING_DESCRIPTION,
                CONNECTION_B_SIBLING_RAW_COMMENTS,
                fixture.coreMeasurementIDs.cm3
              ]);
              await b.commit();
              const [verifyRows] = await b.execute<RowDataPacket[]>('SELECT Description, RawComments FROM coremeasurements WHERE CoreMeasurementID = ?', [
                fixture.coreMeasurementIDs.cm3
              ]);
              expect(verifyRows[0].Description, "connection B's own post-commit read must observe its own committed Description").toBe(
                CONNECTION_B_SIBLING_DESCRIPTION
              );
              expect(verifyRows[0].RawComments, "connection B's own post-commit read must observe its own committed RawComments").toBe(
                CONNECTION_B_SIBLING_RAW_COMMENTS
              );

              // Second plain read on A, AFTER B committed and verified. A
              // must still see the ORIGINAL (pre-interleave) values here —
              // proving A is genuinely holding a stale REPEATABLE READ
              // snapshot at the exact moment the public undo proceeds. The
              // later assertions showing the undo observed B's CURRENT
              // values therefore can only be explained by the undo's own
              // snapshot reads being FOR UPDATE (locked, current reads),
              // not by A's snapshot having stayed fresh on its own.
              const [staleRows] = await connection.execute<RowDataPacket[]>(
                'SELECT Description, RawComments FROM coremeasurements WHERE CoreMeasurementID = ?',
                [fixture.coreMeasurementIDs.cm3]
              );
              expect(
                staleRows[0].Description,
                "A's REPEATABLE READ snapshot must still show cm3's ORIGINAL Description after B's commit — proving A's snapshot is genuinely stale, so the undo's later observation of B's CURRENT value can only come from a FOR UPDATE read"
              ).toBe(cm3Before.Description);
              expect(
                staleRows[0].RawComments,
                "A's REPEATABLE READ snapshot must still show cm3's ORIGINAL RawComments after B's commit — proving A's snapshot is genuinely stale, so the undo's later observation of B's CURRENT value can only come from a FOR UPDATE read"
              ).toBe(cm3Before.RawComments);
            };

            // Must SUCCEED — no try/catch around the call itself: Description/
            // RawComments are excluded from the species-correction drift
            // comparison, so confirmedPlanHash stays valid despite B's change.
            // If this throws, the test fails here with the real error.
            const confirmedResult = await revertEdit(cm, { ...revertInput, confirmedPlanHash });

            expect(
              hookFireCount,
              'the post-beginTransaction interleave hook must fire exactly once inside the confirmed revertEdit transaction — a count of 0 means the race was never actually exercised and every assertion below would pass vacuously'
            ).toBe(1);

            // --- The undo itself completed correctly. ---
            const treeRow = await loadTree(connection, fixture.treeID);
            expect(Number(treeRow.SpeciesID), "the tree's SpeciesID must be restored to the ORIGINAL species").toBe(fixture.speciesIDs[SPECIES_CODE_ACERRU]);

            const cm1After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm1);
            const cm2After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm2);
            const cm3After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm3);
            const cm4After = await loadCoreMeasurement(connection, fixture.coreMeasurementIDs.cm4);

            expect(cm1After.RawSpCode, 'cm1 must be restored to its original RawSpCode').toBe(SPECIES_CODE_ACERRU);
            expect(cm2After.RawSpCode, "cm2's original NULL RawSpCode must be restored verbatim, not coerced to a string").toBeNull();
            expect(cm3After.RawSpCode, 'cm3 must be restored to its original, differently-cased spelling').toBe(cm3Before.RawSpCode);
            expect(cm4After.RawSpCode, 'cm4 must be restored to its original RawSpCode').toBe(SPECIES_CODE_ACERRU);

            expect(Number(cm1After.StemGUID), "cm1's StemGUID must be unchanged by the undo").toBe(fixture.stemGUIDs.s1);
            expect(Number(cm2After.StemGUID), "cm2's StemGUID must be unchanged by the undo").toBe(fixture.stemGUIDs.s1);
            expect(Number(cm3After.StemGUID), "cm3's StemGUID must be unchanged by the undo").toBe(fixture.stemGUIDs.s2);
            expect(Number(cm4After.StemGUID), "cm4's StemGUID must be unchanged by the undo").toBe(fixture.stemGUIDs.s3);
            const s2After = await loadStem(connection, fixture.stemGUIDs.s2);
            expect(Number(s2After.TreeID), "cm3's stem must still belong to the ORIGINAL TreeID after the undo").toBe(fixture.treeID);

            // The sparse writer never touches Description/RawComments, so
            // these DB-level columns stay at B's committed values regardless
            // of whether the undo's own reads were stale or current — this
            // is baseline live-data preservation, not the F32 regression
            // itself. The real regression this test targets is the undo's
            // own LEDGER snapshot honesty, asserted further below.
            expect(cm3After.Description, "connection B's committed Description must still be present on cm3 after the undo").toBe(
              CONNECTION_B_SIBLING_DESCRIPTION
            );
            expect(cm3After.RawComments, "connection B's committed RawComments must still be present on cm3 after the undo").toBe(
              CONNECTION_B_SIBLING_RAW_COMMENTS
            );

            // Every other unrelated column on cm3 is exactly as it was before
            // this whole forward-apply/undo cycle ever began.
            expect(cm3After.RawTreeTag).toBe(cm3Before.RawTreeTag);
            expect(cm3After.RawStemTag).toBe(cm3Before.RawStemTag);
            expect(cm3After.RawQuadrat).toBe(cm3Before.RawQuadrat);
            expect(Number(cm3After.RawX)).toBeCloseTo(Number(cm3Before.RawX), 6);
            expect(Number(cm3After.RawY)).toBeCloseTo(Number(cm3Before.RawY), 6);
            expect(Number(cm3After.MeasuredDBH)).toBeCloseTo(Number(cm3Before.MeasuredDBH), 2);

            // --- Ledger: the UNDO's OWN row (located by its own
            // editOperationID, not the forward row) must carry B's CURRENT
            // comment on BOTH its before- and after-state sides. ---
            const ledgerRows = await loadEditOperationRowsForTargets(connection, [fixture.coreMeasurementIDs.cm1]);
            const undoRow = ledgerRows.find(row => Number(row.EditOperationID) === confirmedResult.editOperationID);
            expect(undoRow, "the undo's own ledger row must exist, located by the editOperationID revertEdit returned").toBeDefined();

            const undoBeforeState = parseEditOperationStateColumn(undoRow!.BeforeState);
            const undoAfterState = parseEditOperationStateColumn(undoRow!.AfterState);
            const cm3UndoBeforeRow = findCoreMeasurementStateRow(undoBeforeState, fixture.coreMeasurementIDs.cm3);
            const cm3UndoAfterRow = findCoreMeasurementStateRow(undoAfterState, fixture.coreMeasurementIDs.cm3);
            expect(cm3UndoBeforeRow, "the undo's own ledger row must have a before-state entry for cm3").not.toBeNull();
            expect(cm3UndoAfterRow, "the undo's own ledger row must have an after-state entry for cm3").not.toBeNull();

            expect(
              cm3UndoBeforeRow!.row!.Description,
              "the undo's own ledger BEFORE-state for cm3 must carry connection B's CURRENT comment, not A's stale pre-interleave snapshot value — proving the undo's snapshot reads are locked, current reads (F32)"
            ).toBe(CONNECTION_B_SIBLING_DESCRIPTION);
            expect(cm3UndoBeforeRow!.row!.RawComments).toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);
            expect(cm3UndoAfterRow!.row!.Description, "the undo's own ledger AFTER-state for cm3 must also carry connection B's CURRENT comment").toBe(
              CONNECTION_B_SIBLING_DESCRIPTION
            );
            expect(cm3UndoAfterRow!.row!.RawComments).toBe(CONNECTION_B_SIBLING_RAW_COMMENTS);

            // The forward ledger row's own RevertedByEditOperationID must
            // link to this undo, not to some other editOperationID.
            const forwardRow = ledgerRows.find(row => Number(row.EditOperationID) === forwardEditOperationID);
            expect(forwardRow, 'the original forward ledger row must still exist after a successful confirmed undo').toBeDefined();
            expect(
              Number(forwardRow!.RevertedByEditOperationID),
              "the forward ledger row's RevertedByEditOperationID must equal the undo's own editOperationID"
            ).toBe(confirmedResult.editOperationID);
          } finally {
            sharedState.postBeginTransactionHook = null;
          }
        });
      },
      APPLY_EDIT_INTERLEAVING_TEST_TIMEOUT_MS
    );
  });

  // =========================================================================
  // Hard undo drift (#427): a confirmed undo whose confirmedPlanHash was
  // legitimately valid WHEN COMPUTED must still be rejected — with a
  // specific typed, attributable error — if exactly one piece of relevant
  // state changes between that computation and the confirmed retry.
  // =========================================================================
  describe('hard undo drift: confirmation must not waive substantive post-correction state change', () => {
    // A single state-drift dimension a confirmed species-correction undo
    // must detect: the one SQL mutation the row applies, and the specific
    // typed error/conflict kind that mutation must produce.
    interface HardUndoDriftScenario {
      readonly title: string;
      readonly newRow: Record<string, unknown>;
      readonly driftState: (connection: Connection, fixture: SpeciesCorrectionFixture) => Promise<void>;
      // Teardown for rows that drift a SHARED catalog row (species/attributes)
      // beforeEach never resets; restores the value driftState itself captured.
      readonly restoreState?: (connection: Connection, fixture: SpeciesCorrectionFixture) => Promise<void>;
      readonly expectedErrorClass: typeof SpeciesCorrectionUndoCurrentStateConflictError | typeof SpeciesCorrectionUndoUnapplicableError;
      readonly expectedConflictKind: SpeciesCorrectionUndoConflictKind | null;
    }

    const HARD_UNDO_DRIFT_RAW_SPCODE = 'ZZDRIFTED';
    // ACCOMPANYING_DBH_VALUE (20.5) plus one unit at the 6th decimal; the
    // target column is decimal(12,6), so this is stored exactly, never
    // rounded away — the point of this row is precision, not magnitude.
    const HARD_UNDO_DRIFT_DBH_SIXTH_DECIMAL_VALUE = 20.500001;
    const HARD_UNDO_DRIFT_STEM_PLOT_X = 150.654321;
    // A code guaranteed never to collide with any seeded species.SpeciesCode —
    // row 6 renames ACERRU to this after the correction, then restores it.
    const HARD_UNDO_DRIFT_RENAMED_SPECIES_CODE = 'ZZ-DRIFT-RENAMED-ACERRU';

    // Rows 6/7/8 mutate a SHARED catalog row beforeEach never resets; each
    // captures the row's real pre-mutation value here (in driftState) so its
    // sibling restoreState can put back the ACTUAL value, not an assumption.
    let hardUndoDriftCapturedOriginalSpeciesCode: string | null = null;
    let hardUndoDriftCapturedOriginalSpeciesIsActive: number | null = null;
    let hardUndoDriftCapturedAliveAttributeIsActive: number | null = null;

    const hardUndoDriftScenarios: HardUndoDriftScenario[] = [
      {
        title: 'a previously inactive sibling stem (S3) becomes active after the correction was applied',
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        driftState: async (connection, fixture) => {
          await connection.query('UPDATE stems SET IsActive = 1 WHERE StemGUID = ?', [fixture.stemGUIDs.s3]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'stem-membership'
      },
      {
        title: "a sibling member's (CM3) RawSpCode is changed by hand after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        driftState: async (connection, fixture) => {
          await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [
            HARD_UNDO_DRIFT_RAW_SPCODE,
            fixture.coreMeasurementIDs.cm3
          ]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'raw-species-code'
      },
      {
        title: "the target's (CM1) accompanying MeasuredDBH drifts by a sixth decimal after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO, MeasuredDBH: ACCOMPANYING_DBH_VALUE },
        driftState: async (connection, fixture) => {
          await connection.query('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [
            HARD_UNDO_DRIFT_DBH_SIXTH_DECIMAL_VALUE,
            fixture.coreMeasurementIDs.cm1
          ]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'changed-stored-field'
      },
      {
        title: "the shared stem's (S1) accompanying PlotX coordinate drifts after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO, StemPlotX: ACCOMPANYING_PLOT_X },
        driftState: async (connection, fixture) => {
          await connection.query('UPDATE stems SET PlotX = ? WHERE StemGUID = ?', [HARD_UNDO_DRIFT_STEM_PLOT_X, fixture.stemGUIDs.s1]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'changed-stored-field'
      },
      {
        // species-correction-undo.ts:452-457 — currentAttributeCodes no
        // longer matches the recorded afterState attribute codes.
        title: "CM1's (the edited measurement) attribute-code associations gain an extra code after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO, Attributes: ACCOMPANYING_ATTR_CODE },
        driftState: async (connection, fixture) => {
          await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [fixture.coreMeasurementIDs.cm1, ATTR_CODE_ALIVE]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'attribute-associations'
      },
      {
        // species-correction-undo.ts:353-358 — the reverse destination's
        // current SpeciesCode (re-read by ID) no longer matches the recorded
        // beforeState code; refused as unapplicable, not a drift conflict.
        title: "the restore-target species (ACERRU, this tree's original species) is renamed in the shared species catalog after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        driftState: async (connection, fixture) => {
          const [rows] = await connection.query<RowDataPacket[]>('SELECT SpeciesCode FROM species WHERE SpeciesID = ? LIMIT 1', [
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          ]);
          hardUndoDriftCapturedOriginalSpeciesCode = rows[0].SpeciesCode as string;
          await connection.query('UPDATE species SET SpeciesCode = ? WHERE SpeciesID = ?', [
            HARD_UNDO_DRIFT_RENAMED_SPECIES_CODE,
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          ]);
        },
        restoreState: async (connection, fixture) => {
          await connection.query('UPDATE species SET SpeciesCode = ? WHERE SpeciesID = ?', [
            hardUndoDriftCapturedOriginalSpeciesCode,
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          ]);
        },
        expectedErrorClass: SpeciesCorrectionUndoUnapplicableError,
        expectedConflictKind: null
      },
      {
        // tree-species-correction.ts:255-261 'destination_species_inactive'
        // -> species-correction-undo.ts:182-193 classifies it 'unapplicable'
        // -> thrown at species-correction-undo.ts:341-343.
        title:
          "the restore-target species (ACERRU, this tree's original species) is deactivated in the shared species catalog after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        driftState: async (connection, fixture) => {
          const [rows] = await connection.query<RowDataPacket[]>('SELECT IsActive FROM species WHERE SpeciesID = ? LIMIT 1', [
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          ]);
          hardUndoDriftCapturedOriginalSpeciesIsActive = Number(rows[0].IsActive);
          await connection.query('UPDATE species SET IsActive = 0 WHERE SpeciesID = ?', [fixture.speciesIDs[SPECIES_CODE_ACERRU]]);
        },
        restoreState: async (connection, fixture) => {
          await connection.query('UPDATE species SET IsActive = ? WHERE SpeciesID = ?', [
            hardUndoDriftCapturedOriginalSpeciesIsActive,
            fixture.speciesIDs[SPECIES_CODE_ACERRU]
          ]);
        },
        expectedErrorClass: SpeciesCorrectionUndoUnapplicableError,
        expectedConflictKind: null
      },
      {
        // species-correction-undo.ts:462-475 — codesToRestore=['A'] (CM1's
        // pre-apply association, seeded by the universal pre-seed below) has
        // no active 'attributes' row left to restore from -> missingCodes=['A'].
        title:
          "an attribute code (ALIVE) CM1's (the edited measurement) undo must restore is deactivated in the shared attributes catalog after the correction was applied",
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO, Attributes: ACCOMPANYING_ATTR_CODE },
        driftState: async connection => {
          const [rows] = await connection.query<RowDataPacket[]>('SELECT IsActive FROM attributes WHERE Code = ? AND IsActive = 1 LIMIT 1', [ATTR_CODE_ALIVE]);
          expect(
            rows,
            'the shared attributes catalog must contain an active ALIVE row for this drift row to mean anything — an empty result means the fixture itself is broken, not that drift was detected'
          ).toHaveLength(1);
          hardUndoDriftCapturedAliveAttributeIsActive = Number(rows[0].IsActive);
          await connection.query('UPDATE attributes SET IsActive = 0 WHERE Code = ? AND IsActive = 1', [ATTR_CODE_ALIVE]);
        },
        restoreState: async connection => {
          await connection.query('UPDATE attributes SET IsActive = ? WHERE Code = ? AND IsActive = 0', [
            hardUndoDriftCapturedAliveAttributeIsActive,
            ATTR_CODE_ALIVE
          ]);
        },
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'missing-attribute-reference'
      },
      {
        // tree-species-correction.ts:276-297 'destination_exists' ->
        // species-correction-undo.ts:161-168 classifies it the
        // 'destination-collision' conflict kind.
        title: 'a destination tree collision (TreeTag SCT1 under the original species ACERRU) appears after the correction was applied',
        newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
        driftState: async (connection, fixture) => {
          await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
            TREE_TAG_SCT1,
            fixture.speciesIDs[SPECIES_CODE_ACERRU],
            fixture.censusID
          ]);
        },
        // No restoreState: `trees` is DELETEd wholesale by beforeEach.
        expectedErrorClass: SpeciesCorrectionUndoCurrentStateConflictError,
        expectedConflictKind: 'destination-collision'
      }
    ];

    it.each<HardUndoDriftScenario>(hardUndoDriftScenarios)('rejects the confirmed undo, writing nothing, when $title', async scenario => {
      // Seed non-empty history/view rows (and their own ledger row on
      // cm2) up front, BEFORE the forward correction, matching every
      // other rollback test's call order in this file.
      await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);
      const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];
      const ledgerRowsBeforeApply = await loadEditOperationRowsForTargets(connection, allMemberIDs);

      // A real pre-existing CM1 association — gives the attribute-code
      // rows below a non-empty recorded 'before' set; a no-op otherwise,
      // since the writer only rebuilds cmattributes when Attributes changes.
      await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [fixture.coreMeasurementIDs.cm1, ATTR_CODE_ALIVE]);

      // (a) Apply the real forward correction and prove it recorded
      // exactly one NEW ledger row beyond the prep helper's own baseline.
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementIDs.cm1,
        newRow: scenario.newRow,
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY,
        role: ADMIN_ROLE
      });
      expect(
        applyResult.editOperationID,
        'the forward correction must succeed and record a ledger row before any drift scenario can mean anything'
      ).not.toBeNull();
      const editOperationID = applyResult.editOperationID!;
      const ledgerRowsAfterApply = await loadEditOperationRowsForTargets(connection, allMemberIDs);
      const newLedgerRowsAfterApply = ledgerRowsAfterApply.filter(
        row => !ledgerRowsBeforeApply.some(before => Number(before.EditOperationID) === Number(row.EditOperationID))
      );
      expect(
        newLedgerRowsAfterApply,
        "the forward correction must add exactly one ledger row beyond the prep helper's own baseline row — otherwise the rest of this scenario is not testing what it assumes"
      ).toHaveLength(1);
      expect(Number(newLedgerRowsAfterApply[0].EditOperationID), "the one new ledger row must be the forward correction's own EditOperationID").toBe(
        editOperationID
      );

      // (b) Unconfirmed drift plan — its hash is legitimately valid at
      // this instant; that is the whole point of this test.
      const revertInput: RevertInput = { schema: config.database, editOperationID, createdBy: CREATED_BY_REVERT, role: ADMIN_ROLE };
      const driftError = await expectRevertDriftError(cm, revertInput);
      const confirmedPlanHash = driftError.freshPlan.planHash;
      expect(confirmedPlanHash, 'the unconfirmed drift plan must still produce a hash to confirm against').toBeTruthy();

      // (c)-(f) Rows 6/7/8 drift a SHARED catalog row beforeEach never
      // resets; the finally block below restores it unconditionally, on
      // the success path AND if a mid-scenario assertion itself throws.
      try {
        // (c) Mutate EXACTLY the one state dimension this row targets.
        await scenario.driftState(connection, fixture);

        // (d) Full before-snapshot, captured immediately before the
        // confirmed undo attempt, over the now-populated history/view rows.
        const snapshotBefore = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
        const ledgerRowsBefore = await loadEditOperationRowsForTargets(connection, allMemberIDs);

        // (e) The confirmed retry, using the now-stale-but-hash-matching
        // plan. A success flag (not a self-caught sentinel throw) is
        // asserted after the try/catch so a wrongly-successful undo fails
        // loudly and specifically, rather than being swallowed as "some error".
        let thrown: unknown = null;
        let undoSucceeded = false;
        try {
          await revertEdit(cm, { ...revertInput, confirmedPlanHash });
          undoSucceeded = true;
        } catch (err) {
          thrown = err;
        }
        expect(
          undoSucceeded,
          'the confirmed undo must be REJECTED: a substantive post-correction state change was never waivable by re-confirming a hash that was only valid before that change'
        ).toBe(false);
        expect(
          thrown,
          'a generic RevertDriftError here would mean confirmation merely needed repeating — this scenario requires a SPECIFIC typed rejection instead'
        ).not.toBeInstanceOf(RevertDriftError);
        expect(thrown, `the rejection must be a ${scenario.expectedErrorClass.name}, not any other error type`).toBeInstanceOf(scenario.expectedErrorClass);
        if (scenario.expectedConflictKind !== null && thrown instanceof SpeciesCorrectionUndoCurrentStateConflictError) {
          expect(
            thrown.conflicts.map(c => c.kind),
            `the rejection must name '${scenario.expectedConflictKind}' as a conflict kind, not merely reject with an unrelated or empty conflicts list`
          ).toContain(scenario.expectedConflictKind);
        }

        // (f) Zero writes from the rejected confirmed undo: full snapshot
        // equality, byte-identical ledger rows, original row still unreverted.
        expect(
          await captureSpeciesCorrectionRollbackSnapshot(connection, fixture),
          'a rejected confirmed undo must leave every row it could have touched byte-identical to its pre-attempt state'
        ).toEqual(snapshotBefore);
        const ledgerRowsAfter = await loadEditOperationRowsForTargets(connection, allMemberIDs);
        expect(ledgerRowsAfter, 'a rejected confirmed undo must record no new ledger row and must not alter the existing one').toEqual(ledgerRowsBefore);
        const originalLedgerRowAfter = ledgerRowsAfter.find(row => Number(row.EditOperationID) === editOperationID);
        expect(originalLedgerRowAfter, 'the original apply ledger row must still exist after the rejected undo attempt').toBeDefined();
        expect(
          originalLedgerRowAfter!.RevertedByEditOperationID,
          'the original ledger row must still be unreverted after the rejected confirmed undo'
        ).toBeNull();
      } finally {
        await scenario.restoreState?.(connection, fixture);
      }
    });
  });

  // =========================================================================
  // Corrupt undo metadata in the recorded ledger payload (#427): unlike the
  // "hard undo drift" block above — which mutates LIVE data tables after a
  // legitimate correction — these scenarios mutate ONLY the correction's own
  // already-recorded `species_correction_metadata` JSON (edit_operations.
  // BeforeState/AfterState) via a direct SQL UPDATE, after a real forward
  // correction already wrote it correctly. The outer ledger eligibility
  // columns (DataType/PlotID/CensusID/TargetID/RevertedByEditOperationID)
  // are never touched, so the undo attempt demonstrably reaches
  // parseSpeciesCorrectionUndoMetadata rather than being rejected earlier.
  // =========================================================================
  describe('corrupt undo metadata in the recorded ledger payload', () => {
    interface CorruptMetadataUndoScenario {
      readonly title: string;
      readonly corruptState: (
        beforeStateRows: EditOperationStateRow[],
        afterStateRows: EditOperationStateRow[],
        fixture: SpeciesCorrectionFixture
      ) => { beforeStateRows: EditOperationStateRow[]; afterStateRows: EditOperationStateRow[] };
      readonly expectedMessageSubstring: (fixture: SpeciesCorrectionFixture) => string;
    }

    // Any value other than SPECIES_CORRECTION_METADATA_VERSION (1) — the
    // specific number is irrelevant, only "not the supported version" matters.
    const CORRUPT_METADATA_BOGUS_VERSION = SPECIES_CORRECTION_METADATA_VERSION + 1;
    // The metadata parser rejects this payload before ever reaching a
    // confirmedPlanHash comparison (see revert.ts: parseSpeciesCorrectionUndoMetadata
    // runs unconditionally, ahead of every drift/hash check) — so this value
    // is never actually compared against anything and exists only to satisfy
    // RevertInput's shape.
    const CORRUPT_METADATA_PLACEHOLDER_PLAN_HASH = 'corrupt-metadata-placeholder-hash-never-compared';

    // Swaps exactly one state row (the marker) for a replacement, by
    // reference identity — every other row in the array is untouched.
    function replaceMarkerRow(
      stateRows: EditOperationStateRow[],
      marker: EditOperationStateRow,
      newRow: Record<string, unknown> | null
    ): EditOperationStateRow[] {
      return stateRows.map(entry => (entry === marker ? { ...entry, row: newRow } : entry));
    }

    const corruptMetadataUndoScenarios: CorruptMetadataUndoScenario[] = [
      {
        title: `the recorded afterState ${SPECIES_CORRECTION_METADATA_TABLE} marker carries an unsupported metadata version`,
        corruptState: (beforeStateRows, afterStateRows) => {
          const afterMarker = findSpeciesCorrectionMetadataStateRow(afterStateRows);
          if (!afterMarker || afterMarker.row === null) {
            throw new Error(
              'test setup: the forward correction must record a non-null afterState species_correction_metadata marker before this scenario can corrupt its version'
            );
          }
          const corruptedRow: Record<string, unknown> = { ...afterMarker.row, version: CORRUPT_METADATA_BOGUS_VERSION };
          return { beforeStateRows, afterStateRows: replaceMarkerRow(afterStateRows, afterMarker, corruptedRow) };
        },
        expectedMessageSubstring: () =>
          `afterState metadata.version is unsupported (received ${JSON.stringify(CORRUPT_METADATA_BOGUS_VERSION)}, expected ${SPECIES_CORRECTION_METADATA_VERSION})`
      },
      {
        // Removing the marker from BOTH sides would make parseSpeciesCorrectionUndoMetadata
        // return null (not a species correction at all), silently falling
        // through to the legacy restore path — a false pass. Removing it
        // from exactly one side is the only way to exercise this specific check.
        title: `the recorded afterState ${SPECIES_CORRECTION_METADATA_TABLE} marker is missing while beforeState still carries one`,
        corruptState: (beforeStateRows, afterStateRows) => {
          const afterMarker = findSpeciesCorrectionMetadataStateRow(afterStateRows);
          if (!afterMarker) {
            throw new Error(
              'test setup: the forward correction must record an afterState species_correction_metadata marker before this scenario can remove it'
            );
          }
          return { beforeStateRows, afterStateRows: afterStateRows.filter(entry => entry !== afterMarker) };
        },
        expectedMessageSubstring: () => `${SPECIES_CORRECTION_METADATA_TABLE} marker present on only one side (beforeState=true, afterState=false)`
      },
      {
        // Forces afterState.speciesID to equal beforeState.speciesID — the
        // only field this mutation touches — reproducing "recorded a
        // species correction whose before/after species are identical",
        // which parseSpeciesCorrectionUndoMetadata rejects as not an actual
        // correction. Every other before/after field this correction
        // legitimately produced (targetTreeID/treeTag/plotID/censusID/
        // editedCoreMeasurementID/editedStemGUID) is already equal between
        // sides, so no earlier requireSameScalar check fires first.
        title: 'the recorded afterState speciesID is corrupted to equal beforeState speciesID (no actual species change)',
        corruptState: (beforeStateRows, afterStateRows, fixture) => {
          const afterMarker = findSpeciesCorrectionMetadataStateRow(afterStateRows);
          if (!afterMarker || afterMarker.row === null) {
            throw new Error(
              'test setup: the forward correction must record a non-null afterState species_correction_metadata marker before this scenario can corrupt its speciesID'
            );
          }
          const corruptedRow: Record<string, unknown> = { ...afterMarker.row, speciesID: fixture.speciesIDs[SPECIES_CODE_ACERRU] };
          return { beforeStateRows, afterStateRows: replaceMarkerRow(afterStateRows, afterMarker, corruptedRow) };
        },
        expectedMessageSubstring: fixture =>
          `metadata.speciesID is identical on beforeState and afterState (${fixture.speciesIDs[SPECIES_CODE_ACERRU]}) — not an actual correction`
      }
    ];

    it.each<CorruptMetadataUndoScenario>(corruptMetadataUndoScenarios)(
      'rejects the confirmed undo as a metadata-integrity failure, writing nothing, when $title',
      async scenario => {
        await prepareRollbackFixtureHistoryAndViews(connection, cm, config.database, fixture);
        const allMemberIDs = [fixture.coreMeasurementIDs.cm1, fixture.coreMeasurementIDs.cm2, fixture.coreMeasurementIDs.cm3, fixture.coreMeasurementIDs.cm4];
        const ledgerRowsBeforeApply = await loadEditOperationRowsForTargets(connection, allMemberIDs);

        // (b) Apply ONE real, VALID forward correction (ACERRU -> QUERCO) on
        // cm1. The corruption below is introduced strictly AFTER this succeeds.
        const applyResult = await applyEdit(cm, {
          dataType: 'measurementssummary',
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          targetID: fixture.coreMeasurementIDs.cm1,
          newRow: { SpeciesCode: SPECIES_CODE_QUERCO },
          expectedPlanHash: null,
          createdBy: CREATED_BY_APPLY,
          role: ADMIN_ROLE
        });
        expect(
          applyResult.editOperationID,
          'the forward correction must succeed and record a ledger row before any metadata-corruption scenario can mean anything'
        ).not.toBeNull();
        const editOperationID = applyResult.editOperationID!;

        const ledgerRowsAfterApply = await loadEditOperationRowsForTargets(connection, allMemberIDs);
        const newLedgerRowsAfterApply = ledgerRowsAfterApply.filter(
          row => !ledgerRowsBeforeApply.some(before => Number(before.EditOperationID) === Number(row.EditOperationID))
        );
        expect(
          newLedgerRowsAfterApply,
          "the forward correction must add exactly one ledger row beyond the prep helper's own baseline row — otherwise the rest of this scenario is not testing what it assumes"
        ).toHaveLength(1);
        const forwardLedgerRow = newLedgerRowsAfterApply[0];
        expect(Number(forwardLedgerRow.EditOperationID), "the one new ledger row must be the forward correction's own EditOperationID").toBe(editOperationID);

        // (c) Corrupt ONLY the recorded JSON payload, via a direct SQL
        // UPDATE restricted to BeforeState/AfterState — never any data
        // table, any derived view, or this row's own outer eligibility
        // columns (DataType/PlotID/CensusID/TargetID/RevertedByEditOperationID).
        const parsedBeforeStateRows = parseEditOperationStateColumn(forwardLedgerRow.BeforeState);
        const parsedAfterStateRows = parseEditOperationStateColumn(forwardLedgerRow.AfterState);
        const { beforeStateRows: corruptedBeforeStateRows, afterStateRows: corruptedAfterStateRows } = scenario.corruptState(
          parsedBeforeStateRows,
          parsedAfterStateRows,
          fixture
        );
        await connection.query('UPDATE edit_operations SET BeforeState = ?, AfterState = ? WHERE EditOperationID = ?', [
          JSON.stringify(corruptedBeforeStateRows),
          JSON.stringify(corruptedAfterStateRows),
          editOperationID
        ]);

        // (d) Snapshot everything immediately before the undo attempt,
        // including the corrupted ledger row itself.
        const snapshotBefore = await captureSpeciesCorrectionRollbackSnapshot(connection, fixture);
        const ledgerRowsBefore = await loadEditOperationRowsForTargets(connection, allMemberIDs);
        const corruptedLedgerRowBefore = ledgerRowsBefore.find(row => Number(row.EditOperationID) === editOperationID);
        expect(corruptedLedgerRowBefore, 'the corrupted ledger row must still exist before the undo attempt').toBeDefined();

        // (e) parseSpeciesCorrectionUndoMetadata runs unconditionally, ahead
        // of every drift/hash check (revert.ts) — so the corrupted payload
        // makes even an UNCONFIRMED attempt throw this same metadata error
        // rather than RevertDriftError. There is no legitimate drift hash to
        // obtain here, so revertEdit is called DIRECTLY with a placeholder
        // confirmedPlanHash the parser rejects before ever comparing it.
        const revertInput: RevertInput = {
          schema: config.database,
          editOperationID,
          createdBy: CREATED_BY_REVERT,
          role: ADMIN_ROLE,
          confirmedPlanHash: CORRUPT_METADATA_PLACEHOLDER_PLAN_HASH
        };

        let thrown: unknown = null;
        let undoSucceeded = false;
        try {
          await revertEdit(cm, revertInput);
          undoSucceeded = true;
        } catch (err) {
          thrown = err;
        }

        expect(
          undoSucceeded,
          'a confirmed undo over a corrupted metadata payload must be REJECTED — the parser must never silently accept a self-contradictory recorded correction'
        ).toBe(false);
        expect(
          thrown,
          'a generic RevertDriftError here would mean only the hash was stale — this corruption must instead be caught as a metadata-integrity failure, not waived by any re-confirmation'
        ).not.toBeInstanceOf(RevertDriftError);
        expect(
          thrown,
          'the rejection must not be misclassified as a live current-state conflict — the corruption is in the RECORDED payload, not in any live data row'
        ).not.toBeInstanceOf(SpeciesCorrectionUndoCurrentStateConflictError);
        expect(thrown, `the rejection must be a ${SpeciesCorrectionUndoMetadataError.name}, not any other error type`).toBeInstanceOf(
          SpeciesCorrectionUndoMetadataError
        );
        const expectedSubstring = scenario.expectedMessageSubstring(fixture);
        expect(
          (thrown as Error).message,
          `the rejection message must name the actual integrity violation this scenario introduced: "${expectedSubstring}"`
        ).toContain(expectedSubstring);

        // (f)/(g) Zero writes: full snapshot equality, byte-identical ledger
        // rows (including the still-corrupted payload, proving the rejected
        // undo never rewrote it either), and the original row still unreverted.
        expect(
          await captureSpeciesCorrectionRollbackSnapshot(connection, fixture),
          'a rejected confirmed undo must leave every row it could have touched byte-identical to its pre-attempt state'
        ).toEqual(snapshotBefore);
        const ledgerRowsAfter = await loadEditOperationRowsForTargets(connection, allMemberIDs);
        expect(ledgerRowsAfter, 'a rejected confirmed undo must record no new ledger row and must not alter the existing one').toEqual(ledgerRowsBefore);
        const corruptedLedgerRowAfter = ledgerRowsAfter.find(row => Number(row.EditOperationID) === editOperationID);
        expect(corruptedLedgerRowAfter, 'the corrupted ledger row must still exist after the rejected undo attempt').toBeDefined();
        expect(
          corruptedLedgerRowAfter!.RevertedByEditOperationID,
          'the original ledger row must still be unreverted after the rejected confirmed undo'
        ).toBeNull();
        expect(corruptedLedgerRowAfter!.BeforeState, 'the rejected undo must not have rewritten the corrupted BeforeState payload').toEqual(
          corruptedLedgerRowBefore!.BeforeState
        );
        expect(corruptedLedgerRowAfter!.AfterState, 'the rejected undo must not have rewritten the corrupted AfterState payload').toEqual(
          corruptedLedgerRowBefore!.AfterState
        );
      }
    );
  });
});
