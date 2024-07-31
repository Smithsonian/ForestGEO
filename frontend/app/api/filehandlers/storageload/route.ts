import {NextRequest, NextResponse} from 'next/server';
import {HTTPResponses} from '@/config/macros';
import {getContainerClient, uploadValidFileAsBuffer} from '@/config/macros/azurestorage';

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
    if (formData === null || formData === undefined || formData.entries().next().done) throw new Error();
  } catch (error) {
    return new NextResponse('File is required', {status: 400});
  }
  const fileName = request.nextUrl.searchParams.get('fileName')?.trim() ;
  const plot = request.nextUrl.searchParams.get("plot")?.trim();
  const census = request.nextUrl.searchParams.get("census")?.trim();
  const user = request.nextUrl.searchParams.get("user");
  const formType = request.nextUrl.searchParams.get('formType');
  const file = formData.get(fileName ?? 'file') as File | null;
  const fileRowErrors = formData.get('fileRowErrors') ? JSON.parse(<string>formData.get('fileRowErrors')) : [];

  if ((file === null || file === undefined) ||
    (fileName === undefined || fileName === null) ||
    (plot === undefined || plot === null) ||
    (census === undefined || census === null) ||
    (user === undefined || user === null) ||
    (formType === undefined || formType === null)) {

    return new NextResponse('Missing required parameters', {status: 400});
  }

  let containerClient;
  try {
    containerClient = await getContainerClient(`${plot.toLowerCase()}-${census.toLowerCase()}`);
  } catch (error: any) {
    console.error("Error getting container client:", error.message);
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error getting container client.",
        error: error.message,
      }),
      {status: HTTPResponses.INTERNAL_SERVER_ERROR}
    );
  }

  if (!containerClient) {
    console.error("Container client is undefined.");
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Container client is undefined",
      }),
      {status: HTTPResponses.INTERNAL_SERVER_ERROR}
    );
  }

  try {
    const uploadResponse = await uploadValidFileAsBuffer(containerClient, file, user, formType, fileRowErrors);
    console.log(`upload complete: ${uploadResponse?.requestId}`);
    if (uploadResponse && (uploadResponse._response.status < 200 || uploadResponse._response.status >= 300)) {
      throw new Error("Failure: Response status not between 200 & 299");
    }
  } catch (error: any) {
    console.error("File processing error:", error);
    return new NextResponse(
      JSON.stringify({
        responseMessage: "File Processing error",
        error: error.message ? error.message : 'Unknown error',
      }),
      {status: HTTPResponses.INTERNAL_SERVER_ERROR}
    );
  }

  return new NextResponse(JSON.stringify({message: "Insert to Azure Storage successful"}), {status: HTTPResponses.OK});
}
