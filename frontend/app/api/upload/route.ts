import {NextRequest, NextResponse} from "next/server";
import {
  FileErrors,
  HTTPResponses,
  RowDataStructure,
  sqlConfig,
  TableHeadersByFormType,
  uploadFileAsBuffer,
  yourInsertOrUpdateQuery,
} from "@/config/macros";
import sql from "mssql";
import {parse, ParseConfig} from "papaparse";
import {BlobServiceClient} from "@azure/storage-blob";

require("dotenv").config();

async function getContainerClient(plot: string, formType: string) {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  console.log('Connection String:', storageAccountConnectionString);

  if (!storageAccountConnectionString) {
    console.error("process envs failed");
    throw new Error("process envs failed");
  }
  // create client pointing to AZ storage system from connection string from Azure portal
  const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
  if (!blobServiceClient) throw new Error("blob service client creation failed");
  // attempt connection to pre-existing container --> additional check to see if container was found
  let containerClient = blobServiceClient.getContainerClient(plot.toLowerCase() + '-' + formType);
  if (!(await containerClient.exists())) await containerClient.create();
  else return containerClient;
}

async function getSqlConnection() {
  return await sql.connect(sqlConfig);
}

async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}

export async function POST(request: NextRequest) {
  /**
   * This code has been commented out b/c it is optimized for the first-iteration application
   * --> file upload and DB storage needs to be reworked to fit the new schema, but the core logic here is sound and should be retained
   */
  const formData = await request.formData();
  const files = [];
  const plot = request.nextUrl.searchParams.get('plot')!;
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

  function createFileEntry(parsedFileName: string) {
    if (errors[parsedFileName] === undefined) {
      errors[parsedFileName] = {};
    }
  }

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
      // Add a step to transform each row into RowDataStructure type
      transform: (value, field) => value,
    };

    const results = parse(await file.text(), config);

    results.data.forEach((row: any, rowIndex: number) => {
      const typedRow = row as RowDataStructure;
      const invalidHeaders: string[] = [];

      // Check if all headers have corresponding non-null, non-empty, and non-undefined values
      expectedHeaders.forEach(header => {
        const value = typedRow[header.label];
        if (value === null || value === undefined || value === '') {
          invalidHeaders.push(header.label);
        }
      });

      const dbhValue = parseInt(typedRow['DBH']); // Convert 'DBH' value to integer

      if (invalidHeaders.length > 0) {
        const emptyHeadersMessage = invalidHeaders.join(', ');
        console.error(`Invalid row at index ${rowIndex} in file ${file.name}. Invalid headers: ${emptyHeadersMessage}`);
        createFileEntry(file.name);
        errors[file.name][rowIndex] = `Invalid Row Format: Empty Headers - ${emptyHeadersMessage}`;
      } else if (!isNaN(dbhValue) && dbhValue < 1) {
        console.error(`Invalid DBH value at index ${rowIndex} in file ${file.name}`);
        createFileEntry(file.name);
        errors[file.name][rowIndex] = "Invalid DBH Value";
      } else {
        uploadableRows[file.name].push(typedRow);
      }
    });

    // Handle file-level errors and post-processing
    // Check for parsing errors
    if (results.errors.length) {
      const firstError = results.errors[0];
      if (firstError.row !== undefined) {
        createFileEntry(file.name);
        console.error(`Error on row: ${firstError.row}. ${firstError.message}`);
        errors[file.name][`${firstError.row}`] = firstError.type + ',' + firstError.code + ',' + firstError.message;
      } else {
        // Handle the case when row is undefined
        console.error(`Error in file: ${file.name}. ${firstError.message}`);
        errors[file.name]["fileError"] = firstError.type + ',' + firstError.code + ',' + firstError.message;
      }
    }
  }

  for (const file of files) {
    await processFile(file, formType);
  }

  let conn;
  let containerClient;
  try {
    containerClient = await getContainerClient(plot, formType);
    conn = await getSqlConnection();
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
            // Call your custom function for generating the insert/update query
            const query = yourInsertOrUpdateQuery(row, plot); // Modify this function as needed

            // Execute the query and log the result
            let result = await runQuery(conn, query);
            if (!result) console.error('results undefined');
            else console.log(`tag ${row.tag} of file ${file.name} submitted to db`);
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
    }), {status: HTTPResponses.NO_ERRORS});
  } else {
    return new NextResponse(JSON.stringify({
      responseMessage: "Files uploaded successfully. Errors in file",
      errors: errors,
    }), {status: HTTPResponses.ERRORS_IN_FILE});
  }
}