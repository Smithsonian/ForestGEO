import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { uploadFiles } from "../components/BlobUpload";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  let responseStatusCode: number;
  let responseMessage: string;

  console.log(context);

  if (req.body) {
    const acceptedFilesForm = req.body.parseFormBody();
    console.log(acceptedFilesForm);

    // uploadFiles();

    responseStatusCode = 201;
    responseMessage = "File uploaded to the cloud successfully";
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
