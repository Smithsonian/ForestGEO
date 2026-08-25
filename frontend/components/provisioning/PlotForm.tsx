'use client';

import { useState } from 'react';
import { Button, FormControl, FormHelperText, FormLabel, Input, Option, Select, Stack, Textarea, Typography } from '@mui/joy';
import type { ProvisioningPlotInput } from '@/lib/provisioning/types';
import type { AreaMode } from '@/lib/provisioning/area';
import { EPSG_CODE_MAX, EPSG_CODE_MIN, GEOGRAPHIC_EPSG_CODES, GLOBAL_COORDINATE_ABS_MAX } from '@/lib/provisioning/input-schema';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

const PLOT_SHAPE_OPTIONS: Array<{ value: ProvisioningPlotInput['plotShape']; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'irregular', label: 'Irregular' }
];

type PlotValue = ProvisioningPlotInput;

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

function isGlobalCoordinateOutOfRange(n: number): boolean {
  return !Number.isFinite(n) || Math.abs(n) > GLOBAL_COORDINATE_ABS_MAX;
}

function isEpsgCodeOutOfRange(code: number | undefined): boolean {
  if (code === undefined) return false;
  return !Number.isInteger(code) || code < EPSG_CODE_MIN || code > EPSG_CODE_MAX;
}

function isEpsgCodeGeographic(code: number | undefined): boolean {
  return code !== undefined && GEOGRAPHIC_EPSG_CODES.has(code);
}

function isEpsgCodeInvalid(code: number | undefined): boolean {
  return isEpsgCodeOutOfRange(code) || isEpsgCodeGeographic(code);
}

