import {NextResponse} from "next/server";
import {PlotRDS} from "@/config/sqlmacros";
import {getSqlConnection, runQuery} from "@/components/processors/processorhelpers";

export async function GET(): Promise<NextResponse<PlotRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM ${schema}.Plots`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let plotRows: PlotRDS[] = []
  Object.values(results.recordset).forEach((row, index) => {
    plotRows.push({
      id: index + 1,
      plotID: row['PlotID'],
      plotName: row['PlotName'],
      locationName: row['LocationName'],
      countryName: row['CountryName'],
      area: row['Area'],
      plotX: row['PlotX'],
      plotY: row['PlotY'],
      plotZ: row['PlotZ'],
      plotShape: row['PlotShape'],
      plotDescription: row['PlotDescription']
    })
  })
  return new NextResponse(
    JSON.stringify(plotRows),
    {status: 200}
  );
}
