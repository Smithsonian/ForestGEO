import { NextRequest, NextResponse } from "next/server";
import {
  ErrorRowsData,
  FileErrors,
  getContainerClient,
  HTTPResponses,
  RowDataStructure,
  TableHeadersByFormType,
  uploadFileAsBuffer,
} from "@/config/macros";
import { parse, ParseConfig } from "papaparse";
import {getSqlConnection, insertOrUpdate} from "@/components/processors/processorhelpers";
import {PoolConnection} from "mysql2/promise"; // Import PoolConnection type

require("dotenv").config();

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = [];
  const plot = request.nextUrl.searchParams.get("plot")!;
  const census = request.nextUrl.searchParams.get("census")!;
  const user = request.nextUrl.searchParams.get("user")!;
  const formType = request.nextUrl.searchParams.get("formType")!;

  if (!formType || !TableHeadersByFormType[formType]) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Invalid or missing form type",
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  for (const key of Array.from(formData.keys())) {
    const file = formData.get(key) as File | null;
    if (!file) return NextResponse.json({ success: false });
    files.push(file);
  }

  const errors: FileErrors = {};
  const uploadableRows: { [fileName: string]: RowDataStructure[] } = {};
  const errorRows: ErrorRowsData = {};
  const warningRows: { [fileName: string]: RowDataStructure[] } = {};

  function createFileEntry(fileName: string) {
    if (!errors[fileName]) {
      errors[fileName] = {};
    }
    if (!errorRows[fileName]) {
      errorRows[fileName] = [];
    }
    if (!uploadableRows[fileName]) {
      uploadableRows[fileName] = [];
    }
    if (!warningRows[fileName]) {
      warningRows[fileName] = [];
    }
  }

  let rowIDCounter = 0;

  async function processFile(file: File, formType: string) {
    const expectedHeaders = TableHeadersByFormType[formType];
    if (!expectedHeaders) {
      console.error(`No headers defined for form type: ${formType}`);
      return;
    }

    const config: ParseConfig = {
      delimiter: ",",
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (value, field) => value,
    };

    const results = parse(await file.text(), config);

    uploadableRows[file.name] = uploadableRows[file.name] || [];
    errorRows[file.name] = errorRows[file.name] || [];

    results.data.forEach((row: any, rowIndex: number) => {
      const typedRow = row as RowDataStructure;
      typedRow.id = `row-${rowIDCounter++}`;
      const invalidHeaders: string[] = [];

      expectedHeaders.forEach((header) => {
        const value = typedRow[header.label];
        if (value === null || value === undefined || value === "") {
          invalidHeaders.push(header.label);
        }
      });

      const dbhValue = parseInt(typedRow["DBH"]);
      if (!isNaN(dbhValue) && dbhValue < 1) {
        invalidHeaders.push("DBH");
      }

      if (invalidHeaders.length > 0) {
        const errorMessage = `Invalid Row: Missing or incorrect values for ${invalidHeaders.join(", ")}`;
        console.error(`Error at index ${rowIndex} in file ${file.name}: ${errorMessage}`);
        createFileEntry(file.name);
        errors[file.name][rowIndex] = errorMessage;
        errorRows[file.name].push(typedRow);
      } else {
        uploadableRows[file.name].push(typedRow);
      }
    });

    if (results.errors.length) {
      results.errors.forEach((error) => {
        createFileEntry(file.name);
        if (typeof error.row === "number") {
          errors[file.name][error.row] = error.message;
        } else {
          errors[file.name]["fileError"] = error.message;
        }
      });
    }
  }

  for (const file of files) {
    await processFile(file, formType);
  }

  let conn: PoolConnection | null = null; // Use PoolConnection type
  let containerClient: any = null;

  try {
    let i = 0;
    containerClient = await getContainerClient(plot, census);
    conn = await getSqlConnection(i);
    if (!conn) {
      throw new Error("SQL connection failed");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error processing files:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Processing error",
          error: error.message,
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
    } else {
      console.error("Unknown error processing files:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Unknown processing error",
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
    }
  }

  if (!containerClient || !conn) {
    console.error("Container client or SQL connection is undefined.");
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Container client or SQL connection is undefined",
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }

  for (const file of files) {
    if (errorRows[file.name].length !== 0) break;

    let uploadResponse;
    try {
      uploadResponse = await uploadFileAsBuffer(containerClient, file, user, Object.keys(errors).length == 0);
      console.log(`upload complete: ${uploadResponse.requestId}`);

      if (uploadResponse._response.status >= 200 && uploadResponse._response.status <= 299) {
        // File upload was successful, proceed with database operations
        // Process each uploadable row in the file
        for (const row of uploadableRows[file.name]) {
          try {
            // Call insertOrUpdate function for each row, passing the connection object
            await insertOrUpdate(conn, formType, row, plot, census, user);
          } catch (error) {
            if (error instanceof Error) {
              console.error(`Error processing row for file ${file.name}:`, error.message);
              return new NextResponse(
                JSON.stringify({
                  responseMessage: "Error processing row",
                  error: error.message,
                }),
                { status: HTTPResponses.INTERNAL_SERVER_ERROR }
              );
            } else {
              console.error("Unknown error processing row:", error);
              return new NextResponse(
                JSON.stringify({
                  responseMessage: "Unknown processing error at row",
                }),
                { status: HTTPResponses.INTERNAL_SERVER_ERROR }
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error processing files:", error.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: "Processing error",
            error: error.message,
          }),
          { status: HTTPResponses.INTERNAL_SERVER_ERROR }
        );
      } else {
        console.error("Unknown error processing files:", error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: "Unknown processing error",
          }),
          { status: HTTPResponses.INTERNAL_SERVER_ERROR }
        );
      }
    }
  }

  if (Object.keys(errors).length === 0) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Files uploaded successfully. No errors in file",
      }),
      { status: HTTPResponses.OK }
    );
  } else {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Files uploaded successfully. Errors in file",
        errors: errors,
        errorRows: errorRows,
      }),
      { status: HTTPResponses.ERRORS_IN_FILE }
    );
  }
}
