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
        ...sx
      }}
    >
      {/* Icon */}
      <Avatar
        sx={{
          width: 80,
          height: 80,
          bgcolor: `${iconColor}.softBg`,
          color: `${iconColor}.solidBg`,
          margin: '0 auto',
          mb: 3,
          fontSize: '2.5rem'
        }}
      >
        {icon}
      </Avatar>

      {/* Title */}
      <Typography level="h3" sx={{ mb: 2, fontWeight: 600 }}>
        {title}
      </Typography>

      {/* Description */}
      <Typography
        level="body-md"
        color="neutral"
        sx={{
          mb: 3,
          maxWidth: '500px',
          mx: 'auto',
          lineHeight: 1.6
        }}
      >
        {description}
      </Typography>

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
          {primaryAction && (
            <Button
              variant={primaryAction.variant || 'solid'}
              color={primaryAction.color || 'primary'}
              onClick={primaryAction.onClick}
              startDecorator={primaryAction.startDecorator}
              sx={{
                minWidth: '140px',
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: 'md'
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
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)'
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
