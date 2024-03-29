import {NextRequest, NextResponse} from "next/server";
import {runValidationProcedure} from "@/components/processors/processorhelperfunctions";

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  // Use `get` method directly without `parseFloat`, to allow `undefined` values
  const minHOMParam = request.nextUrl.searchParams.get('minValue');
  const maxHOMParam = request.nextUrl.searchParams.get('maxValue');

  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;

  // Convert to numbers only if the parameters are not undefined
  const minHOM = minHOMParam !== null ? parseFloat(minHOMParam) : undefined;
  const maxHOM = maxHOMParam !== null ? parseFloat(maxHOMParam) : undefined;

  try {
    const validationResponse = await runValidationProcedure(schema, 'ValidateHOMUpperAndLowerBounds', plotID, censusID, minHOM, maxHOM);
    return new NextResponse(JSON.stringify(validationResponse), {status: 200});
  } catch (error: any) {
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  }
}
