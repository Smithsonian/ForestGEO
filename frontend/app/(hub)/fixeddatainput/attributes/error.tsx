'use client';

import React from 'react';
import { Box, Button, Typography } from '@mui/joy';

const ErrorPage = (props: { error: Error; reset: () => void }) => {
  const { error, reset } = props;
  return (
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <Typography level="h1">Something went wrong - Stem Codes Page</Typography>
      <Typography level="body-lg">{error?.message ?? 'No error message received'}</Typography>
      <Button onClick={reset}>Retry Now</Button>
    </Box>
  );
};

export default ErrorPage;
