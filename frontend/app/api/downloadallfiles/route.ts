// DOWNLOAD ALL FILES ROUTE HANDLER
import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros";


export async function GET(request: NextRequest, response: NextResponse) {
  const plot = request.nextUrl.searchParams.get('plot')!.trim();
  const census = request.nextUrl.searchParams.get('census')!.trim();
  const blobData: any = [];
  const containerClient = await getContainerClient(plot, census);
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
