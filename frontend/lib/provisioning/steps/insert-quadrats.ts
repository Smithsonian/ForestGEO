import type { ProvisioningStep, StepContext } from '../types';
import { generateGrid } from '../grid-generator';

const QUADRATS_TABLE = 'quadrats';
const DEFAULT_SHAPE = 'square';

function resolveRows(ctx: StepContext) {
  if (ctx.input.quadrats.mode === 'grid') {
    return generateGrid(ctx.input.plot, ctx.input.quadrats);
  }
  return ctx.input.quadrats.rows;
}

export const insertQuadratsStep: ProvisioningStep = {
  key: 'insert_quadrats',
  label: 'Create quadrats',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool || ctx.state.plotId == null) return false;
    const expected = resolveRows(ctx).length;
    const [rows]: any = await ctx.sitePool.query(`SELECT COUNT(*) AS c FROM \`${ctx.schemaName}\`.\`${QUADRATS_TABLE}\` WHERE PlotID = ?`, [ctx.state.plotId]);
    const actual = Number(rows[0]?.c ?? rows[0]?.C ?? 0);
    return actual === expected;
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    const plotId = ctx.state.plotId;
    if (plotId == null) throw new Error('plotId missing from state');

    // Clear any partial state — safe because the plot is brand-new
    await ctx.sitePool.query(`DELETE FROM \`${ctx.schemaName}\`.\`${QUADRATS_TABLE}\` WHERE PlotID = ?`, [plotId]);

    const rows = resolveRows(ctx);
    if (rows.length === 0) return;

    const values = rows.map(r => [plotId, r.quadratName, r.startX, r.startY, r.dimensionX, r.dimensionY, r.dimensionX * r.dimensionY, DEFAULT_SHAPE, 1]);
    await ctx.sitePool.query(
      `INSERT INTO \`${ctx.schemaName}\`.\`${QUADRATS_TABLE}\`
        (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES ?`,
      [values]
    );
  }
};
