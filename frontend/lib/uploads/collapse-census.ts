/**
 * Census collapse — the single mechanism for running the `bulkingestioncollapser`
 * stored procedure against a census.
 *
 * Both the synchronous HTTP route (app/api/setupbulkcollapser/[censusID]) and
 * the background upload worker call collapseCensus; neither owns any collapse
 * internals of its own.
 *
 * What the collapser does (from storedprocedures.sql):
 *   1. Assigns `CensusID` to any trees rows that have a NULL CensusID.
 *   2. Nullifies zero-valued DBH/HOM in coremeasurements for the census.
 *   3. Deduplicates coremeasurements by StemGUID+MeasurementDate (keeps the
 *      row with the lowest CoreMeasurementID).
 *   4. Deduplicates coremeasurements by TreeTag+StemTag within the census
 *      (keeps the row with the lowest CoreMeasurementID).
 *   Deduplication events are logged to uploadintegrityalerts.
 *
 * The procedure wraps all mutations in a single START TRANSACTION / COMMIT block
 * and manages its own rollback on error. Do NOT wrap this call in an outer
 * withTransaction — mysql2 would implicitly commit the outer transaction on the
 * first inner START TRANSACTION statement, leaving the wrapper's state corrupt.
 * We use withTransaction only for connection lifecycle (keep-alive pings,
 * session timeout extension).
 *
 * Idempotency: the collapser is safe to re-run. After the first run all
 * duplicates are gone, so the deduplication DELETE statements match zero rows on
 * subsequent calls. The zero/null fixups are likewise no-ops once applied.
 */

import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// The collapser can be slow on large censuses (dedup queries with ROW_NUMBER + JOINs).
// 5 minutes gives plenty of headroom while still catching genuine hangs.
export const COLLAPSER_TIMEOUT_MS = 5 * 60 * 1000;

export interface CollapseCensusParams {
  schema: string;
  censusID: number;
}

export async function collapseCensus(connectionManager: ConnectionManager, params: CollapseCensusParams): Promise<void> {
  const { schema, censusID } = params;

  const collapserSQL = safeFormatQuery(schema, 'CALL ??.bulkingestioncollapser(?)');

  // withTransaction is used only for connection lifecycle management (keep-alive
  // pings, extended session timeouts). The procedure's own START TRANSACTION /
  // COMMIT is authoritative — the outer BEGIN/COMMIT is effectively a no-op
  // because the procedure's START TRANSACTION implicitly commits it.
  await connectionManager.withTransaction(
    async tx => {
      ailogger.info(`Triggering collapser for census ${censusID} in schema ${schema}`);
      await tx.query(collapserSQL, [censusID]);
      ailogger.info(`Successfully collapsed & de-duped data for census ${censusID}`);
    },
    { timeoutMs: COLLAPSER_TIMEOUT_MS }
  );
}
