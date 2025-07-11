import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { updateValidatedRows } from '@/components/processors/processorhelperfunctions';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;

  try {
    await updateValidatedRows(schema, { p_CensusID: censusID, p_PlotID: plotID });
    return new NextResponse(JSON.stringify({}), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    console.error('Error in update operation:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
}
