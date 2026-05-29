'use client';
import * as React from 'react';
import { Box, Card, Input, Skeleton } from '@mui/joy';

export type SkeletonKind = 'grid-rows' | 'dashboard-card' | 'autocomplete' | 'form-row';

export interface ContentSkeletonProps {
  kind: SkeletonKind;
  count?: number;
}

export function ContentSkeleton({ kind, count }: ContentSkeletonProps) {
  switch (kind) {
    case 'grid-rows':
      return <GridRowsSkeleton count={count ?? 8} />;
    case 'dashboard-card':
      return <DashboardCardSkeleton />;
    case 'autocomplete':
      return <AutocompleteSkeleton />;
    case 'form-row':
      return <FormRowSkeleton />;
  }
}

function GridRowsSkeleton({ count }: { count: number }) {
  return (
    <Box aria-busy="true" sx={{ p: 1 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Box
          key={i}
          data-testid="skeleton-grid-row"
          aria-hidden="true"
          sx={{ display: 'flex', gap: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Skeleton variant="text" width="10%" height={20} />
          <Skeleton variant="text" width="25%" height={20} />
          <Skeleton variant="text" width="20%" height={20} />
          <Skeleton variant="text" width="15%" height={20} />
          <Skeleton variant="text" width="20%" height={20} />
        </Box>
      ))}
    </Box>
  );
}

function DashboardCardSkeleton() {
  return (
    <Card
      data-testid="skeleton-dashboard-card"
      aria-busy="true"
      variant="soft"
      sx={{
        minHeight: '160px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        '@keyframes shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }} aria-hidden="true">
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" height={20} sx={{ mb: 2 }} />
          <Skeleton variant="text" width="80%" height={40} />
        </Box>
        <Skeleton variant="circular" width={56} height={56} />
      </Box>
      <Skeleton variant="text" width="40%" height={20} aria-hidden="true" />
    </Card>
  );
}

function AutocompleteSkeleton() {
  return <Input data-testid="skeleton-autocomplete-input" disabled placeholder="Loading…" aria-label="Loading" aria-busy="true" sx={{ opacity: 0.6 }} />;
}

function FormRowSkeleton() {
  return (
    <Box aria-busy="true">
      <Skeleton data-testid="skeleton-form-row" variant="text" width="100%" height={36} />
    </Box>
  );
}
