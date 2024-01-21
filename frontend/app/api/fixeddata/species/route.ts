import { NextRequest, NextResponse } from "next/server";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import { ErrorMessages } from "@/config/macros";
import { SpeciesRDS } from "@/config/sqlmacros";
import mysql, {PoolConnection, RowDataPacket} from "mysql2/promise";
import {req} from "pino-std-serializers";

export async function GET(): Promise<NextResponse<SpeciesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn : PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Species`;
    const results = await runQuery(conn, query);
    if (!results) throw new Error("Call failed");

    const speciesRows: SpeciesRDS[] = results.map((row: RowDataPacket, index: number) => ({
      id: index + 1,
      speciesID: row.SpeciesID,
      genusID: row.GenusID,
      currentTaxonFlag: row.CurrentTaxonFlag,
      obsoleteTaxonFlag: row.ObsoleteTaxonFlag,
      speciesName: row.SpeciesName,
      speciesCode: row.SpeciesCode,
      idLevel: row.IDLevel,
      authority: row.Authority,
      fieldFamily: row.FieldFamily,
      description: row.Description,
      referenceID: row.ReferenceID
    }));
    return new NextResponse(JSON.stringify(speciesRows), { status: 200 });
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
      GenusID: requestBody.genusID ?? null,
      CurrentTaxonFlag: requestBody.currentTaxonFlag ?? null,
      ObsoleteTaxonFlag: requestBody.obsoleteTaxonFlag ?? null,
      SpeciesName: requestBody.speciesName ?? null,
      SpeciesCode: requestBody.speciesCode ?? null,
      IDLevel: requestBody.idLevel ?? null,
      Authority: requestBody.authority ?? null,
      FieldFamily: requestBody.fieldFamily ?? null,
      Description: requestBody.description ?? null,
      ReferenceID: requestBody.referenceID ?? null,
    }
    conn = await getSqlConnection(0);
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Species`, newRowData]);
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
    const deleteSpeciesID = parseInt(request.nextUrl.searchParams.get('speciesID')!);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.Species WHERE [SpeciesID] = ${deleteSpeciesID}`);
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
    const speciesID = requestBody.speciesID;
    const updateData = {
      GenusID: requestBody.genusID ?? null,
      CurrentTaxonFlag: requestBody.currentTaxonFlag ?? null,
      ObsoleteTaxonFlag: requestBody.obsoleteTaxonFlag ?? null,
      SpeciesName: requestBody.speciesName ?? null,
      SpeciesCode: requestBody.speciesCode ?? null,
      IDLevel: requestBody.idLevel ?? null,
      Authority: requestBody.authority ?? null,
      FieldFamily: requestBody.fieldFamily ?? null,
      Description: requestBody.description ?? null,
      ReferenceID: requestBody.referenceID ?? null,
    }
    conn = await getSqlConnection(0);
    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE SpeciesID = ?', [`${schema}.Species`, updateData, speciesID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
