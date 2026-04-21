'use client';

import React from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/joy';
import { Effect, Severity } from '@/config/editplan/types';

interface EditEffectRowProps {
  effect: Effect;
}

const SEVERITY_CHIP_COLOR: Record<Severity, 'danger' | 'warning' | 'neutral'> = {
  destructive: 'danger',
  warn: 'warning',
  info: 'neutral'
};

const SEVERITY_CHIP_LABEL: Record<Severity, string> = {
  destructive: 'Destructive',
  warn: 'Warning',
  info: 'Info'
};

export default function EditEffectRow({ effect }: EditEffectRowProps) {
  const color = SEVERITY_CHIP_COLOR[effect.severity];
  const label = SEVERITY_CHIP_LABEL[effect.severity];

  return (
    <Card variant="soft" color={color} data-testid={`edit-effect-${effect.id}`} sx={{ padding: 1.5 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ marginBottom: 0.5 }}>
            <Chip color={color} size="sm" variant="solid">
              {label}
            </Chip>
            <Typography level="title-sm" sx={{ fontWeight: 600 }}>
              {effect.title}
            </Typography>
          </Stack>
          <Typography level="body-sm">{effect.detail}</Typography>
        </Box>
        {effect.affectedRowCount > 0 ? (
          <Chip color="neutral" variant="outlined" size="sm" data-testid={`edit-effect-rowcount-${effect.id}`}>
            {effect.affectedRowCount} row{effect.affectedRowCount === 1 ? '' : 's'}
          </Chip>
        ) : null}
      </Stack>
    </Card>
  );
}
