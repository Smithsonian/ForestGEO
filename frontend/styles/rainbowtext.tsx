"use client";
/** @jsxImportSource @emotion/react */
import styled from '@emotion/styled';
import React from 'react';
import Typography from '@mui/joy/Typography';
import {keyframes} from '@emotion/react';

const generateDynamicColors = (): string[] => {
  // Adjusted to pastel colors with lower saturation and higher lightness
  const baseColors = [
    'hsl(0, 60%, 80%)',   // Pastel Red
    'hsl(39, 60%, 80%)',  // Pastel Orange
    'hsl(60, 60%, 80%)',  // Pastel Yellow
    'hsl(120, 60%, 80%)', // Pastel Green
    'hsl(240, 60%, 80%)', // Pastel Blue
    'hsl(275, 60%, 80%)', // Pastel Indigo
    'hsl(300, 60%, 80%)'  // Pastel Violet
  ];
  return [...baseColors, ...baseColors, ...baseColors];
};

const waveAnimation = keyframes`
  from { background-position: 0% 50%; }
  to { background-position: -200% 50%; }
`;

const RainbowText = styled(Typography)`
  background: linear-gradient(90deg, ${generateDynamicColors().join(', ')});
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: blur(0.2px); // Apply a slight blur to smooth transitions
  animation: ${waveAnimation} 10s linear infinite;
`;

export const RainbowTypography: React.FC<{ children: React.ReactNode }> = ({
                                                                             children
                                                                           }) => {
  return <RainbowText>{children}</RainbowText>;
};
