import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ primaryKey: string; schema: string; plotIDParam: string; censusIDParam: string; newCensusIDParam: string }>;
  }
) {
  const { primaryKey, schema, plotIDParam, censusIDParam, newCensusIDParam } = await props.params;
  if (!schema || !plotIDParam || !censusIDParam || !newCensusIDParam || !primaryKey) throw new Error('Missing core slugs from rollover op');
  return NextResponse.json({ message: 'rollover is not needed for this table!' }, { status: HTTPResponses.OK });
}
