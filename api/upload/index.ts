import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { uploadFiles } from "../components/BlobUpload";
import parseMultipartFormData from "@anzp/azure-function-multipart";
import { parse, ParseConfig } from "papaparse";

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
    const errors: string[] = [];

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
      if (!results.data) {
        console.log("No data for upload!");
        errors.push("No data for upload!");
      }

      results.data.map((csv) => {
        const keys = Object.keys(csv);
        console.log(keys);

        if (!keys.every((entry) => headers.includes(entry))) {
          console.log("Headers test failed!");
          errors.push(
            "There are missing headers in the file " + parsedFile.filename
          );
        }

        for (const key of keys) {
          if (csv[key] === "" || undefined) {
            console.log("Missing value in " + key);
            errors.push("Missing value in " + key);
          }
        }
        // jsonResults.push(csv);
      });
      if (results.errors.length) {
        console.log(
          `Error on row: ${results.errors[0].row}. ${results.errors[0].message}`
        );
      }
      console.log("Validaton errors:", errors);
    }
    // check for headers
    // for (const csvContents of jsonResults) {
    //   const keys = Object.keys(csvContents);
    //   if (!keys.every(entry => headers.includes(entry))) {
    //     console.log('Headers test failed!')
    //   }
    //   console.log(result);

    // };

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
