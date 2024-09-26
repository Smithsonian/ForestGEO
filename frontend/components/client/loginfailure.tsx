'use client';

import { Button, Stack, Typography } from '@mui/joy';
import { signOut } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

const LoginFailed = () => {
  const searchParams = useSearchParams();
  let failureReason = searchParams.get('reason');
  if (failureReason === null || failureReason === '') failureReason = 'Login failure triggered without reason. Please speak to an administrator';

  const handleTryAgain = () => {
    sessionStorage.clear();
    localStorage.clear();
    signOut({ callbackUrl: '/login' }).catch(console.error);
  };

  return (
    <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ width: '100%', mt: 4 }}>
      <Typography level="h4" component="h1" color={'danger'}>
        Oops! Login Failed
      </Typography>
      <Typography level="h4" component={'h5'} color={'warning'}>
        Failure caused due to {failureReason}
      </Typography>
      <Typography>We couldn&apos;t log you in. Please try again or contact support for more help.</Typography>
      <Button
        variant="solid"
        onClick={handleTryAgain} // Replace "azure-ad" with your provider's ID if different
      >
        Try Again
      </Button>
    </Stack>
  );
};

export default LoginFailed;
