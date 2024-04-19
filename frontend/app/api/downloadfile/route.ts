import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros/azurestorage";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from "@azure/storage-blob";

export async function GET(request: NextRequest) {
  const containerName = request.nextUrl.searchParams.get('container');
  const filename = request.nextUrl.searchParams.get('filename');
  const storageAccountConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!containerName || !filename || !storageAccountConnectionString) {
    return new NextResponse('Container name, filename, and storage connection string are required', {status: 400});
  }

  try {
    const containerClient = await getContainerClient(containerName); // Assuming "0" is a placeholder for the census
    if (!containerClient) {
      throw new Error('Failed to get container client');
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(storageAccountConnectionString);
    const blobClient = containerClient.getBlobClient(filename);

    // Setting up SAS token
    const sasOptions = {
      containerName,
      blobName: filename,
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + 3600 * 1000), // 1 hour expiration
      permissions: BlobSASPermissions.parse("r") // read-only permission
    };
    let sasToken = '';
    if (blobServiceClient.credential instanceof StorageSharedKeyCredential) {
      sasToken = generateBlobSASQueryParameters(sasOptions, blobServiceClient.credential).toString();
    }
    const url = `${blobClient.url}?${sasToken}`;

    return new NextResponse(JSON.stringify({url}), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Download file error:', error);
    return new NextResponse((error as Error).message, {status: 500});
  }
}