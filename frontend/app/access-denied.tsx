'use client';

import { Alert, Box, Button, Typography } from '@mui/joy';
import { Warning } from '@mui/icons-material';
import CircularProgress from '@mui/joy/CircularProgress';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AccessDenied() {
  const { data: session } = useSession();
  const router = useRouter();
  return (
    <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
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
        <Typography level={'title-lg'}>Access Denied</Typography>
        <Typography level={'body-md'}>Unfortunately, you do not have access to this webpage.</Typography>
        <Typography level={'body-md'}>Your assigned role is {session?.user?.userStatus}</Typography>
        <Typography level={'body-md'}>Please submit a GitHub issue if this is incorrect and you should have access to this page.</Typography>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Link href="/dashboard" passHref>
            <Button variant="soft" component="a">
              {' '}
              {/* Use component="a" to make it an anchor */}
              Return to Dashboard
            </Button>
          </Link>
          n
          <Button variant={'solid'} onClick={() => router.back()}>
            Go Back
          </Button>
        </Box>
      </Alert>
    </Box>
  );
}
