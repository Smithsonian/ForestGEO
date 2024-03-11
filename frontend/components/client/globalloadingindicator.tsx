"use client";
import React from 'react';
import { useLoading } from '@/app/contexts/loadingprovider'; // Adjust the path as needed
import CircularProgress from "@mui/joy/CircularProgress";
import Box from "@mui/joy/Box";
import Typography from '@mui/joy/Typography';

export const GlobalLoadingIndicator: React.FC = () => {
  const { isLoading, loadingMessage } = useLoading();

  if (!isLoading) return null;

  return (
    <Box sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)', // Semi-transparent background
      zIndex: 2000 // Ensure it's above all other elements
    }}>
      <Box sx={{
        textAlign: 'center'
      }}>
        <CircularProgress />
        {loadingMessage && <Typography color={"danger"} level="h1" sx={{ mt: 2 }}>{loadingMessage}</Typography>}
      </Box>
    </Box>
  );
};
