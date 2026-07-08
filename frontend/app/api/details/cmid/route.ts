import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { fromQuery, withRouteAuthz } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

async function handler(request: NextRequest) {
  const cmID = parseInt(request.nextUrl.searchParams.get('cmid')!);
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = safeFormatQuery(
      schema,
      `
        SELECT
            cm.CoreMeasurementID,
            p.PlotName,
            q.QuadratName,
            c.PlotCensusNumber,
            c.StartDate,
            c.EndDate,
            s.SpeciesName
        FROM
            ??.coremeasurements cm
                INNER JOIN
            ??.census c ON cm.CensusID = c.CensusID
                INNER JOIN
            ??.stems st ON cm.StemGUID = st.StemGUID and st.CensusID = c.CensusID
                INNER JOIN
            ??.trees t ON st.TreeID = t.TreeID and t.CensusID = c.CensusID
                INNER JOIN
            ??.species s ON t.SpeciesID = s.SpeciesID
                INNER JOIN
            ??.quadrats q ON st.QuadratID = q.QuadratID
                INNER JOIN
            ??.plots p ON q.PlotID = p.PlotID
        WHERE
            cm.CoreMeasurementID = ?;`
    );
    const results = await connectionManager.executeQuery(query, [cmID]);
    return new NextResponse(
      JSON.stringify(
        results.map((row: any) => ({
          coreMeasurementID: row.CoreMeasurementID,
          plotName: row.PlotName,
          quadratName: row.QuadratName,
          plotCensusNumber: row.PlotCensusNumber,
          speciesName: row.SpeciesName
        }))
      ),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    await connectionManager.closeConnection();
  }
}

export const GET = withRouteAuthz('details/cmid', handler, { schema: fromQuery('schema') });
