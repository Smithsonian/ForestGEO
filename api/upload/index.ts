import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { uploadFiles } from "../components/BlobUpload";
import parseMultipartFormData from "@anzp/azure-function-multipart";
import { parse, ParseConfig } from "papaparse";
import { ParsedFile } from "@anzp/azure-function-multipart/dist/types/parsed-file.type";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  let responseStatusCode: number;
  let responseMessage: string;

  if (req.body) {
    const { fields, files } = await parseMultipartFormData(req);
    const plot = req.query.plot;
    // console.log(files);

    // simple validation here
    const jsonResults: JSON[] = [];
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
    const errors: any = {};

    function createFileEntry(parsedFile: ParsedFile) {
      if (errors[parsedFile.filename] == undefined) {
        errors[parsedFile.filename] = {};
      };
    }

    for (const parsedFile of files) {
      // without the transformHeader parameter first header is parsed with quotes
      
      const config: ParseConfig = {
        delimiter: ",",
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),               

      };
      const results = parse(parsedFile.bufferFile.toString('utf-8'), config);
      console.log(results.data);

      // If there is no data, send response immediately?
      if (!results.data.length) {
        console.log("No data for upload!");
        context.res = {
          status: 400,
          body: {
            error: "No data for upload!"
          },
        };
      return
      }

      results.data.map((csv, index) => {
        const keys = Object.keys(csv);
        const currentRow = index + 1;

        if (!keys.every((entry) => headers.includes(entry))) {
          createFileEntry(parsedFile);
          console.log("Headers test failed!");
          errors[parsedFile.filename]["headers"] = "Missing Headers";
        }

        keys.map((key) => {
          if (csv[key] === "" || undefined) {
            createFileEntry(parsedFile);
            errors[parsedFile.filename][currentRow] = "Missing value in ";
            console.log(errors[parsedFile.filename][currentRow]);
          }
          else if (key === 'DBH' && (parseInt(csv[key]) < 1)) {
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
        errors[parsedFile.filename][results.errors[0].row] = results.errors[0].message;
      }
      console.log("Validation errors:", errors);
    }

    if (!errors.length) {
      uploadFiles(files, plot);
      responseStatusCode = 201;
      responseMessage = "File uploaded to the cloud successfully";
    } else {
      // send the response with errors
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
