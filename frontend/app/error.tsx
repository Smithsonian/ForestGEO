'use client';

import React, { useEffect } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/joy';
import ailogger from '@/ailogger';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';

const ErrorPage = (props: { error: Error & { digest?: string }; reset: () => void }) => {
  const { error, reset } = props;

  useEffect(() => {
    // Log the error to error reporting service
    ailogger.error(error.message || 'Unknown error occurred', error);

    const timer = setTimeout(() => {
      reset();
    }, 5000);
    return () => clearTimeout(timer);
  }, [error, reset]);

  return (
    <Box
      sx={{
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh'
      }}
    >
      <Alert
        color="danger"
        variant="soft"
        startDecorator={<ErrorIcon sx={{ fontSize: 32 }} />}
        sx={{
          mb: 3,
          p: 3,
          borderRadius: 'md',
          boxShadow: 'lg',
          maxWidth: 600
        }}
      >
        <Stack spacing={2}>
          <Typography level="h3" sx={{ fontWeight: 700, fontSize: '1.5rem' }}>
            Something went wrong
          </Typography>
          <Typography
            level="body-md"
            sx={{
              fontSize: '0.875rem',
              lineHeight: 1.6,
              fontFamily: 'monospace',
              backgroundColor: 'rgba(0, 0, 0, 0.05)',
              p: 1.5,
              borderRadius: 'sm'
            }}
          >
            {error?.message ?? 'No error message received...'}
          </Typography>
          {error?.digest && (
            <Typography level="body-sm" sx={{ opacity: 0.8, fontSize: '0.75rem' }}>
              Error ID: {error.digest}
            </Typography>
          )}
        </Stack>
      </Alert>
      <Alert color="warning" variant="outlined" startDecorator={<WarningIcon />} sx={{ mb: 3, maxWidth: 600 }}>
        <Typography level="body-md" sx={{ fontSize: '0.875rem' }}>
          Retrying automatically in 5 seconds...
        </Typography>
      </Alert>
      <Button onClick={reset} size="lg" color="primary" sx={{ minWidth: 200, minHeight: 44 }}>
        Retry Now
      </Button>
    </Box>
  );
};

export default ErrorPage;
