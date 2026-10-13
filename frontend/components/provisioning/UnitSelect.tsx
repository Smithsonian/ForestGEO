'use client';

import React from 'react';
import { FormControl, FormHelperText, FormLabel, Option, Select } from '@mui/joy';

interface UnitSelectProps<T extends string> {
  id: string;
  label: string;
  ariaLabel: string;
  value: T;
  options: readonly T[];
  onChange: (newValue: T) => void;
  disabled?: boolean;
  helperText?: string;
}

export default function UnitSelect<T extends string>({ id, label, ariaLabel, value, options, onChange, disabled, helperText }: UnitSelectProps<T>) {
  return (
    <FormControl sx={{ flex: 1, minWidth: 160 }}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(_event, newValue) => {
          if (newValue) onChange(newValue);
        }}
      >
        {options.map(unit => (
          <Option key={unit} value={unit}>
            {unit}
          </Option>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}
