/**
 * Summary rows for the two bulk deletes Recent Changes records as one entry each: deleting a
 * census (app/api/clearcensus) and the census replacement a Clean Re-Upload runs. A summary
 * row carries the delete counts, not an image of every removed row.
 */
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';

export const DELETION_SUMMARY_KIND = {
  censusDelete: 'census-delete',
  censusReplacement: 'census-replacement'
} as const;
export type DeletionSummaryKind = (typeof DELETION_SUMMARY_KIND)[keyof typeof DELETION_SUMMARY_KIND];

/** A pseudo-table like file_upload: the summary is not a row of any real table. */
export const CENSUS_REPLACEMENT_TABLE_NAME = 'census_replacement';

/** What a census-replacement summary row is keyed by: the upload as the user started it, which survives retries. */
export const CENSUS_REPLACEMENT_UPLOAD_SCOPE = {
  uploadSession: 'upload-session',
  backgroundJobFile: 'background-job-file',
  arcgisImport: 'arcgis-import'
} as const;
export type CensusReplacementUploadScope = (typeof CENSUS_REPLACEMENT_UPLOAD_SCOPE)[keyof typeof CENSUS_REPLACEMENT_UPLOAD_SCOPE];

const CHANGELOG_RECORD_ID_MAX_LENGTH = 255;

/** The summary row's RecordID; the scope prefix keeps ids from different upload paths apart. */
export function buildCensusReplacementSummaryRecordID(scope: CensusReplacementUploadScope, uploadID: string | number): string {
  return `${scope}:${uploadID}`.slice(0, CHANGELOG_RECORD_ID_MAX_LENGTH);
}

/** Table name to the number of its rows the delete removed. */
export type DeletedRowCounts = Record<string, number>;

export interface CensusReplacementSummaryIdentity {
  /**
   * buildCensusReplacementSummaryRecordID for the upload: the synchronous route's upload session, the worker's job
   * file (a worker retry runs under a new session), or the ArcGIS import session. Not the batch id, which callers
   * may supply and reuse.
   */
  recordID: string;
  fileName: string;
  batchID: string;
  changedBy: string | null;
}

export interface CensusReplacementSummaryState {
  summaryKind: typeof DELETION_SUMMARY_KIND.censusReplacement;
  fileName: string;
  batchID: string;
  deletedRowCounts: DeletedRowCounts;
}

const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';

function parseRowState(value: unknown): CensusReplacementSummaryState {
  return (typeof value === 'string' ? JSON.parse(value) : value) as CensusReplacementSummaryState;
}

/**
 * Adds one replacement window's deletes to the upload's summary row, creating it on the first
 * window. Call it in the window's own transaction so the count and the deletes commit together:
 * a replacement commits window by window, and one interrupted and resumed later, or retried by the
 * worker, keeps adding to the same row. A window that deletes nothing writes nothing, so a first
 * upload into an empty census leaves no replacement entry. Windows of one attempt never run
 * concurrently (each holds the upload session lock), and the worker retries an upload only after
 * the previous attempt has ended.
 */
export async function addToCensusReplacementSummary(params: {
  tx: Pick<TxExecutor, 'query'>;
  schema: string;
  identity: CensusReplacementSummaryIdentity;
  deletedMeasurements: number;
  plotID: number;
  censusID: number;
}): Promise<void> {
  const { tx, schema, identity, deletedMeasurements, plotID, censusID } = params;
  if (deletedMeasurements === 0) return;
  try {
    const existing = await tx.query<Array<{ ChangeID: number; OldRowState: unknown }>>(
      safeFormatQuery(
        schema,
        `SELECT ChangeID, OldRowState FROM ??.unifiedchangelog
         WHERE TableName = '${CENSUS_REPLACEMENT_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
         ORDER BY ChangeID DESC LIMIT 1
         FOR UPDATE`
      ),
      [identity.recordID, censusID]
    );

    if (existing.length === 0) {
      const state: CensusReplacementSummaryState = {
        summaryKind: DELETION_SUMMARY_KIND.censusReplacement,
        fileName: identity.fileName,
        batchID: identity.batchID,
        deletedRowCounts: { [COREMEASUREMENTS_TABLE_NAME]: deletedMeasurements }
      };
      await tx.query(
        safeFormatQuery(
          schema,
          `INSERT INTO ??.unifiedchangelog
            (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
           VALUES ('${CENSUS_REPLACEMENT_TABLE_NAME}', ?, '${ChangelogOperation.DELETE}', CONVERT(? USING utf8mb4), NULL, NOW(), ?, ?, ?)`
        ),
        [identity.recordID, JSON.stringify(state), identity.changedBy, plotID, censusID]
      );
      return;
    }

    const state = parseRowState(existing[0].OldRowState);
    const previousCount = Number(state.deletedRowCounts?.[COREMEASUREMENTS_TABLE_NAME] ?? 0);
    state.deletedRowCounts = { ...state.deletedRowCounts, [COREMEASUREMENTS_TABLE_NAME]: previousCount + deletedMeasurements };
    await tx.query(
      safeFormatQuery(
        schema,
        `UPDATE ??.unifiedchangelog SET OldRowState = CONVERT(? USING utf8mb4), ChangeTimestamp = NOW()
         WHERE ChangeID = ? AND TableName = '${CENSUS_REPLACEMENT_TABLE_NAME}'`
      ),
      [JSON.stringify(state), existing[0].ChangeID]
    );
  } catch (error: unknown) {
    throw new ChangelogWriteError(ChangelogOperation.DELETE, CENSUS_REPLACEMENT_TABLE_NAME, identity.recordID, error);
  }
}
