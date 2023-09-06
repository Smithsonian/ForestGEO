import {NextRequest, NextResponse} from "next/server";


export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  const formData = await request.formData();
  console.log(`request: ${await request.text()}`);
  const formDataEntryValues = Array.from(formData.values());
  
  for (const formDataEntryValue in formDataEntryValues) {
    console.log(`moving through formData: ${formDataEntryValue}`);
    if (typeof formDataEntryValue === "object" && "arrayBuffer" in formDataEntryValue) {
      console.log(`found object/arraybuffer entry.`);
      const fil = formDataEntryValue as unknown as Blob;
      console.log(`converting to Blob: ${fil.name}`)
      const buffer = Buffer.from(await fil.arrayBuffer());
      console.log(buffer.toJSON());
    }
  }
  
  return NextResponse.json({ success: true });
};