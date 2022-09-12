import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { uploadFiles } from "../components/BlobUpload";
import parseMultipartFormData from "@anzp/azure-function-multipart";
import { parse, ParseConfig } from "papaparse";
import { ParsedFile } from "@anzp/azure-function-multipart/dist/types/parsed-file.type";
import { clientPrincipal } from "../components/BlobUpload";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  let responseStatusCode: number;
  let responseMessage: string;

  // get user info
  const header = req.headers['x-ms-client-principal'];
  const encoded = Buffer.from(header, 'base64');
  const decoded = encoded.toString('ascii');
  const userInfo: clientPrincipal = JSON.parse(decoded);



  if (req.body) {
    const { fields, files } = await parseMultipartFormData(req);
    const plot = req.query.plot;

    // simple validation here
    const headers = [
      "Tag",
      "Subquadrat",
      "SpCode",
      "DBH",
      "Htmeas",
      "Codes",
      "Comments",
    ];

    // array for collected errors
    const errors: { [fileName: string]: { [currentRow: string]: string } } = {};

    function createFileEntry(parsedFile: ParsedFile) {
      if (errors[parsedFile.filename] == undefined) {
        errors[parsedFile.filename] = {};
      }
    }

    for (const parsedFile of files) {
      // without the transformHeader parameter first header is parsed with quotes

      const config: ParseConfig = {
        delimiter: ",",
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      };
      const results = parse(parsedFile.bufferFile.toString("utf-8"), config);

      // If there is no data, send response immediately
      if (!results.data.length) {
        console.log("No data for upload!");
        context.res = {
          status: 400,
          body: {
            responseMessage: "No data for upload!",
            errors: {},
            headers: {
              "Content-Type": "application/json",
            },
          },
        };
        return;
      }

      results.data.map((csv, index) => {
        const csvHeaders = Object.keys(csv);
        const currentRow = index + 1;

        if (!csvHeaders.every((entry) => headers.includes(entry))) {
          createFileEntry(parsedFile);
          console.log("Headers test failed!");
          errors[parsedFile.filename]["headers"] = "Missing Headers";
        }

        csvHeaders.map((key) => {
          if (csv[key] === "" || undefined) {
            createFileEntry(parsedFile);
            errors[parsedFile.filename][currentRow] = "Missing value";
            console.log(errors[parsedFile.filename][currentRow]);
          } else if (key === "DBH" && parseInt(csv[key]) < 1) {
            createFileEntry(parsedFile);
            errors[parsedFile.filename][currentRow] = "Check the value of DBH";
            console.log(errors[parsedFile.filename][currentRow]);
          }
        });
      });
      if (results.errors.length) {
        createFileEntry(parsedFile);
        console.log(
          `Error on row: ${results.errors[0].row}. ${results.errors[0].message}`
        );
        errors[parsedFile.filename][results.errors[0].row] =
          results.errors[0].message;
      }
    }

    if (Object.keys(errors).length === 0) {
      uploadFiles(files, plot, userInfo);
      context.res = {
        status: 201,
        body: {
          responseMessage: "File(s) uploaded to the cloud successfully",
          errors: {},
          headers: {
            "Content-Type": "application/json",
          },
        },
      };
      return;
    } else {
      context.res = {
        status: 400,
        body: {
          responseMessage: "Error(s)",
          errors: errors,
          headers: {
            "Content-Type": "application/json",
          },
        },
      };
      return;
    }
  } else {
    responseStatusCode = 400;
    responseMessage = "Something went wrong";
  }

  context.res = {
    status: responseStatusCode,
    body: responseMessage,
  };
};

export default httpTrigger;
