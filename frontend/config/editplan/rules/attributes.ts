import { Effect } from '../types';
import { RuleContext } from './context';

function parseCodes(raw: unknown): Set<string> {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

export async function applyAttributeRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('Attributes')) return [];
  const oldCodes = parseCodes(ctx.oldRow.Attributes);
  const newCodes = parseCodes(ctx.newRow.Attributes);
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
