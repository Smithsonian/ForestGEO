/**
 * Generic Overview Grid Component
 *
 * A reusable grid layout for displaying cards in various dashboard views.
 * Can be used for sites, plots, censuses, or any other card-based overview.
 *
 * Features:
 * - Responsive grid layout with configurable columns
 * - Loading skeleton support
 * - Empty state handling
 * - Section grouping with headers
 * - Add/action button support
 */

'use client';

import React, { ReactNode } from 'react';
import { Box, Card, CardContent, Typography, Avatar, Skeleton, Button, Divider, Stack } from '@mui/joy';
import AddIcon from '@mui/icons-material/Add';
import { designTokens } from '@/config/design-tokens';

// ============================================================================
// Types
// ============================================================================

export interface OverviewGridColumn {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export interface OverviewGridSection<T> {
  title: string;
  subtitle?: string;
  items: T[];
  icon?: ReactNode;
  color?: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
}

export interface OverviewGridProps<T> {
  /** Items to display in the grid */
  items: T[];

  /** Render function for each item */
  renderItem: (item: T, index: number) => ReactNode;

  /** Loading state */
  isLoading?: boolean;

  /** Number of skeleton items to show when loading */
  skeletonCount?: number;

  /** Render function for skeleton items */
  renderSkeleton?: () => ReactNode;

  /** Empty state configuration */
  emptyState?: {
    icon: ReactNode;
    title: string;
    description: string;
  };

  /** Grid column configuration */
  columns?: OverviewGridColumn;

  /** Gap between items */
  gap?: number;

  /** Add action button */
  addAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };

  /** Accessible label for the grid */
  ariaLabel?: string;

  /** Key extractor for items */
  keyExtractor?: (item: T, index: number) => string | number;
}

export interface SectionedOverviewGridProps<T> {
  /** Sections containing grouped items */
  sections: OverviewGridSection<T>[];

  /** Render function for each item */
  renderItem: (item: T, index: number, sectionIndex: number) => ReactNode;

  /** Loading state */
  isLoading?: boolean;

  /** Number of skeleton items to show when loading */
  skeletonCount?: number;

  /** Render function for skeleton items */
  renderSkeleton?: () => ReactNode;

  /** Empty state configuration */
  emptyState?: {
    icon: ReactNode;
    title: string;
    description: string;
  };

  /** Grid column configuration */
  columns?: OverviewGridColumn;

  /** Gap between items */
  gap?: number;

  /** Accessible label for the grid */
  ariaLabel?: string;

  /** Key extractor for items */
  keyExtractor?: (item: T, index: number) => string | number;
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_COLUMNS: OverviewGridColumn = {
  xs: 1,
  sm: 2,
  lg: 3,
  xl: 4
};

// ============================================================================
// Skeleton Component
// ============================================================================

export function DefaultCardSkeleton() {
  return (
    <Card
      variant="soft"
      sx={{
        minHeight: 180,
        background: 'linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        '@keyframes shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        }
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Skeleton variant="circular" width={48} height={48} />
          <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 'sm' }} />
        </Box>
        <Skeleton variant="text" width="70%" height={24} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="50%" height={18} sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Skeleton variant="rectangular" width={100} height={22} sx={{ borderRadius: 'sm' }} />
        </Box>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
}

function EmptyStateCard({ icon, title, description }: EmptyStateProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        textAlign: 'center',
        py: 6,
        px: 3,
        gridColumn: '1 / -1' // Span all columns
      }}
    >
      <Avatar
        alt=""
        sx={{
          width: 64,
          height: 64,
          bgcolor: 'neutral.softBg',
          color: 'neutral.solidBg',
          margin: '0 auto',
          mb: 2
        }}
      >
        {icon}
      </Avatar>
      <Typography level="h4" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography level="body-md" color="neutral">
        {description}
      </Typography>
    </Card>
  );
}

// ============================================================================
// Section Header Component
// ============================================================================

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  color?: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
  count?: number;
}

