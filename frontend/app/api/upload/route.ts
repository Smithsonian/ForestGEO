import {NextRequest, NextResponse} from "next/server";
import {
  FileErrors,
  getContainerClient,
  HTTPResponses,
  RowDataStructure,
  TableHeadersByFormType,
  uploadFileAsBuffer,
} from "@/config/macros";
import {parse, ParseConfig} from "papaparse";
import {getSqlConnection, insertOrUpdate} from "@/components/processors/processorhelpers";

require("dotenv").config();


export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = [];
  const plot = request.nextUrl.searchParams.get('plot')!;
  const census = request.nextUrl.searchParams.get('census')!;
  const user = request.nextUrl.searchParams.get('user')!;
  const formType = request.nextUrl.searchParams.get('formType')!; // Get form type from URL

  if (!formType || !TableHeadersByFormType[formType]) {
    // Handle the case where formType is not provided or not valid
    return new NextResponse(JSON.stringify({
      responseMessage: "Invalid or missing form type",
    }), {status: HTTPResponses.INVALID_REQUEST});
  }

  for (const key of Array.from(formData.keys())) {
    const file = formData.get(key) as File | null;
    if (!file) return NextResponse.json({success: false});
    files.push(file);
  }

  const errors: FileErrors = {};
  const uploadableRows: { [fileName: string]: RowDataStructure[] } = {};
  const errorRows: { [fileName: string]: RowDataStructure[] } = {};
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
      return; // Handle this error appropriately
    }

    const config: ParseConfig = {
      delimiter: ",",
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (value, field) => value,
    };

    const results = parse(await file.text(), config);

    // Initialize arrays for the file if not already done
    uploadableRows[file.name] = uploadableRows[file.name] || [];
    errorRows[file.name] = errorRows[file.name] || [];

    results.data.forEach((row: any, rowIndex: number) => {
      const typedRow = row as RowDataStructure;
      // assign ID to row:
      typedRow.id = `row-${rowIDCounter++}`;
      const invalidHeaders: string[] = [];

      // Check for missing or invalid values
      expectedHeaders.forEach(header => {
        const value = typedRow[header.label];
        if (value === null || value === undefined || value === '') {
          invalidHeaders.push(header.label);
        }
      });

      // Additional checks (e.g., DBH value)
      const dbhValue = parseInt(typedRow['DBH']);
      if (!isNaN(dbhValue) && dbhValue < 1) {
        invalidHeaders.push('DBH');
      }

      // Categorize the row as valid or invalid
      if (invalidHeaders.length > 0) {
        const errorMessage = `Invalid Row: Missing or incorrect values for ${invalidHeaders.join(', ')}`;
        console.error(`Error at index ${rowIndex} in file ${file.name}: ${errorMessage}`);
        createFileEntry(file.name);
        errors[file.name][rowIndex] = errorMessage;
        errorRows[file.name].push(typedRow);
      } else {
        uploadableRows[file.name].push(typedRow);
      }
    });

    // Handle parsing errors for the entire file
    if (results.errors.length) {
      results.errors.forEach(error => {
        createFileEntry(file.name);
        if (typeof error.row === 'number') {
          errors[file.name][error.row] = error.message;
        } else {
          // If the row number is undefined, handle the error accordingly
          // For example, adding a generic error message for the file
          errors[file.name]["fileError"] = error.message;
        }
      });
    }
  }


  for (const file of files) {
    await processFile(file, formType);
  }

  let conn;
  let containerClient;
  try {
    let i = 0;
    containerClient = await getContainerClient(plot, census);
    conn = await getSqlConnection(i);
    if (!conn) {
      throw new Error("SQL connection failed");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error processing files:', error.message);
      return new NextResponse(JSON.stringify({
        responseMessage: "Processing error",
        error: error.message,
      }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
    } else {
      // Handle cases where the error is not an instance of Error (rare)
      console.error('Unknown error processing files:', error);
      return new NextResponse(JSON.stringify({
        responseMessage: "Unknown processing error",
      }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
    }
  }
  if (!containerClient) {
    console.error('Container client is undefined. Cannot upload files.');
    // Handle the situation where containerClient is undefined
    return new NextResponse(JSON.stringify({
      responseMessage: "Container client is undefined",
    }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
  }
  if (!conn) {
    console.error('SQL connection is undefined. Cannot upload to tables.');
    // Handle the situation where containerClient is undefined
    return new NextResponse(JSON.stringify({
      responseMessage: "Container client is undefined",
    }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
  }

  for (const file of files) {
    let uploadResponse;
    try {
      uploadResponse = await uploadFileAsBuffer(containerClient, file, user, (Object.keys(errors).length == 0));
      console.log(`upload complete: ${uploadResponse.requestId}`);

      if (uploadResponse._response.status >= 200 && uploadResponse._response.status <= 299) {
        // File upload was successful, proceed with database operations

        // Process each uploadable row in the file
        for (const row of uploadableRows[file.name]) {
          try {
            // Call insertOrUpdate function for each row
            await insertOrUpdate(conn, formType, row, plot, census, user);
          } catch (error) {
            if (error instanceof Error) {
              console.error(`Error processing row for file ${file.name}:`, error.message);
              return new NextResponse(JSON.stringify({
                responseMessage: "Error processing row",
                error: error.message,
              }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
            } else {
              console.error('Unknown error processing row:', error);
              return new NextResponse(JSON.stringify({
                responseMessage: "Unknown processing error at row",
              }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
            }
            // Handle the error (e.g., log, return an error response, etc.)
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error('Error processing files:', error.message);
        return new NextResponse(JSON.stringify({
          responseMessage: "Processing error",
          error: error.message,
        }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
      } else {
        // Handle cases where the error is not an instance of Error (rare)
        console.error('Unknown error processing files:', error);
        return new NextResponse(JSON.stringify({
          responseMessage: "Unknown processing error",
        }), {status: HTTPResponses.INTERNAL_SERVER_ERROR});
      }
    }
  }
  // Determine the response based on whether there were errors
  if (Object.keys(errors).length === 0) {
    return new NextResponse(JSON.stringify({
      responseMessage: "Files uploaded successfully. No errors in file",
    }), {status: HTTPResponses.OK});
  } else {
    return new NextResponse(JSON.stringify({
      responseMessage: "Files uploaded successfully. Errors in file",
      errors: errors,
    }), {status: HTTPResponses.ERRORS_IN_FILE});
  }
}