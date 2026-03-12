import { NextRequest, NextResponse } from 'next/server';
import { runCombinedCrossCensusLocationValidations } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

// Cross-census validations JOIN across large tables and can legitimately
// take several minutes on 200K+ row datasets.  Allow up to 10 minutes so
// the request isn't killed by the platform while the procedure is running.
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema, p_CensusID, p_PlotID } = body;

    if (!schema) {
      throw new Error('schema not provided');
    }

    const result = await runCombinedCrossCensusLocationValidations(schema, {
      p_CensusID,
      p_PlotID
    });

    if (!result.success) {
      return NextResponse.json(result, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }

    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error during combined cross-census location validation:', error.message);
    return NextResponse.json({ error: error.message, success: false }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
