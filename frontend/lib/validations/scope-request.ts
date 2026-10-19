import { type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { type RecheckMeasurementScope } from '@/lib/validations/reset';

export const SCOPE_REQUEST_NOT_OBJECT_MESSAGE = 'Request body must be a JSON object';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseMeasurementScopeBody(body: Record<string, unknown>): MeasurementScopeInput | null {
  const { schema, plotID, censusID } = body;
  if (!isNonEmptyString(schema) || !isPositiveSafeInteger(plotID) || !isPositiveSafeInteger(censusID)) return null;
  return { schema, plotID, censusID };
}

export function parseRecheckScopeBody(body: Record<string, unknown>): RecheckMeasurementScope | null {
  const scope = parseMeasurementScopeBody(body);
  const { coreMeasurementID } = body;
  if (!scope || !isPositiveSafeInteger(coreMeasurementID)) return null;
  return { ...scope, coreMeasurementID };
}
