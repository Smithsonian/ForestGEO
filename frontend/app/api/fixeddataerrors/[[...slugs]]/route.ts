import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { CMError } from '@/config/macros/uploadsystemmacros';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  _request: NextRequest,
  {
    params
  }: {
    params: { slugs?: string[] };
  }
) {
  if (!params.slugs || params.slugs.length < 5) throw new Error('slugs not received.');
  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, quadratIDParam, speciesIDParam] = params.slugs;
  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined')
    throw new Error('core slugs schema/page/pageSize not correctly received');
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
  const quadratID = quadratIDParam ? parseInt(quadratIDParam) : undefined;
  const speciesID = speciesIDParam ? parseInt(speciesIDParam) : undefined;
  const connectionManager = new ConnectionManager();

  try {
    await connectionManager.beginTransaction();
    // Query to fetch existing validation errors
    const validationErrorsQuery = `
      SELECT SQL_CALC_FOUND_ROWS 
        ms.*,
        (
            SELECT GROUP_CONCAT(ve.ValidationID)
            FROM ${schema}.cmverrors AS cve
            JOIN catalog.validationprocedures AS ve ON cve.ValidationErrorID = ve.ValidationID
            WHERE cve.CoreMeasurementID = ms.CoreMeasurementID
        ) AS ValidationErrorIDs,
        (
            SELECT GROUP_CONCAT(ve.Description)
            FROM ${schema}.cmverrors AS cve
            JOIN catalog.validationprocedures AS ve ON cve.ValidationErrorID = ve.ValidationID
            WHERE cve.CoreMeasurementID = ms.CoreMeasurementID
        ) AS ValidationErrorDescriptions
        FROM 
            ${schema}.measurementssummary AS ms
            JOIN ${schema}.census c ON ms.CensusID = c.CensusID AND ms.PlotID = c.PlotID
        WHERE 
            ms.PlotID = ?
            AND c.PlotCensusNumber = ?
        LIMIT ?, ?;`;
    const validationErrorsRows = await connectionManager.executeQuery(validationErrorsQuery);

    const parsedValidationErrors: CMError[] = validationErrorsRows.map((row: any) => ({
      coreMeasurementID: row.CoreMeasurementID,
      validationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      descriptions: row.Descriptions.split(',')
    }));
    return new NextResponse(
      JSON.stringify({
        failed: parsedValidationErrors
      }),
      {
        status: HTTPResponses.OK,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error: any) {
    await connectionManager.rollbackTransaction();
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
