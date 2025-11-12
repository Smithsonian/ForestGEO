'use client';

import { LabelList, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { Box } from '@mui/joy';
import { useEffect, useRef, useState } from 'react';
import ailogger from '@/ailogger';

export interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

export default function ProgressTachometer(props: ProgressTachoType) {
  const { TotalQuadrats: _TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats: _UnpopulatedQuadrats } = props;
  const [displayValue, setDisplayValue] = useState(0);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let frame: number;
    let cancelled = false;
    const timeouts: NodeJS.Timeout[] = [];

    const animateTo = (start: number, end: number, duration: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (cancelled) {
          reject(new Error('Animation cancelled'));
          return;
        }

        const startTime = performance.now();

        const step = (currentTime: number) => {
          if (cancelled) {
            reject(new Error('Animation cancelled'));
            return;
          }

          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const value = start + (end - start) * progress;

          setDisplayValue(parseFloat(value.toFixed(1)));

          if (progress < 1) {
            frame = requestAnimationFrame(step);
            animationRef.current = frame;
          } else {
            resolve();
          }
        };

        frame = requestAnimationFrame(step);
        animationRef.current = frame;
      });
    };

    const sleep = (ms: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (cancelled) {
          reject(new Error('Animation cancelled'));
          return;
        }
        const timeout = setTimeout(() => {
          if (cancelled) {
            reject(new Error('Animation cancelled'));
          } else {
            resolve();
          }
        }, ms);
        timeouts.push(timeout);
      });
    };

    const runAnimation = async () => {
      try {
        await animateTo(displayValue, 100, 600); // accelerate
        await sleep(250); // brief pause
        await animateTo(100, 0, 500); // decelerate
        await sleep(250); // brief pause
        await animateTo(0, PopulatedPercent ?? 0, 800); // move to actual
      } catch (error) {
        // Silently catch cancellation errors - they're expected during unmount
        if (error instanceof Error && error.message !== 'Animation cancelled') {
          ailogger.error('ProgressTachometer animation error:', error);
        }
      }
    };

    runAnimation();

    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [PopulatedPercent, displayValue]);

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="100%"
          innerRadius="100%"
          outerRadius="300%"
          barSize={20}
          data={[{ name: 'Completion', value: displayValue }]}
          startAngle={180}
          endAngle={0}
        >
          <PolarAngleAxis name="Quadrat Population" type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" background cornerRadius={10} fill="#3f51b5" isAnimationActive={true} animationDuration={500}>
            <LabelList dataKey="value" position="insideStart" formatter={() => `Populated: ${PopulatedQuadrats}`} />
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
    </Box>
  );
}
