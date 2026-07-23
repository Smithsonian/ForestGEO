'use client';

import React from 'react';
import { FormControl, FormHelperText, FormLabel, Option, Select } from '@mui/joy';
import type { QuadratReferenceCorner } from '@/lib/provisioning/types';
import { DEFAULT_REFERENCE_CORNER, REFERENCE_CORNER_OPTIONS } from '@/lib/provisioning/coordinate-reference-corner';

export interface ReferenceCornerSelectProps {
  id: string;
  value: QuadratReferenceCorner;
  onChange: (next: QuadratReferenceCorner) => void;
  helperText?: string;
}

/**
 * Which corner of a quadrat each row's StartX/StartY identifies. Shared between the
 * provisioning wizard's Quadrats step (QuadratPlanner) and the upload flow's
 * UploadParseFiles screen — both let a user declare the reference corner for a
 * quadrat CSV before it's normalized to south-west.
 *
 * Presentational only: no normalization, no validation. The FormLabel/htmlFor
 * association supplies the control's accessible name — deliberately no aria-label,
 * so sighted and screen-reader users hear/read the same phrase (WCAG 2.5.3).
 */
export default function ReferenceCornerSelect({ id, value, onChange, helperText }: ReferenceCornerSelectProps) {
  return (
    <FormControl>
      <FormLabel htmlFor={id}>Which corner does each row&apos;s StartX/StartY identify?</FormLabel>
      <Select
        id={id}
        value={value}
        onChange={(_event, newValue) => {
          if (newValue) {
            onChange(newValue as QuadratReferenceCorner);
          }
        }}
      >
        {REFERENCE_CORNER_OPTIONS.map(option => (
          <Option key={option.value} value={option.value}>
            {option.label}
            {option.value === DEFAULT_REFERENCE_CORNER ? ' (default)' : ''}
          </Option>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}
