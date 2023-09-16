import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros";

const listOptions = {
  includeMetadata: true,
};

// key: lastModified, [fileName]: url string
export async function GET(request: NextRequest) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const blobData: any = [];
  const containerClient = await getContainerClient(plot);
  if (!containerClient) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
      }),
      {status: 403}
    );
  } else console.log(`container client created`);
  let i = 0;
  for await (const blob of containerClient.listBlobsFlat(listOptions)) {
    if (!blob) console.error('blob is undefined');
    // blobData.push({ key: i.toString(), filename: blob.name, metadata: blob.metadata! });
    blobData.push({key: ++i, name: blob.name, user: blob.metadata!.user, date: blob.properties.lastModified});
  }
  return new NextResponse(
    JSON.stringify({
      responseMessage: "List of files",
      blobData: blobData,
    }),
    {status: 200}
  );
}