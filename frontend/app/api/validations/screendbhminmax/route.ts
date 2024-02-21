import {NextRequest, NextResponse} from "next/server";
import {runValidationProcedure} from "@/components/processors/processorhelperfunctions";

export async function GET(request: NextRequest) {
  try {
    const plotIDParam = request.nextUrl.searchParams.get('plotID');
    const censusIDParam = request.nextUrl.searchParams.get('censusID');
    const minDBH = parseFloat(request.nextUrl.searchParams.get('minValue')!);
    const maxDBH = parseFloat(request.nextUrl.searchParams.get('maxValue')!);
    const plotID = plotIDParam ? parseInt(plotIDParam) : null;
    const censusID = censusIDParam ? parseInt(censusIDParam) : null;


    const validationResponse = await runValidationProcedure('ValidateScreenMeasuredDiameterMinMax', plotID, censusID, minDBH, maxDBH);
    return new NextResponse(JSON.stringify(validationResponse), {status: 200});
  } catch (error: any) {
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  }
}
