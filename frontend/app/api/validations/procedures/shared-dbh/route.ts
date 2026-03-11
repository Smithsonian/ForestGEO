import { NextRequest, NextResponse } from 'next/server';
import { runCombinedDBHValidations } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema, p_CensusID, p_PlotID } = body;

    if (!schema) {
      throw new Error('schema not provided');
    }

    const result = await runCombinedDBHValidations(schema, {
      p_CensusID,
      p_PlotID
    });

    if (!result.success) {
      return NextResponse.json(result, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }

    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error during combined DBH validation:', error.message);
    return NextResponse.json({ error: error.message, success: false }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
