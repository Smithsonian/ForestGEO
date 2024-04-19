import mysql, {PoolConnection} from "mysql2/promise";
import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {PersonnelRDS, PersonnelResult} from '@/config/sqlrdsdefinitions/personnelrds';

export async function GET(request: NextRequest): Promise<NextResponse<PersonnelRDS[] | any>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  const quadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!);
  if (!schema || isNaN(quadratID)) throw new Error('Invalid parameters');

  try {
    conn = await getConn();
    const query = `
      SELECT p.PersonnelID, p.FirstName, p.LastName, p.Role
      FROM ${schema}.quadratpersonnel qp
      JOIN ${schema}.personnel p ON qp.PersonnelID = p.PersonnelID
      WHERE qp.QuadratID = ?
    `;
    const personnelResults = await runQuery(conn, query, [quadratID]);
    const personnelData: PersonnelRDS[] = personnelResults.map((row: PersonnelResult, index: number) => ({
      id: index + 1,
      personnelID: row.PersonnelID,
      firstName: row.FirstName,
      lastName: row.LastName,
      role: row.Role
    }));

    return new NextResponse(JSON.stringify(personnelData), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    return NextResponse.json({message: 'Failed to fetch personnel data'}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  const {quadratID, personnelID} = await request.json(); // Assuming these are passed in the request body
  if (!schema || !quadratID || !personnelID) throw new Error('Invalid parameters');

  try {
    conn = await getConn();
    const insertQuery = mysql.format(`
      INSERT INTO ${schema}.quadratpersonnel (QuadratID, PersonnelID)
      VALUES (?, ?)
    `, [quadratID, personnelID]);
    await runQuery(conn, insertQuery);
    return NextResponse.json({message: "Personnel added to quadrat"}, {status: 200});
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({message: 'Failed to add personnel'}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  const {quadratID, personnelID} = await request.json(); // Assuming these are passed in the request body
  if (!schema || !quadratID || !personnelID) throw new Error('Invalid parameters');

  try {
    conn = await getConn();
    const deleteQuery = mysql.format(`
      DELETE FROM ${schema}.quadratpersonnel
      WHERE QuadratID = ? AND PersonnelID = ?
    `, [quadratID, personnelID]);
    await runQuery(conn, deleteQuery);
    return NextResponse.json({message: "Personnel removed from quadrat"}, {status: 200});
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({message: 'Failed to remove personnel'}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}
