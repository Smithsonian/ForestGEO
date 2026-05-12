'use client';

import React, { useState } from 'react';
import { FormControl, FormHelperText, FormLabel, Input, Stack, Switch, Typography } from '@mui/joy';
import type { ProvisioningInput } from '@/lib/provisioning/types';

const SCHEMA_NAME_REGEX = /^forestgeo_[a-z0-9_]+$/;

type SiteValue = ProvisioningInput['site'];

interface SiteFormProps {
  value: SiteValue;
  onChange: (next: SiteValue) => void;
  /** When true, show validation errors even on untouched fields */
  showErrors?: boolean;
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export default function SiteForm({ value, onChange, showErrors = false }: SiteFormProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof SiteValue, boolean>>>({});

  function markTouched(field: keyof SiteValue) {
    setTouched(prev => ({ ...prev, [field]: true }));
  }

  function shouldShowError(field: keyof SiteValue): boolean {
    return showErrors || (touched[field] ?? false);
  }

  const schemaNameValid = SCHEMA_NAME_REGEX.test(value.schemaName);
  const siteNameMissing = value.siteName.trim() === '';
  const locationMissing = value.location.trim() === '';
  const countryMissing = value.country.trim() === '';
  const sqDimXInvalid = !isPositiveInteger(value.sqDimX);
  const sqDimYInvalid = !isPositiveInteger(value.sqDimY);
  const defaultUOMDBHMissing = value.defaultUOMDBH.trim() === '';
  const defaultUOMHOMMissing = value.defaultUOMHOM.trim() === '';

  return (
    <Stack spacing={2}>
      <Typography level="title-md">Site Details</Typography>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('siteName') && siteNameMissing}>
          <FormLabel htmlFor="site-name-input">Site Name</FormLabel>
          <Input
            id="site-name-input"
            aria-label="Site Name"
            value={value.siteName}
            placeholder="e.g. Rabi Forest"
            onChange={e => onChange({ ...value, siteName: e.target.value })}
            onBlur={() => markTouched('siteName')}
          />
          {shouldShowError('siteName') && siteNameMissing && <FormHelperText>Site name is required.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('schemaName') && !schemaNameValid}>
          <FormLabel htmlFor="schema-name-input">Schema Name</FormLabel>
          <Input
            id="schema-name-input"
            aria-label="Schema Name"
            value={value.schemaName}
            placeholder="forestgeo_rabi"
            onChange={e => onChange({ ...value, schemaName: e.target.value })}
            onBlur={() => markTouched('schemaName')}
          />
          {shouldShowError('schemaName') && !schemaNameValid && (
            <FormHelperText>Must match forestgeo_&lt;lowercase_slug&gt; (letters, digits, underscores only).</FormHelperText>
          )}
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('sqDimX') && sqDimXInvalid}>
          <FormLabel htmlFor="sq-dim-x-input">Subquadrat Dimension X (m)</FormLabel>
          <Input
            id="sq-dim-x-input"
            aria-label="Subquadrat Dimension X"
            type="number"
            value={value.sqDimX}
            onChange={e => {
              onChange({ ...value, sqDimX: Number(e.target.value) });
            }}
            onBlur={() => markTouched('sqDimX')}
            slotProps={{ input: { min: 1, step: 1 } }}
          />
          {shouldShowError('sqDimX') && sqDimXInvalid && <FormHelperText>Must be a positive integer.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('sqDimY') && sqDimYInvalid}>
          <FormLabel htmlFor="sq-dim-y-input">Subquadrat Dimension Y (m)</FormLabel>
          <Input
            id="sq-dim-y-input"
            aria-label="Subquadrat Dimension Y"
            type="number"
            value={value.sqDimY}
            onChange={e => {
              onChange({ ...value, sqDimY: Number(e.target.value) });
            }}
            onBlur={() => markTouched('sqDimY')}
            slotProps={{ input: { min: 1, step: 1 } }}
          />
          {shouldShowError('sqDimY') && sqDimYInvalid && <FormHelperText>Must be a positive integer.</FormHelperText>}
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('defaultUOMDBH') && defaultUOMDBHMissing}>
          <FormLabel htmlFor="default-uom-dbh-input">Default DBH Unit</FormLabel>
          <Input
            id="default-uom-dbh-input"
            aria-label="Default DBH Unit"
            value={value.defaultUOMDBH}
            placeholder="mm"
            onChange={e => onChange({ ...value, defaultUOMDBH: e.target.value })}
            onBlur={() => markTouched('defaultUOMDBH')}
          />
          {shouldShowError('defaultUOMDBH') && defaultUOMDBHMissing && <FormHelperText>DBH unit is required.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('defaultUOMHOM') && defaultUOMHOMMissing}>
          <FormLabel htmlFor="default-uom-hom-input">Default HOM Unit</FormLabel>
          <Input
            id="default-uom-hom-input"
            aria-label="Default HOM Unit"
            value={value.defaultUOMHOM}
            placeholder="m"
            onChange={e => onChange({ ...value, defaultUOMHOM: e.target.value })}
            onBlur={() => markTouched('defaultUOMHOM')}
          />
          {shouldShowError('defaultUOMHOM') && defaultUOMHOMMissing && <FormHelperText>HOM unit is required.</FormHelperText>}
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('location') && locationMissing}>
          <FormLabel htmlFor="location-input">Location</FormLabel>
          <Input
            id="location-input"
            aria-label="Location"
            value={value.location}
            placeholder="e.g. Gabon"
            onChange={e => onChange({ ...value, location: e.target.value })}
            onBlur={() => markTouched('location')}
          />
          {shouldShowError('location') && locationMissing && <FormHelperText>Location is required.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('country') && countryMissing}>
          <FormLabel htmlFor="country-input">Country</FormLabel>
          <Input
            id="country-input"
            aria-label="Country"
            value={value.country}
            placeholder="e.g. Gabon"
            onChange={e => onChange({ ...value, country: e.target.value })}
            onBlur={() => markTouched('country')}
          />
          {shouldShowError('country') && countryMissing && <FormHelperText>Country is required.</FormHelperText>}
        </FormControl>
      </Stack>

      <FormControl orientation="horizontal" sx={{ justifyContent: 'space-between' }}>
        <div>
          <FormLabel htmlFor="double-data-entry-switch">Double Data Entry</FormLabel>
        </div>
        <Switch
          id="double-data-entry-switch"
          aria-label="Double Data Entry"
          checked={value.doubleDataEntry}
          onChange={e => onChange({ ...value, doubleDataEntry: e.target.checked })}
        />
      </FormControl>
    </Stack>
  );
}
