import { Effect } from '../types';
import { RuleContext } from './context';

export async function applyCoordinateRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('StemLocalX') && !ctx.changedFields.has('StemLocalY')) return [];
  const stemGUID = Number(ctx.oldRow.StemGUID);
  if (!stemGUID) return [];
  const rows = await ctx.cm.executeQuery(
    `SELECT COUNT(*) AS cnt FROM ${ctx.schema}.coremeasurements WHERE StemGUID = ?`,
    [stemGUID],
    ctx.transactionID
  );
  const count = Number(rows?.[0]?.cnt ?? 0);
  return [
    {
      id: 'R4',
      severity: 'warn',
      category: 'cross-row',
      title: `Stem coordinate will propagate to ${count} measurement(s)`,
      detail: `Stem S#${stemGUID} coordinate change updates the stem row; every measurement referencing that stem reflects the new value.`,
      affectedTable: 'stems',
      affectedRowCount: count,
      references: { stemGUIDs: [stemGUID] }
    }
  ];
}
