import type { TransformWarning } from './types';

const CSV_HEADER = 'type,sheet,rowIndex,globalId,value,message';

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function warningsToCsv(warnings: TransformWarning[]): string {
  const rows = warnings.map(w =>
    [
      escapeCsvField(w.type),
      escapeCsvField(w.sheet),
      escapeCsvField(w.rowIndex),
      escapeCsvField(w.globalId),
      escapeCsvField(w.value),
      escapeCsvField(w.message)
    ].join(',')
  );
  return [CSV_HEADER, ...rows].join('\n');
}
