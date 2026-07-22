'use client';

import React, { useState } from 'react';
import { Button, FormControl, FormHelperText, FormLabel, Input, Option, Select, Stack, Textarea, Typography } from '@mui/joy';
import type { ProvisioningInput } from '@/lib/provisioning/types';
import type { AreaMode } from '@/lib/provisioning/area';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

const PLOT_SHAPE_OPTIONS: Array<{ value: ProvisioningInput['plot']['plotShape']; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'irregular', label: 'Irregular' }
];

type PlotValue = ProvisioningInput['plot'];

type NumericPlotField = 'dimensionX' | 'dimensionY' | 'area' | 'globalX' | 'globalY' | 'globalZ';

interface PlotFormProps {
  value: PlotValue;
  /** requestedMode makes a mode transition and value change one semantic event. */
  onChange: (next: PlotValue, requestedMode?: AreaMode) => void;
  /** Owned by the wizard so it survives step navigation. */
  areaMode: AreaMode;
  onAreaModeChange: (next: AreaMode) => void;
  /** When true, show validation errors even on untouched fields */
  showErrors?: boolean;
}

function isPositiveNumber(n: number): boolean {
  return typeof n === 'number' && !isNaN(n) && n > 0;
}

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

function UnitSelect<T extends string>({ id, label, ariaLabel, value, options, onChange, disabled, helperText }: UnitSelectProps<T>) {
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

export default function PlotForm({ value, onChange, areaMode, onAreaModeChange, showErrors = false }: PlotFormProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof PlotValue, boolean>>>({});

  // Local string-typed mirror of numeric fields so an empty input stays empty
  // instead of being forced to 0 by Number(''). Only valid numeric strings are
  // propagated to the parent via onChange; empty input keeps the last valid value.
  const [numericDrafts, setNumericDrafts] = useState<Record<NumericPlotField, string>>(() => ({
    dimensionX: String(value.dimensionX ?? ''),
    dimensionY: String(value.dimensionY ?? ''),
    area: String(value.area ?? ''),
    globalX: String(value.globalX ?? ''),
    globalY: String(value.globalY ?? ''),
    globalZ: String(value.globalZ ?? '')
  }));

  // numericDrafts is seeded once from initial props, so a derived area would
  // never appear in the box without this: keep the draft mirror in sync while derived.
  React.useEffect(() => {
    if (areaMode !== 'derived') return;
    setNumericDrafts(prev => (prev.area === String(value.area) ? prev : { ...prev, area: String(value.area) }));
  }, [areaMode, value.area]);

  function handleNumericChange(field: NumericPlotField, raw: string, requestedMode?: AreaMode) {
    setNumericDrafts(prev => ({ ...prev, [field]: raw }));
    if (raw === '' || raw === '-') {
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      onChange({ ...value, [field]: n }, requestedMode);
    }
  }

  function markTouched(field: keyof PlotValue) {
    setTouched(prev => ({ ...prev, [field]: true }));
  }

  function shouldShowError(field: keyof PlotValue): boolean {
    return showErrors || (touched[field] ?? false);
  }

  const plotNameMissing = value.plotName.trim() === '';
  const dimensionXInvalid = !isPositiveNumber(value.dimensionX);
  const dimensionYInvalid = !isPositiveNumber(value.dimensionY);
  const areaInvalid = !isPositiveNumber(value.area);

  return (
    <Stack spacing={2}>
      <Typography level="title-md">Plot Details</Typography>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('plotName') && plotNameMissing}>
          <FormLabel htmlFor="plot-name-input">Plot Name</FormLabel>
          <Input
            id="plot-name-input"
            aria-label="Plot Name"
            value={value.plotName}
            placeholder="e.g. Main Plot"
            onChange={e => onChange({ ...value, plotName: e.target.value })}
            onBlur={() => markTouched('plotName')}
          />
          {shouldShowError('plotName') && plotNameMissing && <FormHelperText>Plot name is required.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="plot-shape-input">Plot Shape</FormLabel>
          <Select
            id="plot-shape-input"
            aria-label="Plot Shape"
            value={value.plotShape}
            onChange={(_event, newValue) => {
              if (newValue) {
                onChange({ ...value, plotShape: newValue as PlotValue['plotShape'] });
              }
            }}
            onBlur={() => markTouched('plotShape')}
          >
            {PLOT_SHAPE_OPTIONS.map(option => (
              <Option key={option.value} value={option.value}>
                {option.label}
              </Option>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('dimensionX') && dimensionXInvalid}>
          <FormLabel htmlFor="dimension-x-input">Dimension X ({value.defaultDimensionUnits})</FormLabel>
          <Input
            id="dimension-x-input"
            aria-label="Dimension X"
            type="number"
            value={numericDrafts.dimensionX}
            onChange={e => handleNumericChange('dimensionX', e.target.value)}
            onBlur={() => markTouched('dimensionX')}
            slotProps={{ input: { min: 0, step: 0.1 } }}
          />
          {shouldShowError('dimensionX') && dimensionXInvalid && <FormHelperText>Must be a positive number.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('dimensionY') && dimensionYInvalid}>
          <FormLabel htmlFor="dimension-y-input">Dimension Y ({value.defaultDimensionUnits})</FormLabel>
          <Input
            id="dimension-y-input"
            aria-label="Dimension Y"
            type="number"
            value={numericDrafts.dimensionY}
            onChange={e => handleNumericChange('dimensionY', e.target.value)}
            onBlur={() => markTouched('dimensionY')}
            slotProps={{ input: { min: 0, step: 0.1 } }}
          />
          {shouldShowError('dimensionY') && dimensionYInvalid && <FormHelperText>Must be a positive number.</FormHelperText>}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('area') && areaInvalid}>
          <FormLabel htmlFor="area-input">Area</FormLabel>
          <Input
            id="area-input"
            aria-label="Area"
            type="number"
            value={numericDrafts.area}
            onChange={e => handleNumericChange('area', e.target.value, 'manual')}
            onBlur={() => markTouched('area')}
            slotProps={{ input: { min: 0, step: 0.01 } }}
          />
          {areaMode === 'derived' ? (
            <FormHelperText>Auto-calculated from the plot dimensions. Type here to enter it yourself.</FormHelperText>
          ) : (
            <FormHelperText>
              <Button
                variant="plain"
                size="sm"
                sx={{ minHeight: 'auto', p: 0, fontSize: 'inherit' }}
                aria-label="Use calculated area"
                onClick={() => onAreaModeChange('derived')}
              >
                Use calculated value
              </Button>
            </FormHelperText>
          )}
          {shouldShowError('area') && areaInvalid && <FormHelperText>Must be a positive number.</FormHelperText>}
        </FormControl>
      </Stack>

      <Typography level="title-sm">Global Coordinates</Typography>
      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="global-x-input">Global X</FormLabel>
          <Input
            id="global-x-input"
            aria-label="Global X"
            type="number"
            value={numericDrafts.globalX}
            onChange={e => handleNumericChange('globalX', e.target.value)}
            onBlur={() => markTouched('globalX')}
            slotProps={{ input: { step: 0.0001 } }}
          />
        </FormControl>

        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="global-y-input">Global Y</FormLabel>
          <Input
            id="global-y-input"
            aria-label="Global Y"
            type="number"
            value={numericDrafts.globalY}
            onChange={e => handleNumericChange('globalY', e.target.value)}
            onBlur={() => markTouched('globalY')}
            slotProps={{ input: { step: 0.0001 } }}
          />
        </FormControl>

        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="global-z-input">Global Z</FormLabel>
          <Input
            id="global-z-input"
            aria-label="Global Z"
            type="number"
            value={numericDrafts.globalZ}
            onChange={e => handleNumericChange('globalZ', e.target.value)}
            onBlur={() => markTouched('globalZ')}
            slotProps={{ input: { step: 0.0001 } }}
          />
        </FormControl>
      </Stack>

      <FormControl>
        <FormLabel htmlFor="description-input">Description</FormLabel>
        <Textarea
          id="description-input"
          aria-label="Description"
          value={value.description}
          placeholder="Optional plot description…"
          minRows={2}
          onChange={e => onChange({ ...value, description: e.target.value })}
          onBlur={() => markTouched('description')}
        />
      </FormControl>

      <Typography level="title-sm">Default Units</Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <UnitSelect
          id="default-dimension-units-input"
          label="Dimension Units"
          ariaLabel="Default Dimension Units"
          value={value.defaultDimensionUnits}
          options={unitSelectionOptions}
          onChange={newValue => onChange({ ...value, defaultDimensionUnits: newValue })}
        />

        <UnitSelect
          id="default-coordinate-units-input"
          label="Coordinate Units"
          ariaLabel="Default Coordinate Units"
          value={value.defaultCoordinateUnits}
          options={unitSelectionOptions}
          onChange={newValue => onChange({ ...value, defaultCoordinateUnits: newValue })}
        />

        <UnitSelect
          id="default-area-units-input"
          label="Area Units"
          ariaLabel="Default Area Units"
          value={value.defaultAreaUnits}
          options={areaSelectionOptions}
          onChange={newValue => onChange({ ...value, defaultAreaUnits: newValue })}
          disabled={areaMode === 'derived'}
          helperText={areaMode === 'derived' ? 'Follows the dimension unit while the area is auto-calculated.' : undefined}
        />

        <UnitSelect
          id="default-dbh-units-input"
          label="DBH Units"
          ariaLabel="Default DBH Units"
          value={value.defaultDBHUnits}
          options={unitSelectionOptions}
          onChange={newValue => onChange({ ...value, defaultDBHUnits: newValue })}
        />

        <UnitSelect
          id="default-hom-units-input"
          label="HOM Units"
          ariaLabel="Default HOM Units"
          value={value.defaultHOMUnits}
          options={unitSelectionOptions}
          onChange={newValue => onChange({ ...value, defaultHOMUnits: newValue })}
        />
      </Stack>
    </Stack>
  );
}
