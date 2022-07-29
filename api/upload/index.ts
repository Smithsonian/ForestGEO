import { AzureFunction, Context, HttpRequest } from "@azure/functions";

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
    context.log('HTTP trigger function processed a request.');
    const { BlobServiceClient } = require("@azure/storage-blob");
    const blobSAS = 'https://forestgeostorage.blob.core.windows.net/?sv=2021-06-08&ss=b&srt=co&sp=rwdlactfx&se=2025-07-30T02:31:11Z&st=2022-07-29T18:31:11Z&spr=https&sig=A4dHzBAEB7itfT5He7ppVhnkFvdO%2F4xXYXRVIdAUpYM%3D';
    const blobServiceClient = new BlobServiceClient(blobSAS);


    const name = (req.query.name || (req.body && req.body.name));
    const responseMessage = name
        ? "Hello, " + name + ". This HTTP triggered function executed successfully."
        : "This HTTP triggered function executed successfully. Pass a name in the query string or in the request body for a personalized response.";

    context.res = {
        // status: 200, /* Defaults to 200 */
        body: responseMessage
    };

};

export default httpTrigger;