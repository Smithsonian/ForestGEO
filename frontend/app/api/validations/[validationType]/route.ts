import { NextRequest, NextResponse } from "next/server";
import { runValidationProcedure } from "@/components/processors/processorhelperfunctions";

export async function GET(request: NextRequest,  { params }: { params: { validationType: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const minValueParam = request.nextUrl.searchParams.get('minValue');
  const maxValueParam = request.nextUrl.searchParams.get('maxValue');
  const validationType = params.validationType;

  if (!schema) throw new Error('No schema variable provided!');
  if (!validationType) throw new Error('validationType object not provided!');

  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;
  const minValue = minValueParam !== 'undefined' && minValueParam !== null ? parseFloat(minValueParam) : null;
  const maxValue = maxValueParam !== 'undefined' && maxValueParam !== null ? parseFloat(maxValueParam) : null;

  try {
    const validationResponse = await runValidationProcedure(schema, validationType, plotID, censusID, minValue, maxValue);
    return new NextResponse(JSON.stringify(validationResponse), { status: 200 });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
