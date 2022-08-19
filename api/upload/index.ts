import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { uploadFiles } from "../components/BlobUpload";
import parseMultipartFormData from "@anzp/azure-function-multipart";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  let responseStatusCode: number;
  let responseMessage: string;

  // console.log(context);
  // console.log(req);
  if (req) {
  const { fields, files } = await parseMultipartFormData(req);
  console.log({ files });

    // uploadFiles(files); 

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
