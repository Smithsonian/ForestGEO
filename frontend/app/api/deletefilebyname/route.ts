import {BlobDeleteIfExistsResponse, BlobDeleteOptions, BlobServiceClient} from "@azure/storage-blob";
import {NextRequest, NextResponse} from "next/server";
import {HTTPResponses} from "@/config/macros";

async function getContainerClient(plot: string) {
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
  let containerClient = blobServiceClient.getContainerClient(plot.toLowerCase());
  if (!(await containerClient.exists())) await containerClient.create();
  else return containerClient;
}

export async function DELETE(request: NextRequest) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const filename = request.nextUrl.searchParams.get('filename')!;
  const containerClient = await getContainerClient(plot);
  if (!containerClient) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
      }),
      {status: HTTPResponses.STORAGE_CONNECTION_FAILURE}
    );
  }
  const blockBlobClient = containerClient.getBlockBlobClient(filename);
  if (!blockBlobClient) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
      }),
      {status: HTTPResponses.STORAGE_CONNECTION_FAILURE}
    );
  }
  const options: BlobDeleteOptions = {
    deleteSnapshots: 'include' // or 'only'
  };
  const blobDeleteIfExistsResponse: BlobDeleteIfExistsResponse = await blockBlobClient.deleteIfExists(options);

  if (!blobDeleteIfExistsResponse.errorCode) {
    console.log(`deleted blob ${filename}`);
  } else {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "File Delete FAILURE",
      }),
      {status: HTTPResponses.GATEWAY_TIMEOUT}
    );
  }
  return new NextResponse(
    JSON.stringify({
      responseMessage: "File Deleted",
      blobResponse: blobDeleteIfExistsResponse,
    }),
    {status: HTTPResponses.OK}
  );
}