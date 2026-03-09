import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  const connectionManager = ConnectionManager.getInstance();

  try {
    const discoverySQL = safeFormatQuery(
      schema,
      `WITH ranked_batches AS (
         SELECT FileID,
                BatchID,
                MAX(id) AS maxRowID,
                COUNT(*) OVER (PARTITION BY FileID) AS fileBatchCount,
                ROW_NUMBER() OVER (PARTITION BY FileID ORDER BY MAX(id) DESC, BatchID DESC) AS rowNum
         FROM ??.temporarymeasurements
         WHERE PlotID = ? AND CensusID = ?
         GROUP BY FileID, BatchID
       )
       SELECT FileID, BatchID, fileBatchCount
       FROM ranked_batches
       WHERE rowNum = 1
       ORDER BY FileID, maxRowID DESC`
    );

    const result = await connectionManager.executeQuery(discoverySQL, [plotID, censusID]);
    const output: { fileID: string; batchID: string }[] = result.map((row: any) => {
      if (Number(row.fileBatchCount ?? 0) > 1) {
        ailogger.warn(
          `Multiple temporarymeasurement batches detected for file ${row.FileID} in plot ${plotID}, census ${censusID}; selecting the newest batch ${row.BatchID}`
        );
      }

      return {
        fileID: row.FileID,
        batchID: row.BatchID
      };
    });
    ailogger.info(`Found ${output.length} batches for schema: ${schema}, plotID: ${plotID}, censusID: ${censusID}`);
    ailogger.debug(`Batch details: ${JSON.stringify(output)}`);
    return new NextResponse(JSON.stringify(output), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error(`Error fetching batches for bulk processor:`, error);
    return new NextResponse(JSON.stringify({ error: 'Failed to fetch batches', details: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
