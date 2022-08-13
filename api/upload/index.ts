import { AzureFunction, Context, HttpRequest } from "@azure/functions"

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
   
    let responseStatusCode: number
    let responseMessage: string

    if (req.body) {

        context.bindings.upload = req.body

        responseStatusCode = 201
        responseMessage = "File uploaded to the cloud successfully"

    }
    else {

        responseStatusCode = 400
        responseMessage = "Something went wrong"
    }

    context.res = {
        status: responseStatusCode,
        body: responseMessage
    }

};

export default httpTrigger;