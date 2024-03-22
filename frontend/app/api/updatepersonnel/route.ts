import { NextRequest, NextResponse } from "next/server";
import mysql, { PoolConnection } from "mysql2/promise";
import { getConn, runQuery } from "@/components/processors/processormacros";

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  const quadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!, 10);
  if (!schema || isNaN(quadratID)) throw new Error('Missing required parameters');

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

    return NextResponse.json({ message: "Personnel updated successfully" }, { status: 200 });
  } catch (error) {
    await conn?.rollback();
    console.error('Error:', error);
    throw new Error("Personnel update failed");
  } finally {
    if (conn) conn.release();
  }
}
