'use client';

import React from 'react';
import { Chip } from '@mui/joy';
import { DETAILS_SHEET_TEXT, ERROR_SOURCE, type ErrorSourceKind } from '@/config/errorsexplorer';

export function ErrorSourceChip({ source }: { source: ErrorSourceKind }) {
  const isValidation = source === ERROR_SOURCE.validation;
  return (
    <Chip size="sm" variant="soft" color={isValidation ? 'primary' : 'warning'} data-testid={`error-source-chip-${source}`}>
      {isValidation ? DETAILS_SHEET_TEXT.validationChip : DETAILS_SHEET_TEXT.ingestionChip}
    </Chip>
  );
}
