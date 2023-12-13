import {NextResponse} from "next/server";

export async function POST() {
  return new NextResponse();
}

// import {NextRequest, NextResponse} from "next/server";
// import Papa, {ParseConfig} from "papaparse";
// import {
//   getContainerClient,
//   headers,
//   HTTPResponses,
//   RowDataStructure,
//   sqlConfig,
//   updateOrInsertRDS,
//   uploadFileAsBuffer,
// } from "@/config/macros";
// import sql from "mssql";
//
// require("dotenv").config();
//
// export async function POST(request: NextRequest) {
//   async function getSqlConnection() {
//     return await sql.connect(sqlConfig);
//   }
//
//   async function runQuery(conn: sql.ConnectionPool, query: string) {
//     if (!conn) {
//       throw new Error("invalid ConnectionPool object. check connection string settings.")
//     }
//     return await conn.request().query(query);
//   }
//
//   const formData = await request.formData();
//   const files = [];
//   const plot = request.nextUrl.searchParams.get('plot')!;
//   const user = request.nextUrl.searchParams.get('user')!;
//   for (const key of Array.from(formData.keys())) {
//     const file = formData.get(key) as File | null;
//     if (!file) return NextResponse.json({success: false});
//     // console.log(file);
//     files.push(file);
//   }
//   const errors: { [fileName: string]: { [currentRow: string]: string } } = {};
//   const uploadableRows: { [fileName: string]: RowDataStructure[]} = {};
//   const errorRows: { [fileName: string]: RowDataStructure[] } = {};
//
//   function createFileEntry(parsedFileName: string) {
//     if (errors[parsedFileName] == undefined) {
//       errors[parsedFileName] = {};
//     }
//   }
//
//   const config: ParseConfig = {
//     delimiter: ",",
//     header: true,
//     skipEmptyLines: true,
//     transformHeader: (h) => h.trim(),
//   };
//   let conn = await getSqlConnection();
//   if (!conn) {
//     return new NextResponse(
//       JSON.stringify({
//         responseMessage: "SQL connection failed",
//         errors: errors,
//         errorRows: errorRows,
//       }),
//       {status: HTTPResponses.SQL_CONNECTION_TIMEOUT}
//     );
//   }
//   const containerClient = await getContainerClient(plot);
//   if (!containerClient) {
//     return new NextResponse(
//       JSON.stringify({
//         responseMessage: "Container Client connection failed",
//         errors: errors,
//         errorRows: errorRows,
//       }),
//       {status: HTTPResponses.STORAGE_CONNECTION_FAILURE}
//     );
//   }
//   else console.log(`container client created`);
//
//   for (const file of files) {
//     uploadableRows[file.name] = [];
//     errorRows[file.name] = [];
//     const results = Papa.parse(await file.text(), config);
//     results.data.forEach((row, i) => {
//       let uploadable = true;
//       let keys: string[] = Object.keys(row);
//       let values: string[] = Object.values(row);
//       keys.forEach((item, index) => {
//         if (item !== headers[index]) {
//           createFileEntry(file.name);
//           console.log("Headers test failed!");
//           errors[file.name]["headers"] = "Missing Headers";
//           uploadable = false;
//         }
//         if (values[index] == "" || undefined) {
//           createFileEntry(file.name);
//           console.log(errors[file.name][i]);
//           errors[file.name][i] = `MValue::${item}`;
//           uploadable = false;
//         }
//         if (item == "DBH" && parseInt(values[index]) < 1) {
//           createFileEntry(file.name);
//           console.log(errors[file.name][i]);
//           errors[file.name][i] = `WFormat::${item}`;
//           uploadable = false;
//         }
//       });
//       if (uploadable) {
//         let r: RowDataStructure = {tag: "", subquadrat: "", spcode: "", dbh: "", htmeas: "", codes: "", comments: ""};
//         keys.forEach((key) => {
//           switch (key) {
//             case 'Tag':
//               r.tag = row[key];
//               break;
//             case 'Subquadrat':
//               r.subquadrat = row[key];
//               break;
//             case 'SpCode':
//               r.spcode = row[key];
//               break;
//             case 'DBH':
//               r.dbh = row[key];
//               break;
//             case 'Htmeas':
//               r.htmeas = row[key];
//               break;
//             case 'Codes':
//               r.codes = row[key];
//               break;
//             case 'Comments':
//               r.comments = row[key];
//               break;
//           }
//         });
//         uploadableRows[file.name].push(r);
//       } else {
//         let r: RowDataStructure = {codes: "", comments: "", dbh: "", htmeas: "", spcode: "", subquadrat: "", tag: ""};
//         keys.forEach((key) => {
//           switch (key) {
//             case 'Tag':
//               r.tag = row[key];
//               break;
//             case 'Subquadrat':
//               r.subquadrat = row[key];
//               break;
//             case 'SpCode':
//               r.spcode = row[key];
//               break;
//             case 'DBH':
//               r.dbh = row[key];
//               break;
//             case 'Htmeas':
//               r.htmeas = row[key];
//               break;
//             case 'Codes':
//               r.codes = row[key];
//               break;
//             case 'Comments':
//               r.comments = row[key];
//               break;
//           }
//         });
//         errorRows[file.name].push(r);
//       }
//     });
//     if (!results.data.length) {
//       console.log("No data for upload!");
//       createFileEntry(file.name);
//       errors[file.name]["error"] = "Empty file";
//       return new NextResponse(
//         JSON.stringify({
//           responseMessage: "Empty File",
//           errors: errors,
//           errorRows: errorRows,
//         }),
//         {status: HTTPResponses.EMPTY_FILE}
//       );
//     }
//     if (results.errors.length) {
//       createFileEntry(file.name);
//       console.log(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
//       errors[file.name][results.errors[0].row] = results.errors[0].type + ',' + results.errors[0].code + ',' + results.errors[0].message;
//     }
//   }
//   for (const file of files) {
//     let uploadResponse;
//     uploadResponse = await uploadFileAsBuffer(containerClient, file, user, (Object.keys(errors).length == 0));
//     console.log(`upload complete: ${uploadResponse!.requestId}`);
//     if (uploadResponse!._response.status >= 200 && uploadResponse!._response.status <= 299) {
//       // upload complete:
//       for (const row of uploadableRows[file.name]) {
//         let result = await runQuery(conn, updateOrInsertRDS(row, plot));
//         if (!result) console.error('results undefined');
//         else console.log(`tag ${row.tag} of file ${file.name} submitted to db`);
//       }
//     }
//   }
//   await conn.close();
//   // console.log('no errors. uploading file');
//   if (Object.keys(errors).length == 0) {
//     return new NextResponse(
//       JSON.stringify({
//         responseMessage: "Files uploaded successfully. No errors in file",
//         errors: errors,
//         errorRows: errorRows,
//       }),
//       {status: HTTPResponses.NO_ERRORS}
//     );
//   } else {
//     return new NextResponse(
//       JSON.stringify({
//         responseMessage: "Files uploaded successfully. Errors in file",
//         errors: errors,
//         errorRows: errorRows,
//       }),
//       {status: HTTPResponses.ERRORS_IN_FILE}
//     );
//   }
// }