import {NextRequest, NextResponse} from "next/server";
import Papa, {ParseConfig} from "papaparse";
import {headers} from "@/config/site";
import sql from "mssql";
require("dotenv").config();

export async function POST(request: NextRequest, response: NextResponse) {
  async function getSqlConnection() {
    return await sql.connect(process.env.AZURE_SQL_CONNECTION_STRING!);
  }
  
  async function runQuery(conn: sql.ConnectionPool, query: string) {
    try {
      if (!conn) {
        throw new Error("invalid ConnectionPool object. check connection string settings.")
      }
      return await conn.request().query(query);
    } catch (err: any) {
      console.error(err.message);
    }
  }
  const formData = await request.formData();
  const files = [];
  const plot = request.nextUrl.searchParams.get('plot')!;
  // console.log(plot);
  for (const key of Array.from(formData.keys())) {
    const file = formData.get(key) as File | null;
    if (!file) return NextResponse.json({success: false});
    // console.log(file);
    files.push(file);
  }
  const errors: { [fileName: string]: { [currentRow: string]: string } } = {};
  function createFileEntry(parsedFileName: string) {
    if (errors[parsedFileName] == undefined) {
      errors[parsedFileName] = {};
    }
  }
  const config: ParseConfig = {
    delimiter: ",",
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  };

  for (const file of files) {
    const results = Papa.parse(await file.text(), config);
    results.data.forEach((row, i) => {
      let keys: string[] = Object.keys(row);
      let values: string[] = Object.values(row);
      // console.log(`index: ${index}, row: ${row}`);
      keys.forEach((item, index) => {
        // console.log(`comparison: row key item: ${item}, headers[index]: ${headers[index]}`);
        if (item !== headers[index]) {
          createFileEntry(file.name);
          // console.log("Headers test failed!");
          errors[file.name]["headers"] = "Missing Headers";
        }
        if (values[index] === "" || undefined) {
          createFileEntry(file.name);
          errors[file.name][i + 1] = "Missing value";
          // console.log(errors[file.name][i + 1]);
        }
        if (item === "DBH" && parseInt(values[index]) < 1) {
          createFileEntry(file.name);
          errors[file.name][i + 1] = "Check the value of DBH";
          // console.log(errors[file.name][i + 1]);
        }
      });
    });
    if (!results.data.length) {
      // console.log("No data for upload!");
      createFileEntry(file.name);
      errors[file.name]["error"] = "Empty file";
      return;
    }

    if (results.errors.length) {
      createFileEntry(file.name);
      // console.log(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
      errors[file.name][results.errors[0].row] =
        results.errors[0].message;
    }
  }
  // sql testing
  let conn = await getSqlConnection();
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, 'SELECT * FROM ${plot.toLowercase()}');
  if(!results) console.log(`results undefined`);
  console.log(`${results!.output}`);
  await conn.close();
  // return/EOF
  if (Object.keys(errors).length === 0) {
    // console.log('no errors. uploading file');
    return new NextResponse(
      JSON.stringify({
        responseMessage: "File(s) uploaded to the cloud successfully",
        errors: {},
      }),
      { status: 201 }
    );
  } else {
    // console.log('error found. sending 400');
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
        errors: errors,
      }),
      {status: 400}
    );
  }
// const containerClient = await getContainerClient(plot);
// if (!containerClient) return NextResponse.json({success: false});
// else console.log(`container client created`);
// let uploadResponse = await uploadFileAsBuffer(containerClient, file);
// console.log(`upload complete: ${uploadResponse.requestId}`);
}
