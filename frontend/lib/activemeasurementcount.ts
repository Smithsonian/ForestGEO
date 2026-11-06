import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';

export interface ActiveMeasurementCountQuery {
  sql: string;
  params: number[];
}

export class ActiveMeasurementCountUnreadableError extends Error {
  constructor(rows: unknown) {
    super(`The active-measurement count query returned an unreadable result: ${JSON.stringify(rows)}`);
    this.name = 'ActiveMeasurementCountUnreadableError';
  }
}

/** COUNT(*) of coremeasurements with IsActive = 1 over the census IDs in scope. Each caller runs it on its own connection. */
export function buildActiveMeasurementCountQuery(schema: string, plotID: number, censusIDs: readonly number[]): ActiveMeasurementCountQuery {
  return {
    sql: safeFormatQuery(
      schema,
      `SELECT COUNT(*) AS n
           FROM ??.coremeasurements cm
           JOIN ??.census c ON c.CensusID = cm.CensusID
          WHERE c.PlotID = ? AND cm.IsActive = 1 AND cm.CensusID IN (${buildInPlaceholders(censusIDs.length)})`
    ),
    params: [plotID, ...censusIDs]
  };
}

export function readActiveMeasurementCount(rows: unknown): number {
  const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
  const raw = first !== null && typeof first === 'object' && 'n' in first ? (first as { n: unknown }).n : undefined;
  const count = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) throw new ActiveMeasurementCountUnreadableError(rows);
  return count;
}
