import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ tableParam: string; schema: string; plotIDParam: string; censusIDParam: string; newCensusIDParam: string }>;
  }
) {
  const { tableParam, schema, plotIDParam, censusIDParam, newCensusIDParam } = await props.params;
  if (!schema || !plotIDParam || !censusIDParam || !newCensusIDParam || !tableParam) throw new Error('Missing core slugs from rollover op');
  return NextResponse.json({ message: 'rollover is not needed for this table!' }, { status: HTTPResponses.OK });
}
