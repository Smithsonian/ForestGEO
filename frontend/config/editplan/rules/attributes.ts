import { Effect } from '../types';
import { RuleContext } from './context';

/**
 * The one delimiter for a stored attribute-code list, matched to the ingestion
 * stored procedure: db/sql/storedprocedures.sql STAGE 9 splits RawCodes on ';' only
 * (REPLACE(TRIM(rcm.Codes), ';', '","') into a JSON array). Comma is NOT a delimiter —
 * a comma inside a code stays part of that single code, so "A,B" is ONE (invalid) code,
 * not two. Keeping the edit path on this same delimiter is why the analyzer's preview,
 * the writer's DB write, and a fresh bulk ingestion can never disagree about how a code
 * list splits.
 */
export const ATTRIBUTE_CODE_DELIMITER = ';';

/**
 * The single production tokenizer for a stored attribute-code list. Both edit consumers
 * import it — the ANALYZER (applyAttributeRules, this file) and the WRITER
 * (writeMeasurementsSummary, ../writers/measurementssummary) — so an edit's warning
 * preview and its actual cmattributes rebuild always agree, and both agree with how
 * bulkingestionprocess materializes cmattributes from RawCodes.
 */
export function parseAttributeCodes(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(ATTRIBUTE_CODE_DELIMITER)
    .map(code => code.trim())
    .filter(Boolean);
}

export async function applyAttributeRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('Attributes')) return [];
  const oldCodes = new Set(parseAttributeCodes(ctx.oldRow.Attributes));
  const newCodes = new Set(parseAttributeCodes(ctx.newRow.Attributes));
  if (oldCodes.size === newCodes.size && [...oldCodes].every(c => newCodes.has(c))) return [];

  const dropped = [...oldCodes].filter(c => !newCodes.has(c));
  const severity: 'info' | 'destructive' = dropped.length > 0 ? 'destructive' : 'info';
  return [
    {
      id: 'R5',
      severity,
      category: severity === 'destructive' ? 'destructive' : 'field',
      title: severity === 'destructive' ? `Attribute codes ${dropped.join(', ')} will be removed` : 'Attribute codes will be rebuilt',
      detail: `cmattributes rows for this measurement are deleted and re-inserted for the new code set.`,
      affectedTable: 'cmattributes',
      affectedRowCount: Math.max(oldCodes.size, newCodes.size)
    }
  ];
}
