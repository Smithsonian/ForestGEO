import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

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
