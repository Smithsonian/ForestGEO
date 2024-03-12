import {NextRequest, NextResponse} from "next/server";
import {getContainerClient, HTTPResponses, uploadValidFileAsBuffer} from "@/config/macros";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const fileName = request.nextUrl.searchParams.get('fileName')!.trim();
  const plot = request.nextUrl.searchParams.get("plot")!.trim();
  const census = request.nextUrl.searchParams.get("census")!.trim();
  const user = request.nextUrl.searchParams.get("user")!;
  const formType = request.nextUrl.searchParams.get('formType')!;
  const file = formData.get(fileName) as File | null;
  const fileRowErrors = formData.get('fileRowErrors') ? JSON.parse(<string>formData.get('fileRowErrors')) : [];
  if (!file) return NextResponse.error();
  let containerClient: any = null;
  try {
    containerClient = await getContainerClient(`${plot}-${census}`);
  } catch (error: any) {
    if (error instanceof Error) {
      console.error("Error getting container client:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Error getting container client.",
          error: error.message,
        }),
        {status: HTTPResponses.INTERNAL_SERVER_ERROR}
      );
    } else {
      console.error("Unknown error getting container client:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Unknown processing error while getting container client",
          error: error,
        }),
        {status: HTTPResponses.INTERNAL_SERVER_ERROR}
      );
    }
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

  let uploadResponse;
  try {
    uploadResponse = await uploadValidFileAsBuffer(containerClient, file, user, formType, fileRowErrors);
    console.log(`upload complete: ${uploadResponse?.requestId}`);
    if (uploadResponse && uploadResponse._response.status <= 200 && uploadResponse._response.status >= 299) throw new Error("Failure: Response status not between 200 & 299");
  } catch (error) {
    if (error instanceof Error) {
      console.error("File processing error:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "File Processing error",
          error: error.message,
        }),
        {status: HTTPResponses.INTERNAL_SERVER_ERROR}
      );
    } else {
      console.error("Unknown file processing error:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: "Unknown file processing error",
          error: error,
        }),
        {status: HTTPResponses.INTERNAL_SERVER_ERROR}
      );
    }
  }
  return new NextResponse(JSON.stringify({message: "Insert to Azure Storage successful"}), {status: 200});
}