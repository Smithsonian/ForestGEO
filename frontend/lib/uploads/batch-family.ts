/**
 * Batch-family identity — the single owner of the relationship between an
 * original BatchID and the `<batchID>__subNNN` IDs that members are staged under.
 *
 * Why this exists: pre-partitioned staging normally writes every row under a
 * `__subNNN` member (ingestBatch's fallback split only creates them after the
 * fact), so the original BatchID usually matches no staged row. Every caller that asks "does this file/batch
 * still have work?" by looking up the unsuffixed ID alone gets a false negative.
 * That is the 2026-07-27 Harvard Forest incident: the retry found zero rows under
 * the original ID and returned 200 "No data found" in 31ms while 106,227 rows
 * sat in temporarymeasurements under `__sub001`/`__sub002`.
 *
 * The synchronous route, ingestBatch, and the background worker all resolve the
 * family through this module so they cannot drift apart on the suffix format or
 * on LIKE escaping.
 */

import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

/**
 * Suffix separator written by pre-partitioned staging and the setup fallback
 * split. Changing it here without changing the writers silently orphans every
 * in-flight family, so both writers build IDs through buildSubBatchID rather than repeating
 * the literal.
 */
export const SUB_BATCH_SEPARATOR = '__sub';

/** Zero-padding width of the sub-batch ordinal (`__sub001`). */
export const SUB_BATCH_ORDINAL_WIDTH = 3;

/**
 * Backslash is the LIKE escape character and `%`/`_` are its wildcards. A
 * BatchID is caller-influenced data, so an unescaped ID containing `%` or `_`
 * would match — and therefore let a retry adopt or delete — rows belonging to a
 * DIFFERENT batch. Note `__sub` itself contains two `_` wildcards, so even
 * ordinary IDs must be escaped for the pattern to mean what it looks like.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

/**
 * SQL fragment pinning the LIKE escape character explicitly rather than relying
 * on the server default. Emits `ESCAPE '\\'`.
 */
export const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\\\'";

/** LIKE pattern matching every sub-batch of `batchID`, and nothing else. */
export function buildSubBatchPattern(batchID: string): string {
  return `${escapeLikePattern(batchID)}${escapeLikePattern(SUB_BATCH_SEPARATOR)}%`;
}

/** Builds the Nth sub-batch ID for an original batch (1-based). */
export function buildSubBatchID(originalBatchID: string, ordinal: number): string {
  return `${originalBatchID}${SUB_BATCH_SEPARATOR}${String(ordinal).padStart(SUB_BATCH_ORDINAL_WIDTH, '0')}`;
}

/** True when `candidate` is a sub-batch of `originalBatchID`. */
export function isSubBatchOf(candidate: string, originalBatchID: string): boolean {
  return candidate.startsWith(`${originalBatchID}${SUB_BATCH_SEPARATOR}`);
}

export interface BatchFamilyMember {
  batchID: string;
  rowCount: number;
}

export interface BatchFamilyScope {
  plotID: number;
  censusID: number;
  /** Summed across every family member — never a sentinel. */
  totalRows: number;
  /** Original batch first, then sub-batches in lexical (= processing) order. */
  members: BatchFamilyMember[];
  /** Rows still staged under the unsuffixed original ID. */
  originalRowCount: number;
  /** Existing `__subNNN` member IDs, in lexical order: normally every member written by pre-partitioned staging, or those left by a fallback split or interrupted attempt. */
  orphanedSubBatchIDs: string[];
}

/**
 * Raised when one file/batch family spans more than one plot or census. Staging
 * writes a single plot/census per batch, so this means the family is not what it
 * claims to be — resuming it could ingest rows into the wrong census.
 */
export class BatchFamilyScopeError extends Error {
  constructor(fileID: string, batchID: string, detail: string) {
    super(`Batch family ${fileID}-${batchID} does not resolve to a single plot/census: ${detail}`);
    this.name = 'BatchFamilyScopeError';
  }
}

/**
 * Minimal query surface so the same discovery runs inside a withTransaction
 * block (`tx.query`) and outside one (`connectionManager.executeQuery`).
 */
export type BatchFamilyQueryRunner = (sql: string, params: unknown[]) => Promise<unknown>;

interface BatchFamilyRow {
  BatchID: string;
  PlotID: number | string;
  CensusID: number | string;
  rowCount: number | string;
  plotCount: number | string;
  censusCount: number | string;
}

