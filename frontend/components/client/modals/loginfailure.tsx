'use client';

import { useEffect } from 'react';
import { Button, Stack, Typography } from '@mui/joy';
import { signOut, useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import ailogger from '@/ailogger';
import { LOGIN_FAILURE_EVENT_NAME, LOGIN_FAILURE_REASONS } from '@/config/loginfailurereasons';

// Map known reason slugs to user-facing messages. Unknown slugs fall through
// to a generic "contact administrator" message — never expose the raw slug.
const REASON_MESSAGES: Record<string, string> = {
  [LOGIN_FAILURE_REASONS.PERMISSIONS_UNAVAILABLE]: 'We could not reach the authentication service. This is usually temporary — please try again in a moment.',
  [LOGIN_FAILURE_REASONS.USER_NOT_PROVISIONED]:
    'Your Microsoft sign-in worked, but no ForestGEO account has been set up for it yet. Retrying will not help — please ask a ForestGEO administrator to add your account.'
};

const DEFAULT_MESSAGE = 'Login failure triggered without reason. Please speak to an administrator.';

// The reason slug is attacker-controllable query input; cap what we forward
// to telemetry so a crafted URL cannot stuff arbitrary payloads into it.
const MAX_TELEMETRY_REASON_LENGTH = 100;

const LoginFailed = () => {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const reasonSlug = searchParams?.get('reason') ?? '';
  const failureMessage = REASON_MESSAGES[reasonSlug] ?? DEFAULT_MESSAGE;
  const isUserNotProvisioned = reasonSlug === LOGIN_FAILURE_REASONS.USER_NOT_PROVISIONED;
  const userEmail = session?.user?.email;

  // Surface the failure to App Insights with the exact email claim the session
  // presented. Server-side logs never leave the box, so for user-not-provisioned
  // this event is the only remotely queryable record of the one string an
  // administrator has to copy into catalog.users.
  useEffect(() => {
    ailogger.event(LOGIN_FAILURE_EVENT_NAME, {
      reason: reasonSlug.slice(0, MAX_TELEMETRY_REASON_LENGTH) || 'none',
      email: userEmail ?? 'unknown'
    });
  }, [reasonSlug, userEmail]);

  const handleSignOut = () => {
    sessionStorage.clear();
    localStorage.clear();
    signOut({ redirectTo: '/login' }).catch(ailogger.error);
  };

  return (
    <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ width: '100%', mt: 4 }}>
      <Typography level="h4" component="h1" color={'danger'}>
        Oops! Login Failed
      </Typography>
      <Typography level="h4" component={'h5'} color={'warning'}>
        {failureMessage}
      </Typography>
      <Typography>
        {isUserNotProvisioned
          ? 'Contact a ForestGEO administrator to request access. After your account has been added, sign out and log in again.'
          : "We couldn't log you in. Please try again or contact support for more help."}
      </Typography>
      <Button variant="solid" onClick={handleSignOut}>
        {isUserNotProvisioned ? 'Sign Out' : 'Try Again'}
      </Button>
    </Stack>
  );
};

export default LoginFailed;
