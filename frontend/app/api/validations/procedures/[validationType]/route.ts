import { NextRequest, NextResponse } from 'next/server';
import { runValidation } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';

export async function POST(request: NextRequest, { params }: { params: { validationType: string } }) {
  try {
    if (!params.validationType) throw new Error('validationProcedureName not provided');
    const body = await request.json();
    const { schema, validationProcedureID, cursorQuery, p_CensusID, p_PlotID, minDBH, maxDBH } = body;

    // Execute the validation procedure using the provided inputs
    const validationResponse = await runValidation(validationProcedureID, params.validationType, schema, cursorQuery, {
      p_CensusID,
      p_PlotID,
      minDBH,
      maxDBH
    });

    return new NextResponse(JSON.stringify(validationResponse), {
      status: HTTPResponses.OK,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Error during validation:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
}
