'use client';

import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/joy';

const GlobalErrorPage = ({ error, reset }: { error: Error; reset: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      reset();
    }, 5000);
    return () => clearTimeout(timer);
  }, [reset]);

  return (
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <Typography level="h1">An unexpected error occurred</Typography>
      <Typography level="body-lg">{error.message}</Typography>
      <Typography level="body-lg">Retrying in 5 seconds...</Typography>
      <Button onClick={reset}>Retry Now</Button>
    </Box>
  );
};

export default GlobalErrorPage;
