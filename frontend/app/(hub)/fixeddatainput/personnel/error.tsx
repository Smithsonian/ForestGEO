'use client';

import React from 'react';
import { Box, Button, Typography } from '@mui/joy';

const ErrorPage = ({ error, reset }: { error: Error; reset: () => void }) => {
  return (
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <Typography level="h1">Something went wrong - Personnel Page</Typography>
      <Typography level="body-lg">{error.message}</Typography>
      <Button onClick={reset}>Retry Now</Button>
    </Box>
  );
};

export default ErrorPage;
