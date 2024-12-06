import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

// datatype: table name
// expecting 1) schema 2) plotID 3) plotCensusNumber
export async function GET(_request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  if (!params.slugs || !params.dataType) throw new Error('missing slugs');
  const [schema, plotID, plotCensusNumber] = params.slugs;
  if (
    !schema ||
    schema === 'undefined' ||
    !plotID ||
    plotID === 'undefined' ||
    !plotCensusNumber ||
    plotCensusNumber === 'undefined' ||
    params.slugs.length > 3 ||
    params.slugs.length < 3
  )
    throw new Error('incorrect slugs provided');

  const connection = ConnectionManager.getInstance();
  try {
    switch (params.dataType) {
      case 'attributes':
      case 'species':
        const baseQuery = `SELECT 1 FROM ${schema}.${params.dataType} LIMIT 1`; // Check if the table has any row
        const baseResults = await connection.executeQuery(baseQuery);
        if (baseResults.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        break;
      case 'personnel':
        const pQuery = `SELECT 1 FROM ${schema}.personnel WHERE CensusID IN (SELECT CensusID from ${schema}.census WHERE PlotID = ${plotID} AND PlotCensusNumber = ${plotCensusNumber})`; // Check if the table has any row
        const pResults = await connection.executeQuery(pQuery);
        if (pResults.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        break;
      case 'quadrats':
        const query = `SELECT 1 FROM ${schema}.quadrats q
         JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID 
         JOIN ${schema}.census c ON cq.CensusID = c.CensusID 
         WHERE q.PlotID = ${plotID} AND c.PlotCensusNumber = ${plotCensusNumber} LIMIT 1`;
        const results = await connection.executeQuery(query);
        if (results.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        break;
      case 'postvalidation':
        const pvQuery = `SELECT 1 FROM ${schema}.coremeasurements cm
        JOIN ${schema}.census c ON C.CensusID = cm.CensusID
        JOIN ${schema}.plots p ON p.PlotID = c.PlotID
        WHERE p.PlotID = ${plotID} AND c.PlotCensusNumber = ${plotCensusNumber} LIMIT 1`;
        const pvResults = await connection.executeQuery(pvQuery);
        if (pvResults.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        break;
      case 'quadratpersonnel':
        // Validation for quadrats table
        const quadratsQuery = `SELECT 1
                             FROM ${schema}.quadrats q
                             JOIN ${schema}.censusquadrat cq on cq.QuadratID = q.QuadratID
                             JOIN ${schema}.census c on cq.CensusID = c.CensusID
                             JOIN ${schema}.personnel p ON p.CensusID = c.CensusID
                             WHERE q.PlotID = ${plotID}
                               AND c.PlotCensusNumber = ${plotCensusNumber} LIMIT 1`;
        const quadratsResults = await connection.executeQuery(quadratsQuery);
        if (quadratsResults.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });

        // Validation for personnel table
        const personnelQuery = `SELECT 1 FROM ${schema}.personnel LIMIT 1`;
        const personnelResults = await connection.executeQuery(personnelQuery);
        if (personnelResults.length === 0)
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });

        break;
      default:
        return new NextResponse(null, {
          status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
        });
    }
    // If all conditions are satisfied
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(null, {
      status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
    });
  } finally {
    await connection.closeConnection();
  }
}
