import {NextRequest, NextResponse} from "next/server";
import Papa, {ParseConfig} from "papaparse";
import {getContainerClient, headers, uploadFileAsBuffer} from "@/config/macros";
import sql from "mssql";

require("dotenv").config();
const sqlConfig: any = {
  user: process.env.AZURE_SQL_USER!, // better stored in an app setting such as process.env.DB_USER
  password: process.env.AZURE_SQL_PASSWORD!, // better stored in an app setting such as process.env.DB_PASSWORD
  server: process.env.AZURE_SQL_SERVER!, // better stored in an app setting such as process.env.DB_SERVER
  port: parseInt(process.env.AZURE_SQL_PORT!), // optional, defaults to 1433, better stored in an app setting such as process.env.DB_PORT
  database: process.env.AZURE_SQL_DATABASE!, // better stored in an app setting such as process.env.DB_NAME
  authentication: {
    type: 'default'
  },
  options: {
    encrypt: true
  }
}

export async function POST(request: NextRequest) {
  function updateOrInsert(row: any) {
    return `
      IF EXISTS (SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row['Tag'])})
        UPDATE [plot_${plot.toLowerCase()}]
        SET Subquadrat = ${parseInt(row['Subquadrat'])}, SpCode = ${parseInt(row['SpCode'])}, DBH = ${parseFloat(row['DBH'])}, Htmeas = ${parseFloat(row['Htmeas'])}, Codes = '${row['Codes']}', Comments = '${row['Comments']}'
        WHERE Tag = ${parseInt(row['Tag'])};
      ELSE
        SELECT * FROM [plot_${plot.toLowerCase()}] WHERE Tag = ${parseInt(row['Tag'])};
    `;
  }
  
  async function getSqlConnection() {
    return await sql.connect(sqlConfig);
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
  const user = request.nextUrl.searchParams.get('user')!;
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
      keys.forEach((item, index) => {
        if (item !== headers[index]) {
          createFileEntry(file.name);
          console.log("Headers test failed!");
          errors[file.name]["headers"] = "Missing Headers";
        }
        if (values[index] === "" || undefined) {
          createFileEntry(file.name);
          console.log(errors[file.name][i + 1]);
          errors[file.name][i + 1] = "Missing value";
        }
        if (item === "DBH" && parseInt(values[index]) < 1) {
          createFileEntry(file.name);
          console.log(errors[file.name][i + 1]);
          errors[file.name][i + 1] = "Check the value of DBH";
        }
      });
    });
    if (!results.data.length) {
      console.log("No data for upload!");
      createFileEntry(file.name);
      errors[file.name]["error"] = "Empty file";
      return;
    }
    if (results.errors.length) {
      createFileEntry(file.name);
      console.log(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
      errors[file.name][results.errors[0].row] = results.errors[0].message;
    }
  }
  // return/EOF
  if (Object.keys(errors).length === 0) {
    // sql testing
    let conn = await getSqlConnection();
    if (!conn) throw new Error('sql connection failed');
    const containerClient = await getContainerClient(plot);
    if (!containerClient) return NextResponse.json({success: false});
    else console.log(`container client created`);
    for (const file of files) {
      let uploadResponse = await uploadFileAsBuffer(containerClient, file, user);
      console.log(`upload complete: ${uploadResponse.requestId}`);
      if (uploadResponse._response.status === 200 || uploadResponse._response.status === 201) {
        // upload complete:
        const results = Papa.parse(await file.text(), config);
        for (const row of results.data) {
          if (row['Tag']) { // sample test to make sure that values are NOT NULL
            let result = await runQuery(conn, updateOrInsert(row));
            if (!result) console.log('results undefined');
            else {
              console.log(`row ${row['Tag']} of file ${file.name} submitted to db`);
            }
          }
        }
      }
    }
    await conn.close();
    // console.log('no errors. uploading file');
    return new NextResponse(
      JSON.stringify({
        responseMessage: "File(s) uploaded to the cloud successfully",
        errors: {},
      }),
      {status: 201}
    );
  } else {
    // console.log('error found. sending 400');
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
        errors: errors,
      }),
      {status: 403}
    );
  }
}