'use client';

import { Button, Stack, Typography } from '@mui/joy';
import { signOut } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import ailogger from '@/ailogger';

// Map known reason slugs to user-facing messages. Unknown slugs fall through
// to a generic "contact administrator" message — never expose the raw slug.
const REASON_MESSAGES: Record<string, string> = {
  'permissions-unavailable': 'We could not reach the authentication service. This is usually temporary — please try again in a moment.'
};

const DEFAULT_MESSAGE = 'Login failure triggered without reason. Please speak to an administrator.';

const LoginFailed = () => {
  const searchParams = useSearchParams();
  const reasonSlug = searchParams?.get('reason') ?? '';
  const failureMessage = REASON_MESSAGES[reasonSlug] ?? DEFAULT_MESSAGE;

  const handleTryAgain = () => {
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
      <Typography>We couldn&apos;t log you in. Please try again or contact support for more help.</Typography>
      <Button variant="solid" onClick={handleTryAgain}>
        Try Again
      </Button>
    </Stack>
  );
};

export default LoginFailed;
