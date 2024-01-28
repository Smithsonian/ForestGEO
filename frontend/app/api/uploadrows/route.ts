// NEW ROUTE HANDLER
import { NextRequest, NextResponse } from "next/server";
import {
  AllRowsData,
  ErrorRowsData,
  FileErrors,
  HTTPResponses,
  RequiredTableHeadersByFormType,
  RowDataStructure,
  TableHeadersByFormType,
} from "@/config/macros";
import { parse, ParseConfig } from "papaparse";
import { getSqlConnection, insertOrUpdate } from "@/components/processors/processorhelpers";
import { PoolConnection } from "mysql2/promise"; // Import PoolConnection type

require("dotenv").config();

export async function POST(request: NextRequest) {
  const body = await request.json();
  const rowsToParse = body.rowsToParse as RowDataStructure[];
  const plot = body.plot?.trim();
  const census = body.census?.trim();
  const user = body.user?.trim();
  const formType = body.formType?.trim();

  if (!formType || !TableHeadersByFormType[formType]) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Invalid or missing form type",
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const errors: FileErrors = {};
  const uploadableRows: { [fileName: string]: RowDataStructure[] } = {};
  const errorRows: ErrorRowsData = {};
  const allRows: AllRowsData = {};
  const warningRows: { [fileName: string]: RowDataStructure[] } = {};

  function createFileEntry(fileName: string) {
    if (!errors[fileName]) {
      errors[fileName] = {};
    }
    if (!errorRows[fileName]) {
      errorRows[fileName] = [];
    }
    if (!allRows[fileName]) {
      allRows[fileName] = [];
    }
    if (!uploadableRows[fileName]) {
      uploadableRows[fileName] = [];
    }
    if (!warningRows[fileName]) {
      warningRows[fileName] = [];
    }
  }

  let rowIDCounter = 0;

  function processRows(rows: RowDataStructure[], fileName: string) {
    const expectedHeaders = TableHeadersByFormType[formType];
    const requiredHeaders = RequiredTableHeadersByFormType[formType];
    if (!expectedHeaders || !requiredHeaders) {
      console.error(`No headers defined for form type: ${formType}`);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Retrieving expected headers failed.",
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
    }

    uploadableRows[fileName] = uploadableRows[fileName] || [];
    errorRows[fileName] = errorRows[fileName] || [];
    allRows[fileName] = allRows[fileName] || [];

    rows.forEach((typedRow: RowDataStructure, rowIndex: number) => {
      typedRow.id = `row-${rowIDCounter++}`;
      const invalidHeaders: string[] = [];

      requiredHeaders.forEach((header) => {
        const value = typedRow[header.label];
        if (value === null || value === undefined || value === "") {
          invalidHeaders.push(header.label);
        }
      });

      const dbhValue = parseInt(typedRow["DBH"]);
      if (!isNaN(dbhValue) && dbhValue < 1) {
        invalidHeaders.push("DBH");
      }
      allRows[fileName].push(typedRow);
      if (invalidHeaders.length > 0) {
        const errorMessage = `Invalid Row: Missing or incorrect values for ${invalidHeaders.join(", ")}`;
        console.error(`Error at index ${rowIndex} in file ${fileName}: ${errorMessage}`);
        createFileEntry(fileName);
        errors[fileName][rowIndex] = errorMessage;
        errorRows[fileName].push(typedRow);
      } else {
        uploadableRows[fileName].push(typedRow);
      }
    });
  }

  processRows(rowsToParse, "uploaded_data");

  let conn: PoolConnection | null = null; // Use PoolConnection type

  try {
    let i = 0; // Adjust this as needed
    conn = await getSqlConnection(i);
    if (!conn) {
      throw new Error("SQL connection failed");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error establishing SQL connection:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "SQL connection error",
          error: error.message,
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
    } else {
      console.error("Unknown error establishing SQL connection:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Unknown SQL connection error",
        }),
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      );
    }
  }

  for (const row of uploadableRows["uploaded_data"]) {
    try {
      // Call insertOrUpdate function for each row, passing the connection object
      await insertOrUpdate(conn, formType, row, plot, census, user);
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error processing row:", error.message);
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

  if (Object.keys(errors).length === 0) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Rows processed successfully. No errors in rows",
        allRows: allRows,
      }),
      { status: HTTPResponses.OK }
    );
  } else {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Rows processed successfully. Errors in rows",
        errors: errors,
        errorRows: errorRows,
        allRows: allRows,
      }),
      { status: HTTPResponses.ERRORS_IN_FILE }
    );
  }
}
