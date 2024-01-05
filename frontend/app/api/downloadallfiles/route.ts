import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/macros";

const listOptions = {
  includeMetadata: true,
  includeVersions: true,
};

export async function GET(request: NextRequest) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const blobData: any = [];
  const containerClient = await getContainerClient(plot);
  if (!containerClient) {
    return NextResponse.json({statusText: "Container client creation error"}, {status: 400});
  } else console.log(`container client created`);
  let i = 0;
  // for await (const blob of containerClient.listBlobsFlat(listOptions)) {
  //   if (!blob) {
  //     console.error('blob is undefined');
  //   } else if (!blob.metadata) {
  //     console.error('blob.metadata is undefined');
  //   } else {
  //     blobData.push({
  //       key: ++i,
  //       name: blob.name,
  //       user: blob.metadata.user,
  //       errors: blob.metadata.errors,
  //       version: blob.versionId!,
  //       isCurrentVersion: blob.isCurrentVersion!,
  //       date: blob.properties.lastModified
  //     });
  //   }
  // }
  // console.log(blobData);
  // return new NextResponse(JSON.stringify({ blobData: blobData }),
  //   {status: 200}
  // );
  return new NextResponse();
}