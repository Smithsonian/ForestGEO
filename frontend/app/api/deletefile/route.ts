import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros";

export async function DELETE(request: NextRequest) {
  const containerName = request.nextUrl.searchParams.get('container');
  const filename = request.nextUrl.searchParams.get('filename');

  if (!containerName || !filename) {
    return new NextResponse('Container name and filename are required', {status: 400});
  }

  try {
    const containerClient = await getContainerClient(containerName); // Adjust as needed
    if (!containerClient) return new NextResponse('Container name and filename are required', {status: 400});
    const blobClient = containerClient.getBlobClient(filename);

    await blobClient.delete();
    return new NextResponse('File deleted successfully', {status: 200});
  } catch (error) {
    console.error('Delete file error:', error);
    return new NextResponse((error as Error).message, {status: 500});
  }
}