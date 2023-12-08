import {AzureFunction, Context, HttpRequest} from "@azure/functions";
import showFiles from "../components/BlobDownload";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const plot = req.query.plot;
  console.log(plot);
  
  let responseStatusCode: number;
  let responseMessage: string;
  let responseHeaders: object;
  
  if (plot) {
    // proceed with blobDownload function
    const listOfFiles = await showFiles(plot);
    console.log(listOfFiles);
    if (!listOfFiles) {
      responseStatusCode = 400;
      responseHeaders = {"Content-Type": "application/json"};
      responseMessage = "Error(s)";
    } else {
      responseStatusCode = 200;
      responseHeaders = {"Content-Type": "application/json"};
      responseMessage = <any>listOfFiles;
    }
  } else {
    responseStatusCode = 400;
    responseMessage = "Something went wrong";
  }
  
  context.res = {
    status: responseStatusCode,
    headers: responseHeaders,
    body: responseMessage,
  };
};

export default httpTrigger;
