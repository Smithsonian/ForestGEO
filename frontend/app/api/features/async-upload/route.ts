import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireSession, getSessionUserIds } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { isAsyncUploadEnabledFor } from '@/lib/background-jobs/feature-gate';
import { fromQuery, withRouteAuthz } from '@/lib/route-authz';

export const runtime = 'nodejs';

async function getHandler(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const schema = searchParams.get('schema');
  const formType = searchParams.get('formType');

  return NextResponse.json(
    {
      enabled: isAsyncUploadEnabledFor({
        schema,
        formType,
        userIds: getSessionUserIds(session!)
      })
    },
    { status: HTTPResponses.OK }
  );
}

export const GET = withRouteAuthz('features/async-upload', getHandler, { schema: fromQuery('schema') });
