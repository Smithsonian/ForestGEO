'use client';

import React, { useEffect, useState } from 'react';
import { useLoading } from '@/app/contexts/loadingprovider';
import Box from '@mui/joy/Box';
import LinearProgress from '@mui/joy/LinearProgress';
import Typography from '@mui/joy/Typography';

export const ValidityLoadingIndicator: React.FC = () => {
  const { secondaryLoading } = useLoading();

  // State to track progress of each validity check
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    // Initialize the state for all keys when secondaryLoading updates
    const keys = Object.keys(secondaryLoading);
    setProgress(prevState => {
      const newState = { ...prevState };
      keys.forEach(key => {
        if (!(key in newState)) {
          newState[key] = 0; // Set initial state to 0% (start of progress)
        }
      });
      return newState;
    });
  }, [secondaryLoading]);

  useEffect(() => {
    // Update progress based on secondaryLoading changes
    Object.entries(secondaryLoading).forEach(([key, isLoading]) => {
      if (!isLoading && progress[key] !== 100) {
        setProgress(prevState => ({ ...prevState, [key]: 100 })); // Set progress to 100% on completion
      }
    });
  }, [secondaryLoading, progress]);

  // All checks complete when all progress values are 100%
  const allChecksComplete = Object.values(progress).every(val => val === 100);

  if (allChecksComplete) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)', // Dark mode background
        zIndex: 2000
      }}
    >
      <Box sx={{ textAlign: 'center', marginBottom: 2, width: '80%', maxWidth: 500 }}>
        {Object.keys(secondaryLoading).map(key => (
          <Box key={key} sx={{ marginBottom: 3 }}>
            <Typography color={'danger'} level="h2">{`Validating ${key}...`}</Typography>
            <LinearProgress determinate value={progress[key]} sx={{ height: 10, borderRadius: 5 }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
};