export function OverviewSectionHeader({ title, subtitle, icon, color = 'neutral', count }: SectionHeaderProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, mt: 3, '&:first-of-type': { mt: 0 } }}>
      {icon && (
        <Avatar size="sm" color={color} variant="soft" alt={title}>
          {icon}
        </Avatar>
      )}
      <Box sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography level="title-md" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          {count !== undefined && (
            <Typography level="body-sm" color="neutral">
              ({count})
            </Typography>
          )}
        </Stack>
        {subtitle && (
          <Typography level="body-xs" color="neutral">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

// ============================================================================
// Grid Container Component
// ============================================================================

interface GridContainerProps {
  columns: OverviewGridColumn;
  gap: number;
  ariaLabel?: string;
  children: ReactNode;
}

function GridContainer({ columns, gap, ariaLabel, children }: GridContainerProps) {
  return (
    <Box
      component="ul"
      aria-label={ariaLabel}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: `repeat(${columns.xs || 1}, 1fr)`,
          sm: `repeat(${columns.sm || columns.xs || 2}, 1fr)`,
          md: `repeat(${columns.md || columns.sm || columns.xs || 2}, 1fr)`,
          lg: `repeat(${columns.lg || columns.md || columns.sm || 3}, 1fr)`,
          xl: `repeat(${columns.xl || columns.lg || columns.md || 4}, 1fr)`
        },
        gap,
        listStyle: 'none',
        padding: 0,
        margin: 0
      }}
    >
      {children}
    </Box>
  );
}

// ============================================================================
// Main Components
// ============================================================================

/**
 * Basic Overview Grid - displays items in a responsive grid
 */
export function OverviewGrid<T>({
  items,
  renderItem,
  isLoading = false,
  skeletonCount = 8,
  renderSkeleton = DefaultCardSkeleton,
  emptyState,
  columns = DEFAULT_COLUMNS,
  gap = 2,
  addAction,
  ariaLabel = 'Overview grid',
  keyExtractor = (_, index) => index
}: OverviewGridProps<T>) {
  if (isLoading) {
    return (
      <Box aria-label="Loading" aria-busy="true">
        <GridContainer columns={columns} gap={gap}>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <Box component="li" key={index}>
              {renderSkeleton()}
            </Box>
          ))}
        </GridContainer>
      </Box>
    );
  }

  if (!items || items.length === 0) {
    if (emptyState) {
      return (
        <Box>
          <EmptyStateCard {...emptyState} />
          {addAction && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Button variant="soft" color="primary" startDecorator={<AddIcon />} onClick={addAction.onClick} disabled={addAction.disabled}>
                {addAction.label}
              </Button>
            </Box>
          )}
        </Box>
      );
    }
    return null;
  }

  return (
    <Box>
      <GridContainer columns={columns} gap={gap} ariaLabel={ariaLabel}>
        {items.map((item, index) => (
          <Box component="li" key={keyExtractor(item, index)}>
            {renderItem(item, index)}
          </Box>
        ))}
      </GridContainer>
      {addAction && (
        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Button variant="soft" color="primary" startDecorator={<AddIcon />} onClick={addAction.onClick} disabled={addAction.disabled}>
            {addAction.label}
          </Button>
        </Box>
      )}
    </Box>
  );
}

/**
 * Sectioned Overview Grid - displays items grouped into sections
 */
export function SectionedOverviewGrid<T>({
  sections,
  renderItem,
  isLoading = false,
  skeletonCount = 8,
  renderSkeleton = DefaultCardSkeleton,
  emptyState,
  columns = DEFAULT_COLUMNS,
  gap = 2,
  ariaLabel = 'Sectioned overview grid',
  keyExtractor = (_, index) => index
}: SectionedOverviewGridProps<T>) {
  if (isLoading) {
    return (
      <Box aria-label="Loading" aria-busy="true">
        <GridContainer columns={columns} gap={gap}>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <Box component="li" key={index}>
              {renderSkeleton()}
            </Box>
          ))}
        </GridContainer>
      </Box>
    );
  }

  const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);

  if (totalItems === 0 && emptyState) {
    return <EmptyStateCard {...emptyState} />;
  }

  return (
    <Box aria-label={ariaLabel}>
      {sections.map((section, sectionIndex) => {
        if (section.items.length === 0) return null;

        return (
          <Box key={section.title}>
            <OverviewSectionHeader title={section.title} subtitle={section.subtitle} icon={section.icon} color={section.color} count={section.items.length} />
            <GridContainer columns={columns} gap={gap}>
              {section.items.map((item, itemIndex) => (
                <Box component="li" key={keyExtractor(item, itemIndex)}>
                  {renderItem(item, itemIndex, sectionIndex)}
                </Box>
              ))}
            </GridContainer>
            {sectionIndex < sections.length - 1 && <Divider sx={{ my: 3 }} />}
          </Box>
        );
      })}
    </Box>
  );
}

export default OverviewGrid;
