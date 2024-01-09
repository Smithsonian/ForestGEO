import {BlobServiceClient} from "@azure/storage-blob";
import {NextRequest, NextResponse} from "next/server";

async function getContainerClient(plot: string) {
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!storageAccountConnectionString) {
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

export async function GET(request: NextRequest, response: NextResponse) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const blobData: any = [];
  const containerClient = await getContainerClient(plot);
  if (!containerClient) {
    return NextResponse.json({statusText: "Container client creation error"}, {status: 400});
  } else {
    console.log(`container client created`);
  }
  const listOptions = {
    includeMetadata: true,
    includeVersions: true,
  };
  let i = 0;
  try {
    for await (const blob of containerClient.listBlobsFlat(listOptions)) {
      if (!blob) console.error('blob is undefined');
      // blobData.push({ key: i.toString(), filename: blob.name, metadata: blob.metadata! });
      blobData.push(
        {
          key: ++i,
          name: blob.name,
          user: blob.metadata!.user,
          errors: blob.metadata!.errors,
          version: blob.versionId!,
          isCurrentVersion: blob.isCurrentVersion!,
          date: blob.properties.lastModified
        });
    }
  } catch (error) {
    console.error('error in blob listing: ', error);
  }

  return new NextResponse(
    JSON.stringify({
      responseMessage: "List of files",
      blobData: blobData,
    }),
    {status: 200}
  );
}
