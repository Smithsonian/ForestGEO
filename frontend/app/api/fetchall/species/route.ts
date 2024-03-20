import {NextRequest, NextResponse} from "next/server";
import {SpeciesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, runQuery, SpeciesResult} from "@/components/processors/processormacros";
import {bitToBoolean} from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<SpeciesRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const speciesRows: SpeciesRDS[] = results.map((row: SpeciesResult, index: number) => ({
      id: index + 1,
      speciesID: row.SpeciesID,
      genusID: row.GenusID,
      currentTaxonFlag: bitToBoolean(row.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(row.ObsoleteTaxonFlag),
      speciesName: row.SpeciesName,
      speciesCode: row.SpeciesCode,
      idLevel: row.IDLevel,
      authority: row.Authority,
      fieldFamily: row.FieldFamily,
      description: row.Description,
      referenceID: row.ReferenceID
    }));

    return new NextResponse(JSON.stringify(speciesRows), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}