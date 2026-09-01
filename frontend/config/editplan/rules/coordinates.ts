import { Effect } from '../types';
import { RuleContext } from './context';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

export async function applyCoordinateRules(ctx: RuleContext): Promise<Effect[]> {
  const coordinateFields = ['StemLocalX', 'StemLocalY', 'StemPlotX', 'StemPlotY'];
  if (!coordinateFields.some(field => ctx.changedFields.has(field))) return [];
  const includesPlotCoordinate = ctx.changedFields.has('StemPlotX') || ctx.changedFields.has('StemPlotY');
  const stemGUID = Number(ctx.oldRow.StemGUID);
  if (!stemGUID) return [];
  const rows = await ctx.cm.executeQuery(
    safeFormatQuery(ctx.schema, `SELECT COUNT(*) AS cnt FROM ??.coremeasurements WHERE StemGUID = ?`),
    [stemGUID],
    ctx.transactionID
  );
  const count = Number(rows?.[0]?.cnt ?? 0);
  return [
    {
      id: 'R4',
      severity: 'warn',
      category: 'cross-row',
      title: includesPlotCoordinate
        ? `Shared stem plot coordinate affects ${count} measurement(s)`
        : `Stem coordinate will propagate to ${count} measurement(s)`,
      detail: includesPlotCoordinate
        ? `Stem S#${stemGUID} plot-coordinate change updates the shared stem row. Measurements without their own raw plot-coordinate snapshot reflect the new canonical value; measurements with raw upload values keep displaying those snapshots.`
        : `Stem S#${stemGUID} coordinate change updates the stem row; every measurement referencing that stem reflects the new value.`,
      affectedTable: 'stems',
      affectedRowCount: count,
      references: { stemGUIDs: [stemGUID] }
    }
  ];
}
