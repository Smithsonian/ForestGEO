"use client";
/** @jsxImportSource @emotion/react */
import styled from '@emotion/styled';
import React from 'react';
import {keyframes} from '@emotion/react';
import {Logo} from '@/components/icons';

const generateForestColors = (): string[] => {
  const forestColors = [
    'hsl(140, 60%, 55%)',  // Bright Green (Tropical)
    'hsl(160, 50%, 30%)',  // Deep Jungle Green (Tropical)
    'hsl(100, 50%, 50%)',  // Fresh Spring Green (Temperate)
    'hsl(25, 85%, 55%)',   // Warm Autumn Orange (Temperate)
    'hsl(10, 60%, 40%)',   // Rich Autumn Red (Temperate)
    'hsl(120, 30%, 35%)',  // Pine Green (Boreal)
    'hsl(210, 40%, 50%)',  // Frosty Blue (Boreal)
    'hsl(270, 30%, 60%)',  // Mountain Lavender (Mountain)
    'hsl(220, 40%, 40%)',  // Alpine Blue (Mountain)
    'hsl(45, 50%, 60%)',   // Sandy Brown (Desert Edge)
    'hsl(75, 40%, 50%)',   // Cactus Green (Desert Edge)
    'hsl(300, 60%, 50%)',  // Bright Fuchsia (Flora)
    'hsl(330, 60%, 70%)'   // Soft Pink (Flora)
  ];
  return [...forestColors, ...forestColors, ...forestColors];
};

const waveAnimation = keyframes`
  from { background-position: 0% 50%; }
  to { background-position: -200% 50%; }
`;

const RainbowIconWrapper = styled.div`
  width: fit-content;
  height: fit-content;
  background: linear-gradient(90deg, ${generateForestColors().join(', ')});
  background-size: 300% 100%;
  filter: blur(0.2px);
  animation: ${waveAnimation} 10s linear infinite;
  mask: url(#logo-mask); // Apply the SVG mask
  -webkit-mask: url(#logo-mask);
`;

export const RainbowIcon: React.FC = () => {
  return (
    <RainbowIconWrapper>
      <svg width="0" height="0">
        <mask id="logo-mask">
          <Logo fill="white"/> {/* Mask uses white to indicate visible areas */}
        </mask>
      </svg>
      {/* Actual Logo component */}
      <Logo fill="transparent"/>
    </RainbowIconWrapper>
  );
};
