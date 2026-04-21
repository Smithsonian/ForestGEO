'use client';

import React, { useCallback, useState } from 'react';
import { MenuItem } from '@mui/joy';
import RestoreIcon from '@mui/icons-material/Restore';

interface RevertMenuItemProps {
  editOperationID: number | null;
  createdAt: string | null;
  onRevert: () => Promise<void>;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function formatRelativeTime(createdAt: string | null): string {
  if (!createdAt) return '';
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return '';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - created) / MS_PER_SECOND));

  if (diffSeconds < SECONDS_PER_MINUTE) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / SECONDS_PER_MINUTE);
  if (diffMinutes < MINUTES_PER_HOUR) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / MINUTES_PER_HOUR);
  if (diffHours < HOURS_PER_DAY) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / HOURS_PER_DAY);
  return `${diffDays}d ago`;
}

export default function RevertMenuItem({ editOperationID, createdAt, onRevert }: RevertMenuItemProps) {
  const [busy, setBusy] = useState(false);
  const disabled = editOperationID === null || busy;
  const relative = formatRelativeTime(createdAt);
  const label = relative ? `Revert last edit • ${relative}` : 'Revert last edit';

  const handleClick = useCallback(async () => {
    if (disabled) return;
    setBusy(true);
    try {
      await onRevert();
    } finally {
      setBusy(false);
    }
  }, [disabled, onRevert]);

  return (
    <MenuItem onClick={handleClick} disabled={disabled} data-testid="revert-menu-item">
      <RestoreIcon fontSize="small" />
      {label}
    </MenuItem>
  );
}
