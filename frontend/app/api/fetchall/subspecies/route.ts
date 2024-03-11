import {NextResponse} from "next/server";
import {SubSpeciesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, runQuery, SubSpeciesResult} from "@/components/processors/processormacros";
import {bitToBoolean} from "@/config/macros";

export async function GET(): Promise<NextResponse<SubSpeciesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Quadrats`;
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