import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, PersonnelResult, runQuery} from "@/components/processors/processormacros";
import {PersonnelRDS} from "@/config/sqlmacros";

export async function GET(request: NextRequest): Promise<NextResponse<PersonnelRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialLastName = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialLastName === '' ?
      `SELECT DISTINCT PersonnelID, FirstName, LastName, Role
      FROM ${schema}.personnel
      ORDER BY LastName
      LIMIT 5` :
      `SELECT DISTINCT PersonnelID, FirstName, LastName, Role
      FROM ${schema}.personnel
      WHERE LastName LIKE ?
      ORDER BY LastName
      LIMIT 5`;
    const queryParams = partialLastName === '' ? [] : [`%${partialLastName}%`];
    const results = await runQuery(conn, query, queryParams);

    const personnelRows: PersonnelRDS[] = results.map((row: PersonnelResult, index: number) => ({
      id: index + 1,
      personnelID: row.PersonnelID,
      firstName: row.FirstName,
      lastName: row.LastName,
      role: row.Role
      // ... other fields as needed
    }));

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(personnelRows), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Personnel:', error.message || error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}