/** Normalizes a MySQL count/aggregate value (number, bigint or numeric string) to a number; anything else is 0. */
export function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

/**
 * Every family-scoped read of temporarymeasurements (discovery and the setup
 * fallback split) pins this (FileID, BatchID, PlotID, CensusID) index. On Azure
 * (2026-10-16) the optimizer otherwise chose idx_cid_md_dbh_hom_qn_tt and
 * scanned every remaining row. A hint, not FORCE INDEX, so a schema missing the
 * index degrades to a warning.
 */
export const FAMILY_SCAN_INDEX = 'ingest_temporarymeasurements_FBPC_index';

/**
 * Resolves every staged row belonging to `batchID` — under the original ID and
 * under its sub-batch family — into one authorizable scope.
 *
 * Returns null when the family is genuinely empty, which is the only case where
 * a caller may legitimately report "No data found".
 */
export async function discoverBatchFamily(
  runQuery: BatchFamilyQueryRunner,
  schema: string,
  fileID: string,
  batchID: string,
  options: { currentRead?: boolean } = {}
): Promise<BatchFamilyScope | null> {
  const familySQL = safeFormatQuery(
    schema,
    `SELECT /*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */ BatchID AS BatchID,
            MIN(PlotID) AS PlotID,
            MIN(CensusID) AS CensusID,
            COUNT(*) AS rowCount,
            COUNT(DISTINCT PlotID) AS plotCount,
            COUNT(DISTINCT CensusID) AS censusCount
     FROM ??.temporarymeasurements tm
     WHERE FileID = ?
       AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
     GROUP BY BatchID
     ORDER BY BatchID${options.currentRead ? ' FOR UPDATE' : ''}`
  );

  const rows = (await runQuery(familySQL, [fileID, batchID, buildSubBatchPattern(batchID)])) as BatchFamilyRow[] | null | undefined;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const plotIDs = new Set<number>();
  const censusIDs = new Set<number>();
  for (const row of rows) {
    if (toCount(row.plotCount) > 1 || toCount(row.censusCount) > 1) {
      throw new BatchFamilyScopeError(fileID, batchID, `sub-batch ${row.BatchID} itself spans multiple plots or censuses`);
    }
    plotIDs.add(toCount(row.PlotID));
    censusIDs.add(toCount(row.CensusID));
  }
  if (plotIDs.size > 1 || censusIDs.size > 1) {
    throw new BatchFamilyScopeError(fileID, batchID, `plots=[${[...plotIDs].join(', ')}] censuses=[${[...censusIDs].join(', ')}]`);
  }

  const members: BatchFamilyMember[] = rows.map(row => ({ batchID: String(row.BatchID), rowCount: toCount(row.rowCount) }));

  return {
    plotID: [...plotIDs][0],
    censusID: [...censusIDs][0],
    totalRows: members.reduce((sum, member) => sum + member.rowCount, 0),
    members,
    originalRowCount: members.find(member => member.batchID === batchID)?.rowCount ?? 0,
    orphanedSubBatchIDs: members.filter(member => member.batchID !== batchID).map(member => member.batchID)
  };
}

/**
 * Highest sub-batch ordinal already present, so a resumed split numbers new
 * sub-batches after the existing ones instead of colliding with them.
 */
export function highestSubBatchOrdinal(subBatchIDs: string[], originalBatchID: string): number {
  const prefix = `${originalBatchID}${SUB_BATCH_SEPARATOR}`;
  return subBatchIDs.reduce((highest, id) => {
    if (!id.startsWith(prefix)) return highest;
    const ordinal = Number(id.slice(prefix.length));
    return Number.isInteger(ordinal) && ordinal > highest ? ordinal : highest;
  }, 0);
}

// Sub-batches of 10K rows keep transaction duration ~6.5s (benchmarked),
// well under the 50s innodb_lock_wait_timeout on Azure MySQL.
const DEFAULT_INGESTION_SUB_BATCH_ROWS = 10_000;
const INGESTION_SUB_BATCH_ROWS_ENV = 'INGESTION_SUB_BATCH_ROWS';

/** temporarymeasurements.BatchID is varchar(36). */
export const STAGED_BATCH_ID_MAX_LENGTH = 36;
export const MAX_ORIGINAL_BATCH_ID_LENGTH = STAGED_BATCH_ID_MAX_LENGTH - SUB_BATCH_SEPARATOR.length - SUB_BATCH_ORDINAL_WIDTH;
export const MAX_SUB_BATCH_ORDINAL = 10 ** SUB_BATCH_ORDINAL_WIDTH - 1;

