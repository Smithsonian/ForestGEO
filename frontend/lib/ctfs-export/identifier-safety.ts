import { randomBytes } from 'node:crypto';

const SLUG_REPLACE = /[^A-Za-z0-9_]+/g;
const SLUG_MAX = 32;

export interface NamingInput {
  destinationPlotId: number;
  plotCensusNumber: string;
}

export function buildProcedureName(opts: NamingInput): string {
  if (!Number.isInteger(opts.destinationPlotId) || opts.destinationPlotId < 0) {
    throw new Error(`destinationPlotId must be a non-negative integer; got: ${opts.destinationPlotId}`);
  }
  const slug = opts.plotCensusNumber
    .replace(SLUG_REPLACE, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX);
  if (slug.length === 0) {
    throw new Error(`PlotCensusNumber slug is empty after sanitization (input: ${JSON.stringify(opts.plotCensusNumber)})`);
  }
  return `csv_to_sql_v2_load_${opts.destinationPlotId}_${slug}_${randomSuffix()}`;
}

export function buildLockName(opts: NamingInput): string {
  return `ctfs-export:${opts.destinationPlotId}:${opts.plotCensusNumber}`;
}

export function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}
