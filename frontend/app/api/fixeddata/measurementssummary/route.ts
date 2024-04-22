import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {
  ForestGEOMeasurementsSummaryResult,
  MeasurementsSummaryRDS
} from '@/config/sqlrdsdefinitions/measurementssummaryrds';

interface ValidationErrorResult {
  CoreMeasurementID: number;
  ValidationErrors: string;
}

interface MSOutput {
  measurementsSummary: MeasurementsSummaryRDS[],
  totalCount: number
}

export async function GET(request: NextRequest): Promise<NextResponse<MSOutput>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!);
  if (isNaN(page) || isNaN(pageSize)) {
    throw new Error('Invalid page or pageSize parameter');
  }
  try {
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

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    console.log(totalRowsResult);
    const totalRows = totalRowsResult[0].totalRows;

    let measurementsSummaryRows: MeasurementsSummaryRDS[] = paginatedResults.map((row: ForestGEOMeasurementsSummaryResult, index: number) => ({
      id: index + 1,
      coreMeasurementID: row.CoreMeasurementID,
      quadratID: row.QuadratID,
      plotID: row.PlotID,
      plotName: row.PlotName,
      plotCensusNumber: row.PlotCensusNumber,
      censusStartDate: row.StartDate,
      censusEndDate: row.EndDate,
      quadratName: row.QuadratName,
      subQuadratName: row.SubQuadratName,
      treeTag: row.TreeTag,
      stemTag: row.StemTag,
      stemLocalX: row.StemLocalX,
      stemLocalY: row.StemLocalY,
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
    }));

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