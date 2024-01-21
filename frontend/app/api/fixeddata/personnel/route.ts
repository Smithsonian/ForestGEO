import { NextRequest, NextResponse } from "next/server";
import { ErrorMessages } from "@/config/macros";
import { PersonnelRDS } from "@/config/sqlmacros";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import mysql, { PoolConnection } from "mysql2/promise";

export async function GET(): Promise<NextResponse<PersonnelRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const rows = await runQuery(conn, `SELECT * FROM ${schema}.Personnel`, []);

    const personnelRows: PersonnelRDS[] = rows.map((row: any, index) => ({
      id: index + 1,
      personnelID: row.personnelID,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role
      // ... other fields as needed
    }));

    return new NextResponse(JSON.stringify(personnelRows), { status: 200 });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    const requestBody = await request.json();

    const newRowData = {
      FirstName: requestBody.firstName ?? null,
      LastName: requestBody.lastName ?? null,
      Role: requestBody.role ?? null,
    };

    conn = await getSqlConnection(0);

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Attributes`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({ message: ErrorMessages.ICF }, { status: 400 });
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
    const personnelID = requestBody.personnelID;
    const updateData = {
      FirstName: requestBody.firstName,
      LastName: requestBody.lastName,
      Role: requestBody.role,
    }
    conn = await getSqlConnection(0);

    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE PersonnelID = ?', [`${schema}.Personnel`, updateData, personnelID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({ message: ErrorMessages.UCF }, { status: 400 });
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

    const deletePersonnelID = parseInt(request.nextUrl.searchParams.get('personnelID')!);
    if (isNaN(deletePersonnelID)) {
      return NextResponse.json({ message: "Invalid PersonnelID" }, { status: 400 });
    }

    const deleteQuery = `DELETE FROM ${schema}.Personnel WHERE PersonnelID = ?`;
    await runQuery(conn, deleteQuery, [deletePersonnelID]);

    return NextResponse.json({ message: "Delete successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({ message: ErrorMessages.DCF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}
