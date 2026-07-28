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

import { safeFormatQuery } from '@/lib/db/sqlsecurity';

/**
 * Suffix separator written by splitIntoSubBatches. Changing it here without
 * changing the writer silently orphans every in-flight split, so the split
 * writer imports this constant rather than repeating the literal.
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
export async function discoverBatchFamily(runQuery: BatchFamilyQueryRunner, schema: string, fileID: string, batchID: string): Promise<BatchFamilyScope | null> {
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
     ORDER BY BatchID`
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
