import { NextRequest, NextResponse } from "next/server";
import { ErrorMessages, HTTPResponses } from "@/config/macros";
import { SubSpeciesRDS } from "@/config/sqlmacros";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import mysql, {PoolConnection, RowDataPacket} from "mysql2/promise";

export async function GET(): Promise<NextResponse<SubSpeciesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0); // Ensure to specify the connection type
    if (!conn) throw new Error('SQL connection failed');

    const query = `SELECT * FROM ${schema}.SubSpecies`;
    const results = await runQuery(conn, query);
    if (!results) throw new Error("Call failed");

    const subSpeciesRows: SubSpeciesRDS[] = results.map((row: RowDataPacket, index: number) => ({
      id: index + 1,
      subSpeciesID: row.SubSpeciesID,
      speciesID: row.SpeciesID,
      currentTaxonFlag: row.CurrentTaxonFlag,
      obsoleteTaxonFlag: row.ObsoleteTaxonFlag,
      subSpeciesName: row.SubSpeciesName,
      subSpeciesCode: row.SubSpeciesCode,
      authority: row.Authority,
      infraSpecificLevel: row.InfraSpecificLevel
    }));

    return new NextResponse(
      JSON.stringify(subSpeciesRows),
      { status: HTTPResponses.OK }
    );
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

  let conn: PoolConnection | null = null;
  try {
    const requestBody = await request.json();
    const newRowData = {
      SpeciesID: requestBody.speciesID ?? null,
      SubSpeciesName: requestBody.subSpeciesName ?? null,
      SubSpeciesCode: requestBody.subSpeciesCode ?? null,
      CurrentTaxonFlag: requestBody.currentTaxonFlag ?? null,
      ObsoleteTaxonFlag: requestBody.obsoleteTaxonFlag ?? null,
      Authority: requestBody.authority ?? null,
      InfraSpecificLevel: requestBody.infraSpecificLevel ?? null,
    }
    conn = await getSqlConnection(0);

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.SubSpecies`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({ message: "Insert successful" }, { status: HTTPResponses.CREATED });
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

  let conn: PoolConnection | null = null;
  try {
    const requestBody = await request.json();
    const subSpeciesID = requestBody.subSpeciesID;
    const updateData = {
      SpeciesID: requestBody.speciesID ?? null,
      SubSpeciesName: requestBody.subSpeciesName ?? null,
      SubSpeciesCode: requestBody.subSpeciesCode ?? null,
      CurrentTaxonFlag: requestBody.currentTaxonFlag ?? null,
      ObsoleteTaxonFlag: requestBody.obsoleteTaxonFlag ?? null,
      Authority: requestBody.authority ?? null,
      InfraSpecificLevel: requestBody.infraSpecificLevel ?? null,
    }
    conn = await getSqlConnection(0); // Ensure to specify the connection type
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE SubSpeciesID = ?', [`${schema}.SubSpecies`, updateData, subSpeciesID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
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

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    if (!conn) throw new Error('SQL connection failed');

    const deleteSubSpeciesID = parseInt(request.nextUrl.searchParams.get('subSpeciesID')!);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.SubSpecies WHERE [SubSpeciesID] = ?`, [deleteSubSpeciesID]);
    if (!deleteRow) return NextResponse.json({ message: ErrorMessages.DCF }, { status: HTTPResponses.INVALID_REQUEST });

    return NextResponse.json({ message: "Delete successful" }, { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}