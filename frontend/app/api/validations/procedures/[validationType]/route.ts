import { NextRequest, NextResponse } from 'next/server';
import { runValidation } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';

export async function POST(request: NextRequest, { params }: { params: { validationProcedureName: string } }) {
  try {
    const { schema, validationProcedureID, cursorQuery, p_CensusID, p_PlotID, minDBH, maxDBH, minHOM, maxHOM } = await request.json();

    if (!schema) throw new Error('Schema is required');
    if (!validationProcedureID || !params.validationProcedureName) throw new Error('Validation procedure details are required');
    if (!cursorQuery) throw new Error('Cursor query is required');

    // Execute the validation procedure using the provided inputs
    const validationResponse = await runValidation(validationProcedureID, params.validationProcedureName, schema, cursorQuery, {
      p_CensusID,
      p_PlotID,
      minDBH,
      maxDBH,
      minHOM,
      maxHOM
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
