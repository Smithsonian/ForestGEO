import {NextRequest, NextResponse} from "next/server";
import {getContainerClient} from "@/config/site";

export async function GET(request: NextRequest, response: NextResponse) {
  const plot = request.nextUrl.searchParams.get('plot')!;
  const containerClient = await getContainerClient(plot);
  if (!containerClient) return;
  else console.log(`container client created`);
  for await (const blob of containerClient.listBlobsFlat()) {
    const tempBlockBlobClient = containerClient.getBlockBlobClient(blob.name);
    console.log(`\n\tname: ${blob.name}\n\tURL: ${tempBlockBlobClient.url}\n`);
  }
}