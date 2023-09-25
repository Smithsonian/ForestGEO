import {NextRequest, NextResponse} from "next/server";
import Papa, {ParseConfig} from "papaparse";
import {getContainerClient, headers, uploadFileAsBuffer} from "@/config/macros";

export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  const formData = await request.formData();
  const files = [];
  for (const key of Array.from(formData.keys())) {
    const file = formData.get(key) as File | null;
    if (!file) return NextResponse.json({success: false});
    // console.log(file);
    files.push(file);
  }
  const errors: { [fileName: string]: { [currentRow: string]: string } } = {};
  
  function createFileEntry(parsedFileName: string) {
    if (errors[parsedFileName] == undefined) {
      errors[parsedFileName] = {};
    }
  }
  
  const config: ParseConfig = {
    delimiter: ",",
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  };
  
  for (const file of files) {
    const results = Papa.parse(await file.text(), config);
    results.data.forEach((row, i) => {
      let keys: string[] = Object.keys(row);
      let values: string[] = Object.values(row);
      keys.forEach((item, index) => {
        if (item !== headers[index]) {
          createFileEntry(file.name);
          console.log("Headers test failed!");
          errors[file.name]["headers"] = "Missing Headers";
        }
        if (values[index] === "" || undefined) {
          createFileEntry(file.name);
          console.log(errors[file.name][i + 1]);
          errors[file.name][i + 1] = "Missing value";
        }
        if (item === "DBH" && parseInt(values[index]) < 1) {
          createFileEntry(file.name);
          console.log(errors[file.name][i + 1]);
          errors[file.name][i + 1] = "Check the value of DBH";
        }
      });
    });
    if (!results.data.length) {
      console.log("No data for upload!");
      createFileEntry(file.name);
      errors[file.name]["error"] = "Empty file";
    }
    if (results.errors.length) {
      createFileEntry(file.name);
      console.log(`Error on row: ${results.errors[0].row}. ${results.errors[0].message}`);
      errors[file.name][results.errors[0].row] = results.errors[0].message;
    }
  }
  if (Object.keys(errors).length === 0) {
    // sql testing
    return new NextResponse(
      JSON.stringify({
        responseMessage: "File(s) uploaded to the cloud successfully",
        errors: {},
      }),
      {status: 200}
    );
  } else {
    // console.log('error found. sending 400');
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Error(s)",
        errors: errors,
      }),
      {status: 403}
    );
  }
}