'use client';

import { LabelList, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { Box, Chip, Stack, Typography } from '@mui/joy';
import { useEffect, useRef, useState } from 'react';

export interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

export default function ProgressTachometer(props: ProgressTachoType) {
  const { TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats } = props;
  const [displayValue, setDisplayValue] = useState(0);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let frame: number;
    let cancelled = false;

    const animateTo = (start: number, end: number, duration: number): Promise<void> => {
      return new Promise(resolve => {
        const startTime = performance.now();

        const step = (currentTime: number) => {
          if (cancelled) return;

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

    const runAnimation = async () => {
      await animateTo(displayValue, 100, 600); // accelerate
      await new Promise(res => setTimeout(res, 250)); // brief pause
      await animateTo(100, 0, 500); // decelerate
      await new Promise(res => setTimeout(res, 250)); // brief pause
      await animateTo(0, PopulatedPercent ?? 0, 800); // move to actual
    };

    runAnimation().catch(console.error);

    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [PopulatedPercent]);

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
            <LabelList dataKey="value" position="insideStart" formatter={() => `Populated: ${PopulatedQuadrats}/${TotalQuadrats}`} />
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
      <Box sx={{ mt: 2, textAlign: 'center', alignItems: 'center', width: '100%' }}>
        <Typography level="title-lg">{`Populated: ${PopulatedPercent}%`}</Typography>
        <Typography level="body-lg">{`The following quadrat names do not have any recorded data for this census!`}</Typography>
        <Stack direction={'row'} alignItems={'center'}>
          {UnpopulatedQuadrats.map(uq => (
            <Chip key={uq} color={'primary'}>
              {uq}
            </Chip>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
