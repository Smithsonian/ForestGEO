import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

export type AreaMode = 'derived' | 'manual';

export type DimensionUnit = (typeof unitSelectionOptions)[number];
export type AreaUnit = (typeof areaSelectionOptions)[number];

interface AreaDerivable {
  dimensionX: number;
  dimensionY: number;
  area: number;
  defaultDimensionUnits: DimensionUnit;
  defaultAreaUnits: AreaUnit;
}

export function deriveArea(dimensionX: number, dimensionY: number): number {
  return dimensionX * dimensionY;
}

/**
 * unitSelectionOptions and areaSelectionOptions are parallel decimal-prefix
 * lists, so the squared unit is the entry at the same index. Index lookup
 * rather than string concatenation keeps the dependency on that parallelism
 * explicit and lets an unknown unit fail loudly.
 */
export function deriveAreaUnit(dimensionUnit: DimensionUnit): AreaUnit {
  const index = unitSelectionOptions.indexOf(dimensionUnit);
  if (index === -1) {
    // DimensionUnit narrows this branch to unreachable for schema-validated
    // input; the guard stays for values arriving from unvalidated JSON at runtime.
    throw new Error(`Cannot derive an area unit for unknown dimension unit "${dimensionUnit}"`);
  }
  return areaSelectionOptions[index];
}

export function applyAreaDerivation<T extends AreaDerivable>(plot: T, areaMode: AreaMode): T {
  // Same reference is intentional: the wizard calls this on every keystroke
  // inside a React state setter, and a fresh object here would force needless re-renders.
  if (areaMode === 'manual') return plot;
  return {
    ...plot,
    area: deriveArea(plot.dimensionX, plot.dimensionY),
    defaultAreaUnits: deriveAreaUnit(plot.defaultDimensionUnits)
  };
}

export interface PlotAreaChange<T> {
  plot: T;
  areaMode: AreaMode;
}

/**
 * Resolves a plot edit and any requested mode transition in one step. The
 * requested mode must win over the current mode here rather than via a
 * separate state update, because React batches those and the derivation
 * would still read the pre-transition mode.
 */
export function resolvePlotAreaChange<T extends AreaDerivable>(plot: T, currentMode: AreaMode, requestedMode?: AreaMode): PlotAreaChange<T> {
  const areaMode = requestedMode ?? currentMode;
  return { plot: applyAreaDerivation(plot, areaMode), areaMode };
}
