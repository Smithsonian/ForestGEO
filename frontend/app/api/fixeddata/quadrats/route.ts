import { NextRequest, NextResponse } from "next/server";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import { ErrorMessages } from "@/config/macros";
import { QuadratsRDS } from "@/config/sqlmacros";
import mysql, {PoolConnection, RowDataPacket} from "mysql2/promise";

export async function GET(): Promise<NextResponse<QuadratsRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn : PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const quadratRows: QuadratsRDS[] = results.map((row: RowDataPacket, index: number) => ({
      id: index + 1,
      quadratID: row.QuadratID,
      plotID: row.PlotID,
      quadratName: row.QuadratName,
      quadratX: row.QuadratX,
      quadratY: row.QuadratY,
      quadratZ: row.QuadratZ,
      dimensionX: row.DimensionX,
      dimensionY: row.DimensionY,
      area: row.Area,
      quadratShape: row.QuadratShape
    }));
    return new NextResponse(JSON.stringify(quadratRows), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn : PoolConnection | null = null;
  try {
    const requestBody = await request.json();
    const newRowData = {
      PlotID: requestBody.plotID,
      QuadratName: requestBody.quadratName,
      QuadratX: requestBody.quadratX,
      QuadratY: requestBody.quadratY,
      QuadratZ: requestBody.quadratZ,
      DimensionX: requestBody.dimensionX,
      DimensionY: requestBody.dimensionY,
      Area: requestBody.area,
      QuadratShape: requestBody.quadratShape,
    }
    conn = await getSqlConnection(0);
    // Insert the new row
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Quadrats`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn : PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const deleteQuadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.Quadrats WHERE [QuadratID] = ${deleteQuadratID}`);
    if (!deleteRow) return NextResponse.json({ message: ErrorMessages.DCF }, { status: 400 });
    return NextResponse.json({ message: "Delete successful" }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn : PoolConnection | null = null;
  try {
    const requestBody = await request.json();
    const quadratID = requestBody.quadratID;
    const updateData = {
      PlotID: requestBody.plotID,
      QuadratName: requestBody.quadratName,
      QuadratX: requestBody.quadratX,
      QuadratY: requestBody.quadratY,
      QuadratZ: requestBody.quadratZ,
      DimensionX: requestBody.dimensionX,
      DimensionY: requestBody.dimensionY,
      Area: requestBody.area,
      QuadratShape: requestBody.quadratShape,
    }
    conn = await getSqlConnection(0);

    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE QuadratID = ?', [`${schema}.Quadrats`, updateData, quadratID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
