// DOWNLOAD ALL FILES ROUTE HANDLER
import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros/azurestorage";
import { HTTPResponses } from "@/config/macros";


export async function GET(request: NextRequest) {
  const plot = request.nextUrl.searchParams.get('plot');
  const census = request.nextUrl.searchParams.get('census');

  if (!plot || !census) {
    return new NextResponse('Both plot and census parameters are required', {status: 400});
  }
  const blobData: any = [];
  const containerClient = await getContainerClient(`${plot}-${census}`);
  if (!containerClient) {
    return NextResponse.json({statusText: "Container client creation error"}, {status: 400});
  } else {
    console.log(`container client created`);
  }
  const listOptions = {
    includeMetadata: true,
    includeVersions: false,
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
          user: blob.metadata?.user,
          formType: blob.metadata?.FormType,
          fileErrors: blob.metadata?.FileErrorState ? JSON.parse(<string>blob.metadata?.FileErrorState) : '',
          date: blob.properties.lastModified
        });
    }
    return new NextResponse(
      JSON.stringify({
        responseMessage: "List of files",
        blobData: blobData,
      }),
      {status: HTTPResponses.OK}
    );
  } catch (error: any) {
    console.error('error in blob listing: ', error);
    return NextResponse.json({message: error.message}, {status: 400});
  }
}
