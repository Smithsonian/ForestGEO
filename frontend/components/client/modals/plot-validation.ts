import type { PlotRDS } from '@/lib/db/definitions/zones';
import { parseEpsgForSave } from '@/components/client/modals/plot-epsg';

type ValidatedPlotField = 'plotName' | 'dimensionX' | 'dimensionY' | 'area' | 'globalX' | 'globalY' | 'globalZ' | 'globalCoordinatesEPSG';

export type PlotFieldErrors = Partial<Record<ValidatedPlotField, string>>;

const isBlank = (raw: unknown): boolean => raw === undefined || raw === null || String(raw).trim() === '';

function parseFinite(raw: unknown): number {
  return typeof raw === 'number' ? raw : Number(String(raw).trim());
}

/**
 * Validates the plot edit form. Name is required (after trimming). Dimensions and area are
 * optional, but when entered must be finite and strictly positive. Global coordinates are
 * optional and may be negative (signed geographic coordinates are valid) but must be finite.
 * The EPSG code reuses parseEpsgForSave; blank means "not recorded".
 */
export function validatePlot(plot: PlotRDS): PlotFieldErrors {
  const errors: PlotFieldErrors = {};

  if (isBlank(plot.plotName)) {
    errors.plotName = 'Plot name is required.';
  }

  const positiveFields: [keyof PlotRDS & ('dimensionX' | 'dimensionY' | 'area'), string][] = [
    ['dimensionX', 'X dimension'],
    ['dimensionY', 'Y dimension'],
    ['area', 'Plot area']
  ];
  for (const [key, label] of positiveFields) {
    const raw = plot[key];
    if (isBlank(raw)) continue;
    const value = parseFinite(raw);
    if (!Number.isFinite(value) || value <= 0) {
      errors[key] = `${label} must be a number greater than zero.`;
    }
  }

  const coordinateFields: [keyof PlotRDS & ('globalX' | 'globalY' | 'globalZ'), string][] = [
    ['globalX', 'Global X-coordinate'],
    ['globalY', 'Global Y-coordinate'],
    ['globalZ', 'Global Z-coordinate']
  ];
  for (const [key, label] of coordinateFields) {
    const raw = plot[key];
    if (isBlank(raw)) continue;
    if (!Number.isFinite(parseFinite(raw))) {
      errors[key] = `${label} must be a number.`;
    }
  }

  const epsg = parseEpsgForSave(plot.globalCoordinatesEPSG);
  if (!epsg.ok) {
    errors.globalCoordinatesEPSG = epsg.error;
  }

  return errors;
}
