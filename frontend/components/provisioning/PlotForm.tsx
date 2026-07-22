'use client';

import React, { useState } from 'react';
import { FormControl, FormHelperText, FormLabel, Input, Option, Select, Stack, Textarea, Typography } from '@mui/joy';
import type { ProvisioningInput } from '@/lib/provisioning/types';
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
  onChange: (next: PlotValue) => void;
  /** When true, show validation errors even on untouched fields */
  showErrors?: boolean;
}

function isPositiveNumber(n: number): boolean {
  return typeof n === 'number' && !isNaN(n) && n > 0;
}

export default function PlotForm({ value, onChange, showErrors = false }: PlotFormProps) {
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

  function handleNumericChange(field: NumericPlotField, raw: string) {
    setNumericDrafts(prev => ({ ...prev, [field]: raw }));
    if (raw === '' || raw === '-') {
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      onChange({ ...value, [field]: n });
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
          <FormLabel htmlFor="dimension-x-input">Dimension X (m)</FormLabel>
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
          <FormLabel htmlFor="dimension-y-input">Dimension Y (m)</FormLabel>
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
            onChange={e => handleNumericChange('area', e.target.value)}
            onBlur={() => markTouched('area')}
            slotProps={{ input: { min: 0, step: 0.01 } }}
          />
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
        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormLabel htmlFor="default-dimension-units-input">Dimension Units</FormLabel>
          <Select
            id="default-dimension-units-input"
            aria-label="Default Dimension Units"
            value={value.defaultDimensionUnits}
            onChange={(_event, newValue) => {
              if (newValue) onChange({ ...value, defaultDimensionUnits: newValue });
            }}
            onBlur={() => markTouched('defaultDimensionUnits')}
          >
            {unitSelectionOptions.map(unit => (
              <Option key={unit} value={unit}>
                {unit}
              </Option>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormLabel htmlFor="default-coordinate-units-input">Coordinate Units</FormLabel>
          <Select
            id="default-coordinate-units-input"
            aria-label="Default Coordinate Units"
            value={value.defaultCoordinateUnits}
            onChange={(_event, newValue) => {
              if (newValue) onChange({ ...value, defaultCoordinateUnits: newValue });
            }}
            onBlur={() => markTouched('defaultCoordinateUnits')}
          >
            {unitSelectionOptions.map(unit => (
              <Option key={unit} value={unit}>
                {unit}
              </Option>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormLabel htmlFor="default-area-units-input">Area Units</FormLabel>
          <Select
            id="default-area-units-input"
            aria-label="Default Area Units"
            value={value.defaultAreaUnits}
            onChange={(_event, newValue) => {
              if (newValue) onChange({ ...value, defaultAreaUnits: newValue });
            }}
            onBlur={() => markTouched('defaultAreaUnits')}
          >
            {areaSelectionOptions.map(unit => (
              <Option key={unit} value={unit}>
                {unit}
              </Option>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormLabel htmlFor="default-dbh-units-input">DBH Units</FormLabel>
          <Select
            id="default-dbh-units-input"
            aria-label="Default DBH Units"
            value={value.defaultDBHUnits}
            onChange={(_event, newValue) => {
              if (newValue) onChange({ ...value, defaultDBHUnits: newValue });
            }}
            onBlur={() => markTouched('defaultDBHUnits')}
          >
            {unitSelectionOptions.map(unit => (
              <Option key={unit} value={unit}>
                {unit}
              </Option>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ flex: 1, minWidth: 160 }}>
          <FormLabel htmlFor="default-hom-units-input">HOM Units</FormLabel>
          <Select
            id="default-hom-units-input"
            aria-label="Default HOM Units"
            value={value.defaultHOMUnits}
            onChange={(_event, newValue) => {
              if (newValue) onChange({ ...value, defaultHOMUnits: newValue });
            }}
            onBlur={() => markTouched('defaultHOMUnits')}
          >
            {unitSelectionOptions.map(unit => (
              <Option key={unit} value={unit}>
                {unit}
              </Option>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </Stack>
  );
}
