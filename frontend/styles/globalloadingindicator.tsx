'use client';
/**
 * GPT model-generated...
 */
/** @jsxImportSource @emotion/react */
import styled from '@emotion/styled';
import { css, keyframes } from '@emotion/react';
import React, { useEffect, useState } from 'react';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import { useLoading } from '@/app/contexts/loadingprovider';

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
    100% {
        transform: rotate(360deg);
    }
`;

// Restoring original swirl animation
const swirl = keyframes`
    100% {
        stroke-dashoffset: 15;
    }
`;

const segmentAnimation = (gradientId: string) => css`
  animation:
    ${rotate} 2s linear infinite,
    ${swirl} 6s linear infinite;
  stroke: url(#${gradientId});
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const StyledSegment = styled.circle<StyledSegmentProps>`
  fill: none;
  stroke-width: 4;
  stroke-dasharray: 15 55;
  stroke-linecap: round;
  transform-origin: center;
  ${({ gradientId }) => segmentAnimation(gradientId)};
`;

export const GlobalLoadingIndicator: React.FC = () => {
  const { isLoading, loadingMessage, activeOperations } = useLoading();
  const [randomColors, setRandomColors] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const circumference = 44 * 2 * Math.PI;

  useEffect(() => {
    setRandomColors(generateRandomColorOrder());
  }, []);

  // Update current time every second for duration display
  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading) return null;

  // Calculate operation durations
  // CRITICAL FIX: Ensure both timestamps are in milliseconds and handle edge cases
  const operationsWithDuration = activeOperations.map(op => {
    const start = typeof op.startTime === 'number' ? op.startTime : Date.now();
    const duration = Math.floor((currentTime - start) / 1000);

    // If duration is negative or unreasonably large (>10 minutes), reset the operation
    if (duration < 0 || duration > 600) {
      return {
        ...op,
        duration: 0,
        startTime: currentTime // Reset to current time to fix timestamp issues
      };
    }

    return {
      ...op,
      duration
    };
  });

  const gradients = randomColors.map((color, index, arr) => {
    const nextColor = arr[(index + 1) % arr.length];
    return (
      <linearGradient key={index} id={`gradient-${index}`}>
        <stop offset="30%" stopColor={color} />
        <stop offset="50%" stopColor={nextColor} />
        <stop offset="70%" stopColor={nextColor} />
      </linearGradient>
    );
  });

  return (
    <>
      <Box
        role="alert"
        aria-live="assertive"
        aria-busy="true"
        aria-label={loadingMessage || 'Loading'}
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
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 2000,
          backdropFilter: 'blur(2px)'
        }}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Box sx={{ textAlign: 'center', marginBottom: 3 }} aria-hidden="true">
          <svg height={120} width={120} viewBox="0 0 52 52" role="presentation">
            <defs>{gradients}</defs>
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

        {loadingMessage && (
          <Typography
            color="neutral"
            level="h2"
            id="loading-message"
            sx={{
              color: 'white',
              textAlign: 'center',
              marginBottom: 2,
              textShadow: '2px 2px 4px rgba(0,0,0,0.5)'
            }}
          >
            {loadingMessage}
          </Typography>
        )}

        {operationsWithDuration.length > 1 && (
          <Box
            sx={{
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 2,
              padding: 2,
              maxWidth: '80vw',
              maxHeight: '30vh',
              overflow: 'auto'
            }}
          >
            <Typography
              level="body-sm"
              sx={{
                color: 'rgba(255, 255, 255, 0.8)',
                marginBottom: 1,
                textAlign: 'center'
              }}
            >
              Active Operations ({operationsWithDuration.length})
            </Typography>
            {operationsWithDuration.map(op => (
              <Box
                key={op.id}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 1,
                  padding: 1,
                  borderRadius: 1,
                  background: 'rgba(255, 255, 255, 0.05)'
                }}
              >
                <Typography
                  level="body-xs"
                  sx={{
                    color: 'white',
                    flex: 1,
                    textAlign: 'left'
                  }}
                >
                  {op.message}
                </Typography>
                <Typography
                  level="body-xs"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    minWidth: '60px',
                    textAlign: 'right',
                    fontSize: '0.7rem'
                  }}
                >
                  {op.duration}s
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {operationsWithDuration.length === 1 && operationsWithDuration[0].duration > 2 && (
          <Typography
            level="body-sm"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              marginTop: 1
            }}
          >
            {operationsWithDuration[0].duration}s elapsed
          </Typography>
        )}

        <Typography
          level="body-xs"
          sx={{
            color: 'rgba(255, 255, 255, 0.8)',
            marginTop: 3,
            textAlign: 'center',
            fontStyle: 'italic'
          }}
        >
          Please wait... User interactions are temporarily disabled
        </Typography>
      </Box>
    </>
  );
};
