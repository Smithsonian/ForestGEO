/**
 * Gradient Card Component
 *
 * A reusable card with gradient background, commonly used for
 * displaying sites, plots, censuses, and other dashboard cards.
 *
 * Features:
 * - Configurable gradient colors
 * - Background decorations (circles, grid patterns)
 * - Avatar with icon or text
 * - Status badges
 * - Consistent styling across the app
 */

'use client';

import React, { ReactNode } from 'react';
import { Box, Card, CardContent, Avatar, Typography, Chip, Stack, Skeleton } from '@mui/joy';

// ============================================================================
// Gradient Definitions
// ============================================================================

export const GRADIENT_PRESETS = {
  // Site gradients - nature tones
  forest: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
  teal: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
  purple: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
  orange: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
  blue: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
  red: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
  lime: 'linear-gradient(135deg, #65a30d 0%, #4d7c0f 100%)',
  cyan: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',

  // Plot gradients - earthy tones
  emerald: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
  indigo: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
  yellow: 'linear-gradient(135deg, #ca8a04 0%, #a16207 100%)',
  sky: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
  violet: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',

  // Census gradients - time-based
  blueNew: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  violetMid: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  cyanMid: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  emeraldOld: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  amber: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  redAlert: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  slate: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
  stone: 'linear-gradient(135deg, #78716c 0%, #57534e 100%)',

  // Metric gradients
  primary: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
  success: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  neutral: 'linear-gradient(135deg, #57534e 0%, #44403c 100%)'
} as const;

export type GradientPreset = keyof typeof GRADIENT_PRESETS;

// Gradient arrays for cycling through colors
export const SITE_GRADIENTS: GradientPreset[] = ['forest', 'teal', 'purple', 'orange', 'blue', 'red', 'lime', 'cyan'];
export const PLOT_GRADIENTS: GradientPreset[] = ['emerald', 'teal', 'indigo', 'yellow', 'sky', 'violet', 'lime', 'red'];
export const CENSUS_GRADIENTS: GradientPreset[] = ['blueNew', 'violetMid', 'cyanMid', 'emeraldOld', 'amber', 'redAlert', 'slate', 'stone'];

// ============================================================================
// Background Decoration Types
// ============================================================================

export type BackgroundDecoration = 'circle' | 'grid' | 'radial' | 'timeline' | 'none';

// ============================================================================
// Types
// ============================================================================

export interface GradientCardProps {
  /** Gradient background - preset name or custom CSS gradient */
  gradient: GradientPreset | string;

  /** Card content */
  children: ReactNode;

  /** Minimum height of the card */
  minHeight?: number;

  /** Background decoration type */
  decoration?: BackgroundDecoration;

  /** Accessible label for the card */
  ariaLabel?: string;

  /** Whether the card is interactive (clickable) */
  onClick?: () => void;

  /** Additional sx styles */
  sx?: Record<string, unknown>;
}

export interface GradientCardHeaderProps {
  /** Icon or content for the avatar */
  avatar: ReactNode;

  /** Avatar size */
  avatarSize?: number;

  /** Right side content (badges, chips, actions) */
  endContent?: ReactNode;
}

export interface GradientCardBadgeProps {
  /** Badge content */
  children: ReactNode;

  /** Icon to display before the content */
  icon?: ReactNode;

  /** Badge variant */
  variant?: 'light' | 'dark' | 'status';

  /** Status color (for status variant) */
  statusColor?: string;

  /** Background color (for status variant) */
  statusBgColor?: string;
}

export interface GradientCardChipProps {
  /** Chip label */
  children: ReactNode;

  /** Icon to display before the content */
  icon?: ReactNode;
}

// ============================================================================
// Skeleton Component
// ============================================================================

