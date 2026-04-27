'use client';
import * as React from 'react';
import { Box, LinearProgress } from '@mui/joy';

export interface LoadingBarProps {
  active: boolean;
  label?: string;
}

const VISIBLE_DELAY_MS = 150;

export function LoadingBar({ active, label = 'Refreshing data' }: LoadingBarProps) {
  const [visible, setVisible] = React.useState(false);
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const id = window.setTimeout(() => setVisible(true), VISIBLE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!visible) return null;

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' }}
    >
      <LinearProgress
        variant="soft"
        determinate={reducedMotion}
        value={reducedMotion ? 100 : undefined}
        sx={{ '--LinearProgress-thickness': '2px' }}
      />
      <Box component="span" sx={visuallyHidden}>{label}</Box>
    </Box>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
} as const;
