/**
 * Census collapse — the single mechanism for running the `bulkingestioncollapser`
 * stored procedure against a census.
 *
 * Both the synchronous HTTP route (app/api/setupbulkcollapser/[censusID]) and
 * the background upload worker (pending, async-upload remediation Task 10) call
 * collapseCensus; neither owns any collapse
 * internals of its own.
 *
 * What the collapser does (from storedprocedures.sql):
 *   1. Assigns `CensusID` to any trees rows that have a NULL CensusID.
 *      SCHEMA-GLOBAL HAZARD: this step stamps EVERY tree in the schema whose
 *      CensusID IS NULL with the supplied censusID, regardless of plot. Under
 *      interleaved multi-census uploads the wrong census can be assigned to
 *      trees from a concurrent upload.
 *   2. Nullifies zero-valued DBH/HOM in coremeasurements for the census.
 *   3. Deduplicates coremeasurements by StemGUID+MeasurementDate (keeps the
 *      row with the lowest CoreMeasurementID).
 *   4. Deduplicates coremeasurements by TreeTag+StemTag within the census
 *      (keeps the row with the lowest CoreMeasurementID).
 *   Deduplication events are logged to uploadintegrityalerts.
 *
 * Transaction contract: the procedure owns its own START TRANSACTION / COMMIT /
 * ROLLBACK. Callers must NOT wrap this call in an additional transaction layer.
 * In mysql2, issuing START TRANSACTION inside an active connection-level
 * transaction implicitly commits that outer transaction, voiding any atomicity
 * the caller expected. collapseCensus uses withTransaction solely for connection
 * lifecycle management (keep-alive pings, session-timeout extension); the
 * procedure's internal transaction is the authoritative atomicity boundary.
 *
 * Idempotency: the collapser is safe to re-run. After the first run all
 * duplicates are gone, so the deduplication DELETE statements match zero rows on
 * subsequent calls. The zero/null fixups are likewise no-ops once applied.
 */

import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

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
