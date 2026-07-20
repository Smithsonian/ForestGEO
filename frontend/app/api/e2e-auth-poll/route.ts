import { NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { E2E_AUTH_POLL_ALLOWED_SITES, E2E_AUTH_POLL_EMAIL, E2E_AUTH_POLL_USER_STATUS } from './constants';

/**
 * E2E-ONLY fresh-authorization poll stub.
 *
 * The measurement edit-plan apply/revert path re-polls the authoritative auth
 * service (config/editplan/authorization.ts, fetchAuthoritativeAuthorization)
 * before committing, and deliberately has NO e2e bypass: when
 * AUTH_FUNCTIONS_POLL_URL is unset or answers badly, /api/edits/apply 401s.
 * The hermetic real-DB Cypress jobs have no Azure Function to poll, so the
 * resolve-and-remove anchor could never exercise the apply step in CI.
 *
 * This route lets those jobs point AUTH_FUNCTIONS_POLL_URL at the dev server
 * itself and serve the poll shape ({ userStatus, allowedSites }) for exactly
 * the seeded e2e admin identity. The real authorization code is UNCHANGED —
 * it still fetches, validates the role, maps the sites, and 401s on any
 * unexpected answer; only the upstream it polls is swapped in e2e runs.
 *
 * Hard-gated like the e2e harness pages (app/e2e-upload-harness,
 * app/e2e-errors-harness): NEXT_PUBLIC_E2E_TESTING === 'true' AND
 * NODE_ENV !== 'production', otherwise 404. Production builds run with
 * NODE_ENV=production and NEXT_PUBLIC_E2E_TESTING=false, so this route can
 * never answer in a real deployment.
 */

export const runtime = 'nodejs';

function isE2EAuthPollEnabled(): boolean {
  return process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production';
}

export async function GET(request: Request) {
  if (!isE2EAuthPollEnabled()) {
    return NextResponse.json({ message: 'Not available.' }, { status: HTTPResponses.NOT_FOUND });
  }

  const email = new URL(request.url).searchParams.get('email');
  if (email !== E2E_AUTH_POLL_EMAIL) {
    // fetchAuthoritativeAuthorization treats 404 as "user not found" -> the
    // edit apply fails closed with 401, exactly like the real auth service.
    return NextResponse.json({ message: 'unknown user' }, { status: HTTPResponses.NOT_FOUND });
  }

  return NextResponse.json(
    {
      userStatus: E2E_AUTH_POLL_USER_STATUS,
      allowedSites: E2E_AUTH_POLL_ALLOWED_SITES
    },
    { status: HTTPResponses.OK }
  );
}
