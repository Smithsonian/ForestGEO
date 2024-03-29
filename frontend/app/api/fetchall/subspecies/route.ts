import {NextRequest, NextResponse} from "next/server";
import {SubSpeciesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery, SubSpeciesResult} from "@/components/processors/processormacros";
import {bitToBoolean} from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<SubSpeciesRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.subspecies`;
    const results = await runQuery(conn, query);

    const subSpeciesRows: SubSpeciesRDS[] = results.map((row: SubSpeciesResult, index: number) => ({
      id: index + 1,
      subSpeciesID: row.SubSpeciesID,
      speciesID: row.SpeciesID,
      currentTaxonFlag: bitToBoolean(row.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(row.ObsoleteTaxonFlag),
      subSpeciesName: row.SubSpeciesName,
      subSpeciesCode: row.SubSpeciesCode,
      authority: row.Authority,
      infraSpecificLevel: row.InfraSpecificLevel
    }));

    return new NextResponse(JSON.stringify(subSpeciesRows), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}