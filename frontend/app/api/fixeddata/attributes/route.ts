import { NextRequest, NextResponse } from "next/server";
import { ErrorMessages } from "@/config/macros";
import { AttributesRDS } from "@/config/sqlmacros";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import { PoolConnection } from "mysql2/promise";

export async function GET(): Promise<NextResponse<AttributesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    conn = await getSqlConnection(0);
    if (!conn) throw new Error('SQL connection failed');

    const results = await runQuery(conn, `SELECT * FROM ${schema}.Attributes`);
    if (!results) throw new Error("Call failed");

    const attributeRows: AttributesRDS[] = results.map((row, index) => ({
      id: index + 1,
      code: row.Code,
      description: row.Description,
      status: row.Status,
    }));

    return new NextResponse(
      JSON.stringify(attributeRows),
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET:', error);
    throw error;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    const requestBody = await request.json();
    const row: AttributesRDS = {
      id: 0,
      code: requestBody.code,
      description: requestBody.description,
      status: requestBody.status,
    };
    conn = await getSqlConnection(0);

    const insertQuery = `INSERT INTO ${schema}.Attributes (Code, Description, Status) VALUES (?, ?, ?)`;
    await runQuery(conn, insertQuery, [row.code, row.description, row.status]);

    return new NextResponse(JSON.stringify({ message: "Insert successful" }), { status: 200 });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      // Handle the specific error if the code already exists
      return new NextResponse(JSON.stringify({ message: ErrorMessages.UKAE }), { status: 409 });
    }
    console.error('Error in POST:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    conn = await getSqlConnection(0);

    const deleteCode = request.nextUrl.searchParams.get('code')!;
    if (!deleteCode) {
      return new NextResponse(JSON.stringify({ message: "Code parameter is required" }), { status: 400 });
    }

    const deleteQuery = `DELETE FROM ${schema}.Attributes WHERE Code = ?`;
    await runQuery(conn, deleteQuery, [deleteCode]);

    return new NextResponse(JSON.stringify({ message: "Delete successful" }), { status: 200 });
  } catch (error) {
    console.error('Error in DELETE operation:', error);
    return new NextResponse(JSON.stringify({ message: ErrorMessages.DCF }), { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    const requestBody = await request.json();
    const row: AttributesRDS = {
      id: 0,
      code: requestBody.code,
      description: requestBody.description,
      status: requestBody.status,
    };
    conn = await getSqlConnection(0);

    const oldCode = request.nextUrl.searchParams.get('oldCode')!;

    if (!oldCode || !row.code) {
      return new NextResponse(JSON.stringify({ message: "Code parameters are required" }), { status: 400 });
    }

    const updateQuery = `UPDATE ${schema}.Attributes SET ? WHERE Code = ?`;
    await runQuery(conn, updateQuery, [row, oldCode]);

    return new NextResponse(JSON.stringify({ message: "Update successful" }), { status: 200 });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      // Handle the specific error if the new code conflicts
      return new NextResponse(JSON.stringify({ message: ErrorMessages.UKAE }), { status: 409 });
    }
    console.error('Error in PATCH:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}
