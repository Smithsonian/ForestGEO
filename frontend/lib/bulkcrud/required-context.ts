type BulkcrudContext = 'plot' | 'census';

const BULKCRUD_REQUIRED_CONTEXT: Readonly<Record<string, readonly BulkcrudContext[]>> = {
  attributes: [],
  species: [],
  quadrats: ['plot'],
  personnel: [],
  measurements: ['plot', 'census'],
  measurementssummary: ['plot', 'census'],
  measurementssummaryview: ['plot', 'census']
};

export const BULKCRUD_REJECTION_MESSAGES = {
  missingGridType: 'No grid type provided',
  missingPlot: 'Select a plot before submitting these rows.',
  missingCensus: 'Select a census before submitting these rows.',
  missingRows: 'No rows provided'
} as const;

export function findMissingBulkcrudContext(gridType: string | undefined, plot: unknown, census: unknown): string | null {
  if (!gridType) return BULKCRUD_REJECTION_MESSAGES.missingGridType;
  if (!Object.hasOwn(BULKCRUD_REQUIRED_CONTEXT, gridType)) return `Unsupported grid type: ${gridType}`;
  const requiredContext = BULKCRUD_REQUIRED_CONTEXT[gridType];
  if (requiredContext.includes('plot') && !plot) return BULKCRUD_REJECTION_MESSAGES.missingPlot;
  if (requiredContext.includes('census') && !census) return BULKCRUD_REJECTION_MESSAGES.missingCensus;
  return null;
}