// A numeric draft that is empty, a bare '-', or otherwise unparsable is mid-edit
// and has not been (and will not be) propagated via onChange — see handleNumericChange.
function isUncommittedNumericDraft(raw: string): boolean {
  if (raw === '' || raw === '-') return true;
  return !Number.isFinite(Number(raw));
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
  const [epsgDraft, setEpsgDraft] = useState<string>(String(value.globalCoordinatesEPSG ?? ''));

  function handleNumericChange(field: NumericPlotField, raw: string, requestedMode?: AreaMode) {
    setNumericDrafts(prev => ({ ...prev, [field]: raw }));
    if (isUncommittedNumericDraft(raw)) {
      return;
    }
    onChange({ ...value, [field]: Number(raw) }, requestedMode);
  }

  // Unlike the required numeric fields, EPSG is optional: clearing the box must
  // commit "not recorded" (undefined) rather than keeping the last valid value.
  function handleEpsgChange(raw: string) {
    setEpsgDraft(raw);
    if (raw === '') {
      onChange({ ...value, globalCoordinatesEPSG: undefined });
      return;
    }
    if (isUncommittedNumericDraft(raw)) {
      return;
    }
    onChange({ ...value, globalCoordinatesEPSG: Number(raw) });
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
            // While derived, prefer the live derived value so it tracks dimension edits;
            // but if the user has an uncommitted edit sitting in the box (e.g. they just
            // cleared it and haven't typed a replacement yet — see isUncommittedNumericDraft),
            // that mode transition to 'manual' hasn't happened yet, so show their draft
            // instead of snapping the box back to the derived number.
            value={areaMode === 'derived' && !isUncommittedNumericDraft(numericDrafts.area) ? String(value.area) : numericDrafts.area}
            onChange={e => handleNumericChange('area', e.target.value, 'manual')}
            onBlur={() => markTouched('area')}
            slotProps={{ input: { min: 0, step: 0.01 } }}
          />
          {areaMode === 'derived' ? (
            <FormHelperText>Auto-calculated from the plot dimensions. Type here to enter it yourself.</FormHelperText>
          ) : (
            <FormHelperText>
              <Button variant="plain" size="sm" sx={{ minHeight: 'auto', p: 0, fontSize: 'inherit' }} onClick={() => onAreaModeChange('derived')}>
                Use calculated value
              </Button>
            </FormHelperText>
          )}
          {shouldShowError('area') && areaInvalid && <FormHelperText>Must be a positive number.</FormHelperText>}
        </FormControl>
      </Stack>

      <Typography level="title-sm">Global Coordinates</Typography>
      <Typography level="body-sm">
        The plot origin as plain linear coordinates in the coordinate unit below — for example UTM easting/northing in meters. Degrees-minutes-seconds is not
        supported.
      </Typography>
      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }} error={shouldShowError('globalX') && isGlobalCoordinateOutOfRange(value.globalX)}>
          <FormLabel htmlFor="global-x-input">Global X ({value.defaultCoordinateUnits})</FormLabel>
          <Input
            id="global-x-input"
            aria-label="Global X"
            type="number"
            value={numericDrafts.globalX}
            onChange={e => handleNumericChange('globalX', e.target.value)}
            onBlur={() => markTouched('globalX')}
            slotProps={{ input: { step: 0.0001 } }}
          />
          {shouldShowError('globalX') && isGlobalCoordinateOutOfRange(value.globalX) && (
            <FormHelperText>Must be a finite coordinate with absolute value at most {GLOBAL_COORDINATE_ABS_MAX}.</FormHelperText>
          )}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('globalY') && isGlobalCoordinateOutOfRange(value.globalY)}>
          <FormLabel htmlFor="global-y-input">Global Y ({value.defaultCoordinateUnits})</FormLabel>
          <Input
            id="global-y-input"
            aria-label="Global Y"
            type="number"
            value={numericDrafts.globalY}
            onChange={e => handleNumericChange('globalY', e.target.value)}
            onBlur={() => markTouched('globalY')}
            slotProps={{ input: { step: 0.0001 } }}
          />
          {shouldShowError('globalY') && isGlobalCoordinateOutOfRange(value.globalY) && (
            <FormHelperText>Must be a finite coordinate with absolute value at most {GLOBAL_COORDINATE_ABS_MAX}.</FormHelperText>
          )}
        </FormControl>

        <FormControl sx={{ flex: 1 }} error={shouldShowError('globalZ') && isGlobalCoordinateOutOfRange(value.globalZ)}>
          <FormLabel htmlFor="global-z-input">Global Z ({value.defaultCoordinateUnits})</FormLabel>
          <Input
            id="global-z-input"
            aria-label="Global Z"
            type="number"
            value={numericDrafts.globalZ}
            onChange={e => handleNumericChange('globalZ', e.target.value)}
            onBlur={() => markTouched('globalZ')}
            slotProps={{ input: { step: 0.0001 } }}
          />
          {shouldShowError('globalZ') && isGlobalCoordinateOutOfRange(value.globalZ) && (
            <FormHelperText>Must be a finite coordinate with absolute value at most {GLOBAL_COORDINATE_ABS_MAX}.</FormHelperText>
          )}
        </FormControl>
      </Stack>

      <FormControl sx={{ maxWidth: 360 }} error={shouldShowError('globalCoordinatesEPSG') && isEpsgCodeInvalid(value.globalCoordinatesEPSG)}>
        <FormLabel htmlFor="global-epsg-input">Coordinate system (EPSG code)</FormLabel>
        <Input
          id="global-epsg-input"
          aria-label="Coordinate system EPSG code"
          type="number"
          value={epsgDraft}
          placeholder="e.g. 26916"
          onChange={e => handleEpsgChange(e.target.value)}
          onBlur={() => markTouched('globalCoordinatesEPSG')}
          slotProps={{ input: { min: EPSG_CODE_MIN, max: EPSG_CODE_MAX, step: 1 } }}
        />
        {shouldShowError('globalCoordinatesEPSG') && isEpsgCodeGeographic(value.globalCoordinatesEPSG) ? (
          <FormHelperText>
            EPSG:{value.globalCoordinatesEPSG} is a geographic (latitude/longitude) system — enter the origin in a projected system instead, e.g. 26916 = NAD83
            / UTM zone 16N.
          </FormHelperText>
        ) : shouldShowError('globalCoordinatesEPSG') && isEpsgCodeOutOfRange(value.globalCoordinatesEPSG) ? (
          <FormHelperText>
            Must be an integer between {EPSG_CODE_MIN} and {EPSG_CODE_MAX}.
          </FormHelperText>
        ) : (
          <FormHelperText>The EPSG identifier of the system above — e.g. 26916 = NAD83 / UTM zone 16N. Leave blank if not recorded.</FormHelperText>
        )}
      </FormControl>

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
