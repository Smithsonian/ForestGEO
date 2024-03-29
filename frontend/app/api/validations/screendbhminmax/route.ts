import { NextRequest, NextResponse } from "next/server";
import { runValidationProcedure } from "@/components/processors/processorhelperfunctions";

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  // Use `get` method directly without `parseFloat`, to allow `undefined` values
  const minDBHParam = request.nextUrl.searchParams.get('minValue');
  const maxDBHParam = request.nextUrl.searchParams.get('maxValue');

  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;

  // Convert to numbers only if the parameters are not 'undefined' or null
  const minDBH = minDBHParam !== 'undefined' && minDBHParam !== null ? parseFloat(minDBHParam) : null;
  const maxDBH = maxDBHParam !== 'undefined' && maxDBHParam !== null ? parseFloat(maxDBHParam) : null;

  try {
    const validationResponse = await runValidationProcedure(schema, 'ValidateScreenMeasuredDiameterMinMax', plotID, censusID, minDBH, maxDBH);
    return new NextResponse(JSON.stringify(validationResponse), { status: 200 });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
