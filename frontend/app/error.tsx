'use client';

import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/joy';
import ailogger from '@/ailogger';

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
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <Typography level="h1">Something went wrong</Typography>
      <Typography level="body-lg">{error?.message ?? 'No error message received...'}</Typography>
      {error?.digest && (
        <Typography level="body-sm" sx={{ mt: 1, opacity: 0.7 }}>
          Error ID: {error.digest}
        </Typography>
      )}
      <Typography level="body-lg">Retrying in 5 seconds...</Typography>
      <Button onClick={reset}>Retry Now</Button>
    </Box>
  );
};

export default ErrorPage;
