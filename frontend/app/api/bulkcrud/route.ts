// bulk data CRUD flow API endpoint -- intended to allow multiline interactions and bulk updates via datagrid
import { NextRequest, NextResponse } from 'next/server';
import { FileRowSet } from '@/config/macros/formdetails';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { Plot } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';
import { auth } from '@/auth';
import { assertSchemaAccess } from '@/lib/authz';
import { callBulkIngestionInCallerTransaction, transactionExecutorFor } from '@/lib/ingestion/bulk-ingestion-call';
import { recordCommittedCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { BULKCRUD_REJECTION_MESSAGES, findMissingBulkcrudContext } from '@/lib/bulkcrud/required-context';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

const BULK_CRUD_FILE_ID = 'sample_bulk_insert.csv';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const dataType: string = body.gridType;
  const schema: string = body.schema;
  const plot: Plot | undefined = body.plot;
  const census: OrgCensus | undefined = body.census;
  const rows: FileRowSet = body.fileRowSet;
  const missingContext = findMissingBulkcrudContext(dataType, plot, census);
  if (missingContext) {
    return NextResponse.json({ error: missingContext }, { status: HTTPResponses.BAD_REQUEST });
  }
  if (!rows || Object.keys(rows).length === 0) {
    return NextResponse.json({ error: BULKCRUD_REJECTION_MESSAGES.missingRows }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Scope required by recordCommittedCoreMeasurementsAudit (#507) — validated here, BEFORE
  // beginTransaction, so a missing plotID/censusID returns 400 without ever opening a
  // transaction that this early return would then leave uncommitted and un-rolled-back.
  const isMeasurementSummaryUpload = ['measurementssummary', 'measurementssummaryview'].includes(dataType);
  const measurementPlotID = plot?.plotID;
  const measurementCensusID = census?.dateRanges?.[0]?.censusID;
  if (isMeasurementSummaryUpload && (measurementPlotID === undefined || measurementCensusID === undefined)) {
    return NextResponse.json(
      { error: 'plot.plotID and census.dateRanges[0].censusID are required for measurement bulk inserts', code: 'MEASUREMENT_SCOPE_REQUIRED' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // Per-site authorization enforced INLINE rather than via `withRouteAuthz` +
  // `fromBody('schema')`. This route accepts a potentially large `fileRowSet`
  // bulk payload; `fromBody` clones and fully re-parses the whole body to read
  // one field, doubling parse cost on the hot bulk path. The handler already
  // parsed the body above, so we reuse the resolved `schema` directly. The
  // meta-test (app/api/route-policy.test.ts) recognises the
  // `assertSchemaAccess` + `if (denied) return denied` pair as a valid signal.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
  }
  const denied = assertSchemaAccess(session, schema);
  if (denied) return denied;

  // Server-resolved identity for every audit row this request writes (#507).
  // MUST come from the authenticated session, never from a client-supplied
  // field — this route accepts no `user` field precisely so there is nothing
  // to forge.
  const changedBy = authenticatedSessionIdentity(session.user);

  // Validate schema to prevent SQL injection
  let insertSQL: string;
  try {
    insertSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
      VALUES ?`
    );
  } catch (error: any) {
    ailogger.error(`Invalid schema in bulkcrud: ${schema}`);
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.BAD_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  try {
    const activeTransactionID = await connectionManager.beginTransaction();
    transactionID = activeTransactionID;
    if (isMeasurementSummaryUpload) {
      const batchID = generateShortBatchID();
      // Narrowed by the isMeasurementSummaryUpload guard above, which ran before beginTransaction.
      const plotID = measurementPlotID as number;
      const censusID = measurementCensusID as number;
      const values = Object.values(rows).map(row => [
        BULK_CRUD_FILE_ID,
        batchID,
        plotID,
        censusID,
        row.tag,
        row.stemtag,
        row.spcode,
        row.quadrat,
        row.lx,
        row.ly,
        row.dbh,
        row.hom,
        row.date,
        row.codes,
        row.description
      ]);
      await connectionManager.executeQuery(insertSQL, [values], transactionID);
      const tx = transactionExecutorFor(connectionManager, activeTransactionID);
      await callBulkIngestionInCallerTransaction(tx, schema, BULK_CRUD_FILE_ID, batchID);
      // Audits every coremeasurements row the CALL just committed, in the SAME
      // transaction (#507) — a thrown error here (e.g. the audit INSERT itself
      // fails) rolls this request's rows AND the audit back together via the
      // outer catch's rollbackTransaction, exactly like ingest-batch.ts's
      // caller-owned-transaction sub-batches.
      await recordCommittedCoreMeasurementsAudit({
        tx,
        schema,
        fileID: BULK_CRUD_FILE_ID,
        batchID,
        changedBy,
        plotID,
        censusID
      });
    } else {
      for (const rowID in rows) {
        const rowData = rows[rowID];
        const props: InsertUpdateProcessingProps = {
          schema,
          connectionManager: connectionManager,
          formType: dataType,
          rowData,
          plot: plot,
          census: census,
          quadratID: undefined,
          transactionID,
          fullName: changedBy
        };
        await insertOrUpdate(props);
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Failure in connecting to SQL with ${e.message}`,
        error: e.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
