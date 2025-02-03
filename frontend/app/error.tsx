'use client';

import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/joy';

const ErrorPage = (props: { error: Error; reset: () => void }) => {
  const { error, reset } = props;
  useEffect(() => {
    const timer = setTimeout(() => {
      reset();
    }, 5000);
    return () => clearTimeout(timer);
  }, [reset]);

  return (
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <Typography level="h1">Something went wrong</Typography>
      <Typography level="body-lg">{error?.message ?? 'No error message received...'}</Typography>
      <Typography level="body-lg">Retrying in 5 seconds...</Typography>
      <Button onClick={reset}>Retry Now</Button>
    </Box>
  );
};

export default ErrorPage;
