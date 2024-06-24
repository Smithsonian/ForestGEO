"use client";
/** @jsxImportSource @emotion/react */
import styled from '@emotion/styled';
import React, { useEffect } from 'react';
import { keyframes } from '@emotion/react';
import Typography from '@mui/joy/Typography';

// Define the colors based on the Acacia tree image
const acaciaColors = [
  '#6b8e23', // Olive Green
  '#8b4513', // Saddle Brown
  '#d2b48c', // Tan
  '#87ceeb', // Sky Blue
  '#556b2f', // Dark Olive Green
  '#87ceeb', // Sky Blue
  '#d2b48c', // Tan
  '#8b4513', // Saddle Brown
  '#6b8e23', // Olive Green
];

// Define the animation for the gradient colors
const waveAnimation = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 400% 50%; }
`;

const RainbowText = styled(Typography)`
  background: linear-gradient(90deg, ${acaciaColors.join(', ')});
  background-size: 400% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: blur(0.2px);
  animation: ${waveAnimation} 60s linear infinite;
`;

export const AcaciaVersionTypography: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const intervalId = setInterval(() => {
      const element = document.querySelector('.rainbow-text');
      if (element) {
        const styles = window.getComputedStyle(element);
        console.log('Background Position:', styles.backgroundPosition);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  return <RainbowText className="rainbow-text" level="h1">{children}</RainbowText>;
};
