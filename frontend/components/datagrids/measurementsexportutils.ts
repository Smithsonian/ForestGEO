import type { ErrorMap } from '@/config/macros/uploadsystemmacros';

export function getMeasurementCsvErrorValue(row: Record<string, unknown>, validationErrors: ErrorMap): string | null {
  const existingValue = row.Errors ?? row.errors;
  if (typeof existingValue === 'string' && existingValue.trim() !== '') {
    return existingValue;
  }

  const measurementID = Number(row.CoreMeasurementID ?? row.coreMeasurementID);
  if (!Number.isFinite(measurementID) || !validationErrors[measurementID]) {
    return null;
  }

  const fallbackDescriptions = validationErrors[measurementID].errors.flatMap(error =>
    error.validationPairs.map(pair => pair.description?.trim()).filter((description): description is string => Boolean(description))
  );
  const uniqueDescriptions = Array.from(new Set(fallbackDescriptions));
  return uniqueDescriptions.length > 0 ? uniqueDescriptions.join('; ') : null;
}
