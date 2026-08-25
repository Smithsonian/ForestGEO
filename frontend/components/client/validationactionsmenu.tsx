'use client';

import React, { useState } from 'react';
import { CircularProgress, Divider, ListItemDecorator, MenuItem, Typography } from '@mui/joy';
import { CloudSync, GppGoodOutlined, SettingsBackupRestoreRounded, CachedOutlined } from '@mui/icons-material';

export interface ValidationAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void | Promise<void>;
  color?: 'primary' | 'neutral' | 'danger' | 'success' | 'warning';
  disabled?: boolean;
}

interface ValidationActionsMenuProps {
  onRunValidations: () => void;
  onOverrideValidations: () => void;
  onResetValidations: () => void;
  onRefreshView: () => Promise<void>;
  pendingCount?: number;
  /**
   * Rows the override action will flip to valid (IsValidated FALSE OR NULL):
   * genuinely failed rows PLUS never-validated ones. The copy must not call
   * these all "failed" — that misreports pending rows as failures.
   */
  overridableCount?: number;
  /**
   * Failed rows a rerun can actually re-examine (IsValidated = FALSE, real
   * stem, unresolved validation-source error) — prepareValidationRun's reset
   * predicate. Excludes ingestion failures (StemGUID NULL), which no
   * validation run can clear, so they must not make the run action look
   * actionable.
   */
  revalidatableCount?: number;
  disabled?: boolean;
}

export default function ValidationActionsMenu({
  onRunValidations,
  onOverrideValidations,
  onResetValidations,
  onRefreshView,
  pendingCount = 0,
  overridableCount = 0,
  revalidatableCount = 0
}: ValidationActionsMenuProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshView = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshView();
    } finally {
      setIsRefreshing(false);
    }
  };

  const actions: ValidationAction[] = [
    {
      id: 'run-validations',
      label: 'Run Validations',
      description:
        pendingCount > 0
          ? `Validate ${pendingCount} pending row(s)`
          : revalidatableCount > 0
            ? `Re-check ${revalidatableCount} failed row(s)`
            : 'No rows to validate',
      icon: <CloudSync />,
      onClick: onRunValidations,
      color: 'primary',
      // A rerun re-examines failed rows too (prepareValidationRun resets this
      // validation's error carriers), so failed-only states stay actionable.
      disabled: pendingCount === 0 && revalidatableCount === 0
    },
    {
      id: 'override-validations',
      label: 'Override Validations',
      description: overridableCount > 0 ? `Force ${overridableCount} failed or not-yet-validated row(s) to pass` : 'No rows to override',
      icon: <GppGoodOutlined />,
      onClick: onOverrideValidations,
      color: 'warning',
      disabled: overridableCount === 0
    },
    {
      id: 'reset-validations',
      label: 'Reset All Validation States',
      description: 'Clear all errors and set rows to pending',
      icon: <SettingsBackupRestoreRounded />,
      onClick: onResetValidations,
      color: 'danger'
    },
    {
      id: 'refresh-view',
      label: 'Refresh Materialized View',
      description: 'Rebuild the measurements summary view',
      icon: isRefreshing ? <CircularProgress size="sm" /> : <CachedOutlined />,
      onClick: handleRefreshView,
      color: 'neutral',
      disabled: isRefreshing
    }
  ];

  // Render as menu items (for use inside a parent Menu)
  return (
    <>
      <Typography
        level="body-xs"
        sx={{
          px: 1.5,
          py: 0.75,
          fontWeight: 'bold',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'neutral.500'
        }}
      >
        Validation Actions
      </Typography>
      {actions.map((action, index) => (
        <React.Fragment key={action.id}>
          {index === actions.length - 1 && <Divider sx={{ my: 0.5 }} />}
          <MenuItem
            onClick={action.onClick}
            disabled={action.disabled}
            color={action.color}
            sx={{
              py: 1.5,
              '&:hover': {
                backgroundColor: theme =>
                  action.color === 'danger'
                    ? theme.vars.palette.danger.softHoverBg
                    : action.color === 'warning'
                      ? theme.vars.palette.warning.softHoverBg
                      : theme.vars.palette.primary.softHoverBg
              }
            }}
          >
            <ListItemDecorator
              sx={{
                color: action.disabled ? 'neutral.400' : action.color === 'danger' ? 'danger.500' : action.color === 'warning' ? 'warning.500' : 'primary.500'
              }}
            >
              {action.icon}
            </ListItemDecorator>
            <div>
              <Typography level="title-sm" sx={{ color: action.disabled ? 'neutral.400' : 'inherit' }}>
                {action.label}
              </Typography>
              <Typography level="body-xs" sx={{ color: action.disabled ? 'neutral.400' : 'neutral.500' }}>
                {action.description}
              </Typography>
            </div>
          </MenuItem>
        </React.Fragment>
      ))}
    </>
  );
}