const SUB_BATCH_SUFFIX = new RegExp(`${SUB_BATCH_SEPARATOR}\\d{${SUB_BATCH_ORDINAL_WIDTH}}$`);

/**
 * Rows per sub-batch. Staging and setup must read the same value: staging
 * assigns membership with it and setup rejects members larger than it.
 * Overridable via INGESTION_SUB_BATCH_ROWS so tests can force multi-sub-batch
 * families without staging 10K rows; only an explicit positive integer
 * overrides the default.
 */
export function getIngestionBatchSize(): number {
  const raw = process.env[INGESTION_SUB_BATCH_ROWS_ENV];
  if (raw === undefined || raw === '') return DEFAULT_INGESTION_SUB_BATCH_ROWS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    ailogger.warn(`${INGESTION_SUB_BATCH_ROWS_ENV}="${raw}" is not a positive integer; using default ${DEFAULT_INGESTION_SUB_BATCH_ROWS}`);
    return DEFAULT_INGESTION_SUB_BATCH_ROWS;
  }
  return parsed;
}

export class SubBatchOrdinalOverflowError extends Error {
  readonly code = 'SUB_BATCH_ORDINAL_OVERFLOW';
  constructor(originalBatchID: string, rowOrdinal: number, ordinal: number) {
    super(`Row ${rowOrdinal} of batch ${originalBatchID} needs sub-batch ${ordinal}, beyond the ${MAX_SUB_BATCH_ORDINAL} the suffix can name`);
    this.name = 'SubBatchOrdinalOverflowError';
  }
}

export class OriginalBatchIDTooLongError extends Error {
  readonly code = 'ORIGINAL_BATCH_ID_TOO_LONG';
  constructor(originalBatchID: string) {
    super(`Batch ID "${originalBatchID}" is ${originalBatchID.length} characters; at most ${MAX_ORIGINAL_BATCH_ID_LENGTH} leave room for a sub-batch suffix`);
    this.name = 'OriginalBatchIDTooLongError';
  }
}

/**
 * A client-sent `X__sub001` would stage as `X__sub001__sub001`, match family X's
 * LIKE pattern, and `familyRootOf` would then resolve it to the wrong root.
 */
export class BatchIDContainsSubBatchSeparatorError extends Error {
  readonly code = 'INVALID_BATCH_ID';
  constructor(batchID: string) {
    super(`Batch ID "${batchID}" must not contain the reserved sub-batch separator "${SUB_BATCH_SEPARATOR}"`);
    this.name = 'BatchIDContainsSubBatchSeparatorError';
  }
}

/**
 * Final BatchID for the row at 0-based `rowOrdinal` in a file's parsed row
 * sequence. A pure function of the file and the batch size, so a retry that
 * re-stages the same file reproduces identical membership — the property the
 * procedure's completed-batch skip depends on.
 */
export function subBatchIDForRowOrdinal(originalBatchID: string, rowOrdinal: number, batchSize: number = getIngestionBatchSize()): string {
  if (!Number.isSafeInteger(rowOrdinal) || rowOrdinal < 0) {
    throw new RangeError(`Row ordinal must be a non-negative safe integer; received ${rowOrdinal}`);
  }
  if (originalBatchID.length > MAX_ORIGINAL_BATCH_ID_LENGTH) throw new OriginalBatchIDTooLongError(originalBatchID);
  const ordinal = Math.floor(rowOrdinal / batchSize) + 1;
  if (ordinal > MAX_SUB_BATCH_ORDINAL) throw new SubBatchOrdinalOverflowError(originalBatchID, rowOrdinal, ordinal);
  return buildSubBatchID(originalBatchID, ordinal);
}

/** The original BatchID a staged BatchID belongs to. */
export function familyRootOf(batchID: string): string {
  const suffix = SUB_BATCH_SUFFIX.exec(batchID);
  return suffix ? batchID.slice(0, suffix.index) : batchID;
}

export interface StagedBatchRow {
  FileID: string;
  BatchID: string;
  maxRowID: string | number;
}

export interface FileBatchFamilySelection {
  fileID: string;
  batchID: string;
  familyCount: number;
}

