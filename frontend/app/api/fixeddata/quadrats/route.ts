// FIXED DATA QUADRATS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {getConn, parseQuadratsRequestBody, runQuery} from "@/components/processors/processormacros";
import {ErrorMessages} from "@/config/macros";
import {QuadratsRDS} from "@/config/sqlmacros";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<{
  quadrats: QuadratsRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!, 10);
  if (isNaN(page) || isNaN(pageSize)) {
    throw new Error('Invalid page, pageSize, or plotID parameter');
  }

  try {
    conn = await getConn();
    const startRow = page * pageSize;

    let paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS q.*, 
      GROUP_CONCAT(JSON_OBJECT(
        'personnelID', p.PersonnelID,
        'firstName', p.FirstName,
        'lastName', p.LastName,
        'role', p.Role
      ) SEPARATOR ',') AS personnel
      FROM ${schema}.quadrats q
      LEFT JOIN ${schema}.quadratpersonnel qp ON q.QuadratID = qp.QuadratID
      LEFT JOIN ${schema}.personnel p ON qp.PersonnelID = p.PersonnelID
      ${plotID ? 'WHERE q.PlotID = ?' : ''}
      GROUP BY q.QuadratID
      LIMIT ?, ?`;
    const queryParams = plotID ? [plotID, startRow, pageSize] : [startRow, pageSize];

    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const quadratRows: QuadratsRDS[] = paginatedResults.map((row: any, index: number) => {
      // Parse the personnel JSON and add the 'id' property
      const personnelWithId = row.personnel ? JSON.parse(`[${row.personnel}]`).map((p: any, idx: number) => ({
        ...p,
        id: idx + 1
      })) : [];

      return {
        id: index + 1,
        quadratID: row.QuadratID,
        plotID: row.PlotID,
        censusID: row.CensusID,
        quadratName: row.QuadratName,
        dimensionX: row.DimensionX,
        dimensionY: row.DimensionY,
        area: row.Area,
        quadratShape: row.QuadratShape,
        personnel: personnelWithId
      };
    });

    return new NextResponse(JSON.stringify({quadrats: quadratRows, totalCount: totalRows}), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {Personnel, ...newRowData} = await parseQuadratsRequestBody(request);
    conn = await getConn();

    // Start a transaction
    await conn.beginTransaction();

    // Insert the new quadrat row
    const insertQuadratQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Quadrats`, newRowData]);
    const result = await runQuery(conn, insertQuadratQuery);
    const quadratID = result.insertId;

    // Insert personnel associated with the new quadrat
    if (Personnel && Personnel.length > 0) {
      for (const person of Personnel) {
        const insertPersonnelQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.quadratpersonnel`, {QuadratID: quadratID, ...person}]);
        await runQuery(conn, insertPersonnelQuery);
      }
    }

    // Commit the transaction
    await conn.commit();
    return NextResponse.json({message: "Insert successful"}, {status: 200});
  } catch (error) {
    // Rollback in case of an error
    await conn?.rollback();
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}


export async function DELETE(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const deleteQuadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!);
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    await runQuery(conn, `SET foreign_key_checks = 0;`, []);

    // Delete associated personnel records
    await runQuery(conn, `DELETE FROM ${schema}.quadratpersonnel WHERE QuadratID = ?`, [deleteQuadratID]);

    // Delete the quadrat
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.Quadrats WHERE QuadratID = ?`, [deleteQuadratID]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);

    if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
    return NextResponse.json({message: "Delete successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {QuadratID, Personnel, ...updateData} = await parseQuadratsRequestBody(request);
    conn = await getConn();

    // Start a transaction
    await conn.beginTransaction();

    // Update the quadrat information
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE QuadratID = ?', [`${schema}.Quadrats`, updateData, QuadratID]);
    await runQuery(conn, updateQuery);

    // Commit the transaction
    await conn.commit();
    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error) {
    // Rollback in case of an error
    await conn?.rollback();
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
