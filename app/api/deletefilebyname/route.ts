import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros";
import {BlobDeleteIfExistsResponse, BlobDeleteOptions} from "@azure/storage-blob";

export async function DELETE(request: NextRequest) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const filename = request.nextUrl.searchParams.get('filename')!;
  const containerClient = await getContainerClient(plot);
  if (!containerClient) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
      }),
      {status: 403}
    );
  }
  const blockBlobClient = containerClient.getBlockBlobClient(filename);
  if (!blockBlobClient) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
      }),
      {status: 403}
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
      {status: 400}
    );
  }
  return new NextResponse(
    JSON.stringify({
      responseMessage: "File Deleted",
      blobResponse: blobDeleteIfExistsResponse,
    }),
    {status: 201}
  );
}