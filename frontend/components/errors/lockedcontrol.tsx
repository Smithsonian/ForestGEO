'use client';

import React from 'react';
import { Tooltip } from '@mui/joy';

/** Disabled controls don't receive pointer events, so the tooltip sits on a wrapper (D-g: each disabled control says why). */
export default function LockedControl({ reason, testID, children }: { reason: string | null; testID?: string; children: React.ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip title={reason}>
      <span data-testid={testID} style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </Tooltip>
  );
}
