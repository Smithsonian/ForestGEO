'use client';

import React from 'react';
import { Box, Typography, Button, Stack, Avatar } from '@mui/joy';
import { SxProps } from '@mui/joy/styles/types';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'solid' | 'outlined' | 'soft' | 'plain';
  color?: 'primary' | 'neutral' | 'danger' | 'success' | 'warning';
  startDecorator?: React.ReactNode;
}

export interface EmptyStateProps {
  /**
   * Icon component to display (e.g., <DatasetIcon />)
   */
  icon: React.ReactNode;

  /**
   * Main heading text
   */
  title: string;

  /**
   * Descriptive text explaining the empty state
   */
  description: string;

  /**
   * Primary action button (optional)
   */
  primaryAction?: EmptyStateAction;

  /**
   * Secondary action button (optional)
   */
  secondaryAction?: EmptyStateAction;

  /**
   * Icon background color (defaults to primary.softBg)
   */
  iconColor?: 'primary' | 'neutral' | 'success' | 'warning' | 'danger';

  /**
   * Additional custom styling
   */
  sx?: SxProps;
}

/**
 * EmptyState component - Displays informative empty state with icon, text, and actions
 *
 * Usage:
 * ```tsx
 * <EmptyState
 *   icon={<DatasetIcon />}
 *   title="No Census Data Yet"
 *   description="Start by creating a new census or uploading measurement data"
 *   primaryAction={{
 *     label: 'Upload Data',
 *     onClick: () => router.push('/measurementshub'),
 *     startDecorator: <AddIcon />
 *   }}
 *   secondaryAction={{
 *     label: 'View Guide',
 *     onClick: () => openHelpModal(),
 *     variant: 'outlined'
 *   }}
 * />
 * ```
 */
export default function EmptyState({ icon, title, description, primaryAction, secondaryAction, iconColor = 'primary', sx }: EmptyStateProps) {
  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 8,
        px: 3,
        '@keyframes fadeIn': {
          from: {
            opacity: 0,
            transform: 'translateY(20px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        },
        ...sx
      }}
    >
      <Avatar
        alt={title}
        sx={{
          width: 80,
          height: 80,
          bgcolor: `${iconColor}.softBg`,
          color: `${iconColor}.solidBg`,
          margin: '0 auto',
          mb: 3,
          fontSize: '2.5rem',
          boxShadow: theme => `0 8px 24px ${theme.palette[iconColor].softBg}`,
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': {
              transform: 'scale(1)',
              boxShadow: theme => `0 8px 24px ${theme.palette[iconColor].softBg}`
            },
            '50%': {
              transform: 'scale(1.05)',
              boxShadow: theme => `0 12px 32px ${theme.palette[iconColor][200]}`
            }
          }
        }}
      >
        {icon}
      </Avatar>

      <Typography
        level="h3"
        sx={{
          mb: 2,
          fontWeight: 600,
          background: theme => `linear-gradient(135deg, ${theme.palette.text.primary} 0%, ${theme.palette[iconColor][400]} 100%)`,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'fadeIn 0.6s ease-out'
        }}
      >
        {title}
      </Typography>

      <Typography
        level="body-md"
        sx={{
          mb: 3,
          maxWidth: '500px',
          mx: 'auto',
          lineHeight: 1.6,
          animation: 'fadeIn 0.8s ease-out',
          color: 'neutral.200' // Force accessible color: #e7e5e4 - 9.6:1 contrast on black
        }}
      >
        {description}
      </Typography>

      {(primaryAction || secondaryAction) && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="center"
          sx={{
            animation: 'fadeIn 1s ease-out'
          }}
        >
          {primaryAction && (
            <Button
              variant={primaryAction.variant || 'solid'}
              color={primaryAction.color || 'primary'}
              onClick={primaryAction.onClick}
              startDecorator={primaryAction.startDecorator}
              sx={{
                minWidth: '140px',
                transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                position: 'relative',
                overflow: 'hidden',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: '-100%',
                  width: '100%',
                  height: '100%',
                  background: theme => `linear-gradient(90deg, transparent, ${theme.palette[primaryAction.color || 'primary'][300]}, transparent)`,
                  transition: 'left 0.5s ease'
                },
                '&:hover': {
                  transform: 'translateY(-4px) scale(1.02)',
                  boxShadow: theme => `0 8px 24px ${theme.palette[primaryAction.color || 'primary'][200]}`,
                  '&::before': {
                    left: '100%'
                  }
                },
                '&:active': {
                  transform: 'translateY(-2px) scale(0.98)'
                }
              }}
            >
              {primaryAction.label}
            </Button>
          )}

          {secondaryAction && (
            <Button
              variant={secondaryAction.variant || 'outlined'}
              color={secondaryAction.color || 'neutral'}
              onClick={secondaryAction.onClick}
              startDecorator={secondaryAction.startDecorator}
              sx={{
                minWidth: '140px',
                transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: theme => theme.palette[secondaryAction.color || 'neutral'][400],
                  boxShadow: 'sm'
                },
                '&:active': {
                  transform: 'translateY(0)'
                }
              }}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
}