/** One entry per file: the family that holds the file's most recently staged row. */
export function selectNewestFamilyPerFile(rows: StagedBatchRow[]): FileBatchFamilySelection[] {
  const families = new Map<string, Map<string, bigint>>();
  for (const row of rows) {
    const root = familyRootOf(String(row.BatchID));
    const fileFamilies = families.get(row.FileID) ?? new Map<string, bigint>();
    const rowID = BigInt(String(row.maxRowID));
    const known = fileFamilies.get(root);
    if (known === undefined || rowID > known) fileFamilies.set(root, rowID);
    families.set(row.FileID, fileFamilies);
  }
  return [...families.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([fileID, fileFamilies]) => {
      const [batchID] = [...fileFamilies.entries()].reduce((newest, candidate) => (candidate[1] > newest[1] ? candidate : newest));
      return { fileID, batchID, familyCount: fileFamilies.size };
    });
}

/**
 * ArcGIS commit batches are derived from the import session's primary key on the server (#561), so no other upload
 * can produce or name the family: every other batch generator (`generateShortBatchID`) emits a `-`, and CSV staging
 * refuses this shape (`ReservedBatchIDError`). 3 + 25 = 28 = MAX_ORIGINAL_BATCH_ID_LENGTH, and 36^25 > 2^128.
 */
export const ARCGIS_COMMIT_BATCH_ID_PREFIX = 'arc';
export const ARCGIS_COMMIT_BATCH_ID_BODY_LENGTH = 25;
const BASE36_RADIX = 36;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARCGIS_COMMIT_BATCH_ID_PATTERN = new RegExp(`^${ARCGIS_COMMIT_BATCH_ID_PREFIX}[0-9a-z]{${ARCGIS_COMMIT_BATCH_ID_BODY_LENGTH}}$`);

export class InvalidArcgisImportSessionIDError extends Error {
  readonly code = 'INVALID_ARCGIS_IMPORT_SESSION_ID';
  constructor(importSessionId: string) {
    super(`ArcGIS import session id "${importSessionId}" is not a UUID, so no commit batch can be derived from it`);
    this.name = 'InvalidArcgisImportSessionIDError';
  }
}

/** A caller-chosen batch CSV staging must not use: the ArcGIS shape, or anything that could alias it (#561); refused before any write. */
export class ReservedBatchIDError extends Error {
  readonly code = 'RESERVED_BATCH_ID';
  constructor(batchID: string, reason: string) {
    super(`Batch ID "${batchID}" ${reason}; generate a new batch ID`);
    this.name = 'ReservedBatchIDError';
  }
}

/**
 * Every server batch generator emits only these characters: `generateShortBatchID` (config/utils.ts) is base-36 time,
 * `-`, base-36 random, all lowercase. The batch columns compare under utf8mb4_0900_ai_ci (case- and
 * accent-insensitive), so any other character could make a caller batch equal an ArcGIS commit batch in SQL.
 */
const CALLER_BATCH_ID_ALPHABET = /^[0-9a-z-]+$/;
const CALLER_BATCH_ID_ALPHABET_REASON = 'contains characters outside 0-9, a-z and "-", which the database could match to an ArcGIS commit batch';
const ARCGIS_COMMIT_BATCH_SHAPE_REASON = 'has the shape reserved for ArcGIS commit batches';

/** The check CSV staging applies to a caller batch (#561 N1, H2). */
export function assertCallerBatchIDAllowed(batchID: string): void {
  if (!CALLER_BATCH_ID_ALPHABET.test(batchID)) throw new ReservedBatchIDError(batchID, CALLER_BATCH_ID_ALPHABET_REASON);
  if (isArcgisCommitBatchShape(batchID)) throw new ReservedBatchIDError(batchID, ARCGIS_COMMIT_BATCH_SHAPE_REASON);
}

export function deriveArcgisCommitBatchID(importSessionId: string): string {
  if (!UUID_PATTERN.test(importSessionId)) throw new InvalidArcgisImportSessionIDError(importSessionId);
  const sessionBits = BigInt(`0x${importSessionId.replace(/-/g, '')}`);
  return `${ARCGIS_COMMIT_BATCH_ID_PREFIX}${sessionBits.toString(BASE36_RADIX).padStart(ARCGIS_COMMIT_BATCH_ID_BODY_LENGTH, '0')}`;
}

export function isArcgisCommitBatchShape(batchID: string): boolean {
  return ARCGIS_COMMIT_BATCH_ID_PATTERN.test(batchID);
}
