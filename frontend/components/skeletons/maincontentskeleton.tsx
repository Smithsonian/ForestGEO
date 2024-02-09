"use client";
import React from 'react';
import Skeleton from '@mui/material/Skeleton';
import Box from '@mui/joy/Box';

function MainContentSkeleton() {
  return (
    <Box sx={{ padding: 2 }}>
      {/* Skeleton for a typical heading in the main content */}
      <Skeleton variant="text" height={40} width="60%" />
      <Skeleton variant="text" height={20} width="40%" />

      {/* Skeletons for content such as paragraphs or descriptions */}
      {Array.from(new Array(3)).map((_, index) => (
        <Skeleton key={index} variant="text" height={20} width={`${80 - index * 10}%`} sx={{ marginTop: 1 }} />
      ))}

      {/* Skeleton for a table or list - adjust as per your actual content */}
      <Box sx={{ marginTop: 2 }}>
        {Array.from(new Array(5)).map((_, index) => (
          <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Skeleton variant="rectangular" height={40} width="100%" />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default MainContentSkeleton;
