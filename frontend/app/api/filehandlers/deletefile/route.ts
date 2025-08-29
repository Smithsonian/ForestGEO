import { NextRequest, NextResponse } from 'next/server';
import { getContainerClient } from '@/config/macros/azurestorage';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export async function DELETE(request: NextRequest) {
  const containerName = request.nextUrl.searchParams.get('container');
  const filename = request.nextUrl.searchParams.get('filename');

  if (!containerName || !filename) {
    return new NextResponse('Container name and filename are required', {
      status: 400
    });
  }

  try {
    const containerClient = await getContainerClient(containerName.toLowerCase()); // Adjust as needed
    if (!containerClient)
      return new NextResponse('Container name and filename are required', {
        status: 400
      });
    const blobClient = containerClient.getBlobClient(filename);

    await blobClient.delete();
    return new NextResponse('File deleted successfully', {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('Delete file error:', error, { endpoint: request.nextUrl.toJSON() });
    return new NextResponse(JSON.stringify({ error: 'Failed to delete file: ' + (error.message || 'Unknown error') }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}
