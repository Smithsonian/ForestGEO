import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {
  ForestGEOMeasurementsSummaryResult,
  getConn,
  getSchema,
  runQuery
} from "@/components/processors/processormacros";
import {MeasurementsSummaryRDS} from "@/config/sqlmacros";

interface ValidationErrorResult {
  CoreMeasurementID: number;
  ValidationErrors: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<MeasurementsSummaryRDS[]>> {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
    const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
    const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!);

    if (isNaN(page) || isNaN(pageSize)) {
      throw new Error('Invalid page or pageSize parameter');
    }

    conn = await getConn();
    const startRow = page * pageSize;

    // Query to get the paginated data
    let paginatedQuery: string;
    let queryParams: any[];
    if (plotID) {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.forestgeomeasurementssummary
      WHERE PlotID = ?
      LIMIT ?, ?;
      `;
      queryParams = [plotID, startRow, pageSize];
    } else {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.forestgeomeasurementssummary
      LIMIT ?, ?;
    `;
      queryParams = [startRow, pageSize];
    }
    // Run the paginated query
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));
    const coreMeasurementIDs = paginatedResults.map((row: ForestGEOMeasurementsSummaryResult) => row.CoreMeasurementID);

    // Fetch Validation States with descriptions
    const validationQuery = `
      SELECT cmv.CoreMeasurementID, GROUP_CONCAT(ve.ValidationErrorID SEPARATOR '; ') AS ValidationErrors
      FROM ${schema}.cmverrors cmv
      JOIN ${schema}.validationerrors ve ON cmv.ValidationErrorID = ve.ValidationErrorID
      WHERE cmv.CoreMeasurementID IN (?)
      GROUP BY cmv.CoreMeasurementID
  `;
    const validationResults: ValidationErrorResult[] = await runQuery(conn, validationQuery, [coreMeasurementIDs.map((param: any) => param.toString())]);

    // Map Validation States to CoreMeasurementIDs with descriptions as an array
    const validationMap = validationResults.reduce<Record<number, string[]>>((acc, val) => {
      acc[val.CoreMeasurementID] = val.ValidationErrors.split('; ');
      return acc;
    }, {});

    let measurementsSummaryRows: MeasurementsSummaryRDS[] = paginatedResults.map((row: ForestGEOMeasurementsSummaryResult, index: number) => ({
      id: index + 1,
      coreMeasurementID: row.CoreMeasurementID,
      plotID: row.PlotID,
      plotName: row.PlotName,
      plotCensusNumber: row.PlotCensusNumber,
      censusStartDate: row.StartDate,
      censusEndDate: row.EndDate,
      quadratName: row.QuadratName,
      treeTag: row.TreeTag,
      stemTag: row.StemTag,
      stemQuadX: row.StemQuadX,
      stemQuadY: row.StemQuadY,
      stemQuadZ: row.StemQuadZ,
      speciesName: row.SpeciesName,
      subSpeciesName: row.SubSpeciesName,
      genus: row.Genus,
      family: row.Family,
      personnelName: row.PersonnelName,
      measurementDate: row.MeasurementDate,
      measuredDBH: row.MeasuredDBH,
      measuredHOM: row.MeasuredHOM,
      description: row.Description,
      attributes: row.Attributes,
      validationErrors: validationMap[row.CoreMeasurementID] || []
    }));

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    return new NextResponse(JSON.stringify({
      measurementsSummary: measurementsSummaryRows,
      totalCount: totalRows
    }), {status: 200});
  } catch (error: any) {
    console.error('Error in GET operation:', error.message);
    return new NextResponse(JSON.stringify({message: 'SQL query failed: ' + error.message}), {status: 400});
  } finally {
    if (conn) conn.release();
  }
}