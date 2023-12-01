import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {AttributeRDS} from "@/config/sqlmacros";
async function getSqlConnection(tries: number) {
  return await sql.connect(sqlConfig).catch((err) => {
    console.error(err);
    if (tries == 5) {
      throw new Error("Connection failure");
    }
    console.log("conn failed --> trying again!");
    getSqlConnection(tries + 1);
  });
}

async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}


export async function GET(): Promise<NextResponse<AttributeRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Attributes`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let attributeRows: AttributeRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    attributeRows.push({
      id: index + 1,
      code: row['Code'],
      description: row['Description'],
      status: row['Status']
    })
  })
  return new NextResponse(
    JSON.stringify(attributeRows),
    {status: 200}
  );
}

export async function DELETE(request: NextRequest) {
  
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteCode = request.nextUrl.searchParams.get('code')!;
  // let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.Attributes WHERE [Code] = '${deleteCode}'`);
  let deleteRow = await runQuery(conn, `SELECT * FROM forestgeo.Attributes WHERE [Code] = '${deleteCode}'`); // remove this once CRUD grid is working
  if (!deleteRow) throw new Error('deletion cmd failed');
  await conn.close();
  return NextResponse.json({ message: "Update successful", }, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const oldCode = request.nextUrl.searchParams.get('oldCode')!;
  let column = "";
  let param = "";
  let value: string;
  if (request.nextUrl.searchParams.has('newCode')) {
    // swapping code
    column = "Code";
    param = "newCode";
  } else if (request.nextUrl.searchParams.has('newDesc')) {
    // swapping desc
    column = "Description";
    param = "newDesc";
  } else if (request.nextUrl.searchParams.has('newStat')) {
    // swapping stat
    column = "Status";
    param = "newStat";
  }
  value = request.nextUrl.searchParams.get(param)!;
  if (column == "Code") {
    // validation: confirm that new Code is UNIQUE
    let codeValidation = await runQuery(conn, `SELECT * FROM forestgeo.Attributes WHERE [${String(column)}] = '${String(value)}'`);
    if (!codeValidation) throw new Error("call failed");
    if (codeValidation.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  }
  // let results = await runQuery(conn, `UPDATE forestgeo.Attributes SET [${String(column)}] = ${String(value)} where Code = ${String(oldCode)};`); // uncomment this once crud datagrid is working
  // if (!results) throw new Error("call failed");
  await conn.close();
  return NextResponse.json({ message: "Update successful", }, {status: 200});
}