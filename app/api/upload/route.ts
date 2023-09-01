import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    console.log(json);
    let json_response = {
      status: "success",
    };
    return new NextResponse(JSON.stringify(json_response), {
      status: 201,
      headers: { "Content-Type": "text/csv" },
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      let error_response = {
        status: "fail",
        message: "Feedback with title already exists",
      };
      return new NextResponse(JSON.stringify(error_response), {
        status: 409,
        headers: { "Content-Type": "text/csv" },
      });
    }
    
    let error_response = {
      status: "error",
      message: error.message,
    };
    return new NextResponse(JSON.stringify(error_response), {
      status: 500,
      headers: { "Content-Type": "text/csv" },
    });
  }
  // const data = await request.formData()
  // const file: File | null = data.get('file') as unknown as File
  //
  // if (!file) {
  //   return NextResponse.json({ success: false })
  // }
  //
  // const bytes = await file.arrayBuffer()
  // const buffer = Buffer.from(bytes)
  //
  // // With the file data in the buffer, you can do whatever you want with it.
  // // For this, we'll just write it to the filesystem in a new location
  // const path = `/tmp/${file.name}`
  // await writeFile(path, buffer)
  // console.log(`open ${path} to see the uploaded file`)
  //
  // return NextResponse.json({ success: true })
}