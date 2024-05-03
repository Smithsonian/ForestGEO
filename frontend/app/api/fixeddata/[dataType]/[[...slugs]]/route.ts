// dynamic structuring attempt
// dataType will be the table or view name reference to be placed as part of the request
// slugs is a catchall that will vary depending on the type of request placed:
// GET --> schema, page, pagesize, plotID, censusID, quadratID
// POST --> schema
// PATCH --> schema
// DELETE --> schema, deletionID
import { getConn, parseAttributeRequestBody, runQuery } from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, censusID
export async function GET(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs || params.slugs.length < 5) throw new Error("slugs not received.");
  const [schema, pageParam, pageSizeParam, plotID, censusID, quadratID] = params.slugs;
  if (!schema || !pageParam || !pageSizeParam) throw new Error("core slugs schema/page/pageSize not correctly received");
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);

  if (!plotID || !censusID) throw new Error("Core plot/census information not received");
  let conn: PoolConnection | null = null;
// app/api/fixeddata/get/[dataType]/[[...slugs]]/route.ts
  try {
    conn = await getConn();
    let paginatedQuery = ``;
    let queryParams = [];
    queryParams.push((page * pageSize).toString(), pageSize.toString());
    switch (params.dataType) {
      case 'Attributes':
      case 'Species':
      case 'Personnel':
      case 'Stems':
      case 'AllTaxonomiesView':
      case 'StemTaxonomiesView':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType.toLowerCase()} LIMIT ?, ?`;
        break;
      case 'Quadrats':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS q.*, 
        GROUP_CONCAT(JSON_OBJECT(
          'personnelID', p.PersonnelID,
          'firstName', p.FirstName,
          'lastName', p.LastName,
          'role', p.Role
        ) SEPARATOR ',') AS personnel
        FROM ${schema}.${params.dataType.toLowerCase()} q
        LEFT JOIN ${schema}.quadratpersonnel qp ON q.QuadratID = qp.QuadratID
        LEFT JOIN ${schema}.personnel p ON qp.PersonnelID = p.PersonnelID
        WHERE PlotID = ${plotID} AND CensusID = ${censusID}
        GROUP BY q.QuadratID
        LIMIT ?, ?`; // plotID, censusID, and quadratID are still strings!
        break;
      case 'Subquadrats':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS s.*
        FROM ${schema}.${params.dataType.toLowerCase()} s
        JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
        WHERE q.QuadratID = ${quadratID} AND q.PlotID = ${plotID} AND q.CensusID = ${censusID}
        LIMIT ?, ?`;
        break;
      case 'Census':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType.toString()}
        WHERE PlotID = ${plotID}
        LIMIT ?, ?`;
        break;
      case 'CoreMeasurements':
      case 'MeasurementsSummaryView':
      case 'StemDimensionsView':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType.toString()}
        WHERE PlotID = ${plotID} AND CensusID = ${censusID} ${quadratID ? `AND QuadratID = ${quadratID}` : ``}
        LIMIT ?, ?
        `;
        break;
    }
    console.log(paginatedQuery);
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams);

    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;
    const mapper = MapperFactory.getMapper<any, any>(params.dataType);
    const rows = mapper.mapData(paginatedResults);
    return new NextResponse(JSON.stringify({output: rows, totalCount: totalRows}), {status: 200});
  } catch (error: any) {
    if (conn) await conn.rollback();
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

// required dynamic parameters: ONLY schema
// json body-provided oldRow, newRow
export async function POST(request: NextRequest, { params }: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema] = params.slugs;
  if (!schema) throw new Error("no schema provided");
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await conn.beginTransaction();
    let newRowData: any;
    switch (params.dataType) {
      case 'Attributes':
        newRowData = parseAttributeRequestBody(request, 'POST');
      case 'Species':
      case 'Personnel':
      case 'Stems':
      case 'AllTaxonomiesView':
      case 'StemTaxonomiesView':
        break;
      case 'Quadrats':
        break;
      case 'Subquadrats':
        break;
      case 'Census':
        break;
      case 'CoreMeasurements':
      case 'StemDimensionsView':
        break;
    }
    await runQuery(conn, 'INSERT INTO ?? SET ?', [`${schema}.${params.dataType.toLowerCase()}`, newRowData]);
    await conn.commit();
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}