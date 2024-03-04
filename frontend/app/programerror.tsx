'use client';
import React, {useEffect} from 'react';
import Divider from '@mui/joy/Divider';
import {Button, Card, CardContent} from '@mui/joy';

export default function ProgramError({error, reset}: Readonly<{ error: Error; reset: () => void; }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card variant="outlined" className="m-4">
      <CardContent>
        <h2>Something went wrong!</h2>
        <Divider/>
        <p>Error was: {error.message}</p>
        <p>Error cause: {error.cause as string}</p>
        <Button onClick={reset} variant="solid" color="danger">
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}