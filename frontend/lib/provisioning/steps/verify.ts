import type { ProvisioningStep, StepContext } from '../types';

const MIN_EXPECTED_QUADRATS = 1;

export const verifyStep: ProvisioningStep = {
  key: 'verify',
  label: 'Verify new site is reachable',

  async alreadyDone(): Promise<boolean> {
    return false;
  },

  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');

    const [siteRows]: any = await ctx.catalogPool.query(`SELECT SiteID, SiteName FROM catalog.sites WHERE SchemaName = ?`, [ctx.schemaName]);
    if (siteRows.length !== 1) {
      throw new Error(`verify: expected 1 catalog row for ${ctx.schemaName}, got ${siteRows.length}`);
    }

    const [plotRows]: any = await ctx.sitePool.query(`SELECT PlotID FROM \`${ctx.schemaName}\`.plots WHERE PlotName = ?`, [ctx.input.plot.plotName]);
    if (plotRows.length !== 1) {
      throw new Error(`verify: expected 1 plot row "${ctx.input.plot.plotName}", got ${plotRows.length}`);
    }

    const [censusRows]: any = await ctx.sitePool.query(
      `SELECT CensusID FROM \`${ctx.schemaName}\`.census
       WHERE PlotID = ? AND PlotCensusNumber = 1`,
      [ctx.state.plotId]
    );
    if (censusRows.length !== 1) {
      throw new Error(`verify: expected 1 census row, got ${censusRows.length}`);
    }

    const [quadratRows]: any = await ctx.sitePool.query(`SELECT COUNT(*) AS c FROM \`${ctx.schemaName}\`.quadrats WHERE PlotID = ?`, [ctx.state.plotId]);
    const count = Number(quadratRows[0]?.c ?? quadratRows[0]?.C ?? 0);
    if (count < MIN_EXPECTED_QUADRATS) {
      throw new Error(`verify: expected at least ${MIN_EXPECTED_QUADRATS} quadrat, got ${count}`);
    }
  }
};
