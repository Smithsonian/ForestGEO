'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/joy';
import CircularProgress from '@mui/joy/CircularProgress';
import { Warning } from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  const { error, reset } = props;
  const { data: session } = useSession();
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);
  const router = useRouter();
  if (error.message === 'access-denied') {
    return (
      <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
        <Alert
          variant={'soft'}
          color={'danger'}
          invertedColors
          startDecorator={
            <CircularProgress size="lg" color="danger">
              <Warning />
            </CircularProgress>
          }
          sx={{ alignItems: 'flex-start', gap: '1rem' }}
        >
          <Stack spacing={1} direction={'column'}>
            <Typography level={'title-lg'}>Access Denied</Typography>
            <Typography level={'body-md'}>Unfortunately, you do not have access to this webpage.</Typography>
            <Stack direction={'row'} spacing={1}>
              <Typography level={'body-md'}>Your assigned role is </Typography>
              <Typography level={'body-md'} fontWeight={'bold'} color={'primary'}>
                {session?.user?.userStatus}
              </Typography>
            </Stack>
            <Typography level={'body-md'}>Please submit a GitHub issue if this is incorrect and you should have access to this page.</Typography>
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button variant={'soft'} onClick={() => router.push('/dashboard')}>
                Return to Dashboard
              </Button>
              <Button variant={'solid'} onClick={() => router.back()}>
                Go Back
              </Button>
            </Box>
          </Stack>
        </Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
      <Alert
        variant={'soft'}
        color={'danger'}
        invertedColors
        startDecorator={
          <CircularProgress size="lg" color="danger">
            <Warning />
          </CircularProgress>
        }
        sx={{ alignItems: 'flex-start', gap: '1rem' }}
      >
        <Stack spacing={1} direction={'column'}>
          <Typography level={'title-lg'}>Oh no!</Typography>
          <Typography level={'body-md'}>Something unexpected seems to have went wrong. </Typography>
          <Typography level={'body-md'}>Please provide the following metadata to an administrator so they can diagnose the problem further!</Typography>
          <Card>
            <CardContent>
              <Typography level={'title-lg'} fontWeight={'bold'} sx={{ mb: 2 }}>
                Metadata
              </Typography>
              <Divider />
              <Stack direction={'row'} spacing={1}>
                <Typography level={'body-md'} fontWeight={'bold'}>
                  Error Message:{' '}
                </Typography>
                <Typography level={'body-md'}>{error?.message ?? 'No error message received'}</Typography>
              </Stack>
            </CardContent>
          </Card>
          <Stack direction={'row'} spacing={1}>
            <Typography level={'body-md'}>Your assigned role is </Typography>
            <Typography level={'body-md'} fontWeight={'bold'} color={'primary'}>
              {session?.user?.userStatus}
            </Typography>
          </Stack>
          <Typography level={'body-md'}>Please submit a GitHub issue if this is incorrect and you should have access to this page.</Typography>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button variant={'soft'} onClick={() => router.push('/dashboard')}>
              Return to Dashboard
            </Button>
            <Button variant={'solid'} onClick={() => router.back()}>
              Go Back
            </Button>
          </Box>
        </Stack>
      </Alert>
    </Box>
  );
}
