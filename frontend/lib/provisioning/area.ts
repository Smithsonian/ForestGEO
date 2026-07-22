import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

export type AreaMode = 'derived' | 'manual';

interface AreaDerivable {
  dimensionX: number;
  dimensionY: number;
  area: number;
  defaultDimensionUnits: string;
  defaultAreaUnits: string;
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
export function deriveAreaUnit(dimensionUnit: string): string {
  const index = (unitSelectionOptions as readonly string[]).indexOf(dimensionUnit);
  if (index === -1) {
    throw new Error(`Cannot derive an area unit for unknown dimension unit "${dimensionUnit}"`);
  }
  return areaSelectionOptions[index];
}

export function applyAreaDerivation<T extends AreaDerivable>(plot: T, areaMode: AreaMode): T {
  if (areaMode === 'manual') return plot;
  return {
    ...plot,
    area: deriveArea(plot.dimensionX, plot.dimensionY),
    defaultAreaUnits: deriveAreaUnit(plot.defaultDimensionUnits)
  };
}
