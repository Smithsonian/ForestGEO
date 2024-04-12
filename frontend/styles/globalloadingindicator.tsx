"use client";
/**
 * GPT model-generated...
 */
/** @jsxImportSource @emotion/react */
import styled from '@emotion/styled';
import {css, keyframes} from '@emotion/react';
import React, {useEffect, useState} from 'react';
import Box from "@mui/joy/Box";
import Typography from '@mui/joy/Typography';
import {useLoading} from "@/app/contexts/loadingprovider";

interface StyledSegmentProps {
  gradientId: string;
}

const generateRandomColorOrder = (): string[] => {
  const colors = ['hsl(0, 100%, 85%)', 'hsl(39, 100%, 85%)', 'hsl(60, 100%, 85%)', 'hsl(120, 100%, 85%)', 'hsl(240, 100%, 85%)', 'hsl(300, 100%, 85%)'];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  return colors;
};

const rotate = keyframes`
  100% { transform: rotate(360deg); }
`;

// Restoring original swirl animation
const swirl = keyframes`
  100% { stroke-dashoffset: 15; }
`;

const segmentAnimation = (gradientId: string) => css`
  animation: ${rotate} 2s linear infinite, ${swirl} 6s linear infinite;
  stroke: url(#${gradientId});
`;

const StyledSegment = styled.circle<StyledSegmentProps>`
  fill: none;
  stroke-width: 4;
  stroke-dasharray: 15 55;
  stroke-linecap: round;
  transform-origin: center;
  ${({gradientId}) => segmentAnimation(gradientId)};
`;

export const GlobalLoadingIndicator: React.FC = () => {
  const {isLoading, loadingMessage} = useLoading();
  const [randomColors, setRandomColors] = useState<string[]>([]);
  const circumference = 44 * 2 * Math.PI;

  useEffect(() => {
    setRandomColors(generateRandomColorOrder());
  }, []);

  if (!isLoading) return null;

  const gradients = randomColors.map((color, index, arr) => {
    const nextColor = arr[(index + 1) % arr.length];
    return (
      <linearGradient key={index} id={`gradient-${index}`}>
        <stop offset="30%" stopColor={color}/>
        <stop offset="50%" stopColor={nextColor}/>
        <stop offset="70%" stopColor={nextColor}/>
      </linearGradient>
    );
  });

  return (
    <Box sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 2000
    }}>
      <Box sx={{textAlign: 'center', marginBottom: 2}}>
        <svg height={100} width={100} viewBox="0 0 52 52">
          <defs>
            {gradients}
          </defs>
          {randomColors.map((_, index) => (
            <StyledSegment
              key={`segment-${index}`}
              cx="26"
              cy="26"
              r="22"
              strokeDasharray={`${circumference / randomColors.length} ${circumference}`}
              strokeDashoffset={(circumference / randomColors.length) * index}
              gradientId={`gradient-${index}`}
            />
          ))}
        </svg>
      </Box>
      {loadingMessage && <Typography color={"danger"} level="h1">{loadingMessage}</Typography>}
    </Box>
  );
};