export function GradientCardSkeleton({ minHeight = 180 }: { minHeight?: number }) {
  return (
    <Card
      variant="soft"
      sx={{
        minHeight,
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
// Sub-components
// ============================================================================

/**
 * Header section with avatar and optional end content
 */
export function GradientCardHeader({ avatar, avatarSize = 48, endContent }: GradientCardHeaderProps) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
      <Avatar
        alt=""
        sx={{
          bgcolor: 'rgba(255,255,255,0.2)',
          backdropFilter: 'blur(10px)',
          width: avatarSize,
          height: avatarSize,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}
      >
        {avatar}
      </Avatar>
      {endContent && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {endContent}
        </Stack>
      )}
    </Box>
  );
}

/**
 * Badge/chip for displaying status or counts
 */
export function GradientCardBadge({ children, icon, variant = 'light', statusColor, statusBgColor }: GradientCardBadgeProps) {
  const getStyles = () => {
    switch (variant) {
      case 'dark':
        return {
          bgcolor: 'rgba(0,0,0,0.15)',
          color: 'rgba(255,255,255,0.95)'
        };
      case 'status':
        return {
          bgcolor: statusBgColor || 'rgba(255,255,255,0.2)',
          color: statusColor || 'white'
        };
      default:
        return {
          bgcolor: 'rgba(255,255,255,0.2)',
          color: 'white'
        };
    }
  };

  return (
    <Chip
      size="sm"
      variant="soft"
      startDecorator={icon}
      sx={{
        ...getStyles(),
        backdropFilter: 'blur(4px)',
        fontWeight: 600,
        fontSize: '0.75rem'
      }}
    >
      {children}
    </Chip>
  );
}

/**
 * Small chip for displaying metadata
 */
export function GradientCardChip({ children, icon }: GradientCardChipProps) {
  return (
    <Chip
      size="sm"
      variant="soft"
      startDecorator={icon}
      sx={{
        bgcolor: 'rgba(0,0,0,0.15)',
        color: 'rgba(255,255,255,0.95)',
        fontSize: '0.625rem',
        height: 'auto',
        py: 0.25
      }}
    >
      {children}
    </Chip>
  );
}

/**
 * Title text component
 */
export function GradientCardTitle({ children }: { children: ReactNode }) {
  return (
    <Typography
      level="h4"
      sx={{
        fontWeight: 700,
        mb: 0.25,
        textShadow: '0 2px 4px rgba(0,0,0,0.1)',
        fontSize: '1rem',
        color: 'white'
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Subtitle/description text component
 */
export function GradientCardSubtitle({ children, icon, muted = false }: { children: ReactNode; icon?: ReactNode; muted?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
      {icon && <Box sx={{ fontSize: 12, opacity: muted ? 0.5 : 0.9, display: 'flex', alignItems: 'center' }}>{icon}</Box>}
      <Typography
        level="body-xs"
        sx={{
          color: muted ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)',
          fontWeight: 500,
          fontStyle: muted ? 'italic' : 'normal'
        }}
      >
        {children}
      </Typography>
    </Stack>
  );
}

// ============================================================================
// Background Decoration Components
// ============================================================================

function CircleDecoration() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: -30,
        right: -30,
        width: 120,
        height: 120,
        borderRadius: '50%',
        bgcolor: 'rgba(255,255,255,0.08)',
        pointerEvents: 'none'
      }}
    />
  );
}

function GridDecoration() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: -20,
        right: -20,
        width: 100,
        height: 100,
        opacity: 0.08,
        pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
        `,
        backgroundSize: '20px 20px'
      }}
    />
  );
}

function RadialDecoration() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.15) 0%, transparent 50%)',
        pointerEvents: 'none'
      }}
    />
  );
}

function TimelineDecoration() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: 10,
        right: 10,
        bottom: 10,
        width: 3,
        opacity: 0.1,
        background: 'white',
        borderRadius: 2
      }}
    />
  );
}

const DECORATIONS: Record<BackgroundDecoration, React.FC | null> = {
  circle: CircleDecoration,
  grid: GridDecoration,
  radial: RadialDecoration,
  timeline: TimelineDecoration,
  none: null
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Base gradient card component
 */
export function GradientCard({ gradient, children, minHeight = 180, decoration = 'radial', ariaLabel, onClick, sx = {} }: GradientCardProps) {
  const gradientValue = gradient in GRADIENT_PRESETS ? GRADIENT_PRESETS[gradient as GradientPreset] : gradient;

  const DecorationComponent = DECORATIONS[decoration];

  const cardContent = (
    <Card
      component="article"
      variant="solid"
      aria-label={ariaLabel}
      sx={{
        background: gradientValue,
        color: 'white',
        minHeight,
        position: 'relative',
        overflow: 'hidden',
        border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        transition: onClick ? 'all 0.2s ease' : undefined,

        // Decorative gradient overlay
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 40%, rgba(0,0,0,0.1) 100%)',
          pointerEvents: 'none'
        },

        // Hover effect for interactive cards
        ...(onClick && {
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
          }
        }),

        ...sx
      }}
    >
      {DecorationComponent && <DecorationComponent />}

      <CardContent sx={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>{children}</CardContent>
    </Card>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          cursor: 'pointer'
        }}
      >
        {cardContent}
      </button>
    );
  }

  return cardContent;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get gradient by index from a preset array
 */
export function getGradientByIndex(index: number, presets: GradientPreset[] = SITE_GRADIENTS): string {
  const preset = presets[index % presets.length];
  return GRADIENT_PRESETS[preset];
}

export default GradientCard;
