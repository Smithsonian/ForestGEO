/**
 * Batch-family identity — the single owner of the relationship between an
 * original BatchID and the `<batchID>__subNNN` IDs that splitting creates.
 *
 * Why this exists: once ingestBatch splits a large batch, the original BatchID
 * no longer matches any staged row. Every caller that asks "does this file/batch
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
  /** Sub-batch IDs left by a prior interrupted attempt, in lexical order. */
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

function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

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
    `SELECT BatchID AS BatchID,
            MIN(PlotID) AS PlotID,
            MIN(CensusID) AS CensusID,
            COUNT(*) AS rowCount,
            COUNT(DISTINCT PlotID) AS plotCount,
            COUNT(DISTINCT CensusID) AS censusCount
     FROM ??.temporarymeasurements
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
