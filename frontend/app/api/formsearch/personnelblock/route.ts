import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {PersonnelRDS, PersonnelResult} from '@/config/sqlrdsdefinitions/tables/personnelrds';
import {FORMSEARCH_LIMIT} from "@/config/macros/azurestorage";
import { HTTPResponses } from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<PersonnelRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialLastName = request.nextUrl.searchParams.get('searchfor')!;
  const conn = await getConn();
  try {
    const query = partialLastName === '' ?
      `SELECT DISTINCT PersonnelID, FirstName, LastName, Role
      FROM ${schema}.personnel
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}` :
      `SELECT DISTINCT PersonnelID, FirstName, LastName, Role
      FROM ${schema}.personnel
      WHERE LastName LIKE ?
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialLastName === '' ? [] : [`%${partialLastName}%`];
    const results = await runQuery(conn, query, queryParams);

    const personnelRows: PersonnelRDS[] = results.map((row: PersonnelResult, index: number) => ({
      id: index + 1,
      personnelID: row.PersonnelID,
      firstName: row.FirstName,
      lastName: row.LastName,
      roleID: row.RoleID
    }));

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(personnelRows), {status: HTTPResponses.OK});
  } catch (error: any) {
    console.error('Error in GET Personnel:', error.message || error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  const quadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!, 10);
  if ((!schema || schema === 'undefined') || isNaN(quadratID)) throw new Error('Missing required parameters');

  try {
    const updatedPersonnelIDs: number[] = await request.json();

    conn = await getConn();
    await conn.beginTransaction();

    // Fetch current personnel IDs
    const currentPersonnelQuery = `SELECT PersonnelID FROM ${schema}.quadratpersonnel WHERE QuadratID = ?`;
    const currentPersonnelResult: { PersonnelID: number }[] = await runQuery(conn, currentPersonnelQuery, [quadratID]);
    const currentPersonnelIds = currentPersonnelResult.map(p => p.PersonnelID);

    // Determine personnel to add or remove
    const personnelToAdd = updatedPersonnelIDs.filter(id => !currentPersonnelIds.includes(id));
    const personnelToRemove = currentPersonnelIds.filter(id => !updatedPersonnelIDs.includes(id));

    // Remove personnel
    for (const personnelId of personnelToRemove) {
      await runQuery(conn, `DELETE FROM ${schema}.quadratpersonnel WHERE QuadratID = ? AND PersonnelID = ?`, [quadratID, personnelId]);
    }

    // Add new personnel associations
    for (const personnelId of personnelToAdd) {
      await runQuery(conn, `INSERT INTO ${schema}.quadratpersonnel (QuadratID, PersonnelID) VALUES (?, ?)`, [quadratID, personnelId]);
    }

    // Commit the transaction
    await conn.commit();

    return NextResponse.json({message: "Personnel updated successfully"}, {status: HTTPResponses.OK});
  } catch (error) {
    await conn?.rollback();
    console.error('Error:', error);
    throw new Error("Personnel update failed");
  } finally {
    if (conn) conn.release();
  }
}
