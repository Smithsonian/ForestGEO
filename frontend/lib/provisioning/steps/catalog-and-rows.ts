import type { ProvisioningStep, StepContext } from '../types';

const SITES_TABLE = 'catalog.sites';

export const insertCatalogRowStep: ProvisioningStep = {
  key: 'insert_catalog_row',
  label: 'Register site in catalog',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    const [rows]: any = await ctx.catalogPool.query(`SELECT SiteID FROM ${SITES_TABLE} WHERE SchemaName = ? LIMIT 1`, [ctx.schemaName]);
    if (rows.length > 0) {
      ctx.state.siteId = rows[0].SiteID ?? rows[0].siteid;
      return true;
    }
    return false;
  },
  async run(ctx: StepContext): Promise<void> {
    const s = ctx.input.site;
    const [result]: any = await ctx.catalogPool.query(
      `INSERT INTO ${SITES_TABLE}
        (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.siteName, ctx.schemaName, s.sqDimX, s.sqDimY, s.defaultUOMDBH, s.defaultUOMHOM, s.doubleDataEntry ? 1 : 0]
    );
    ctx.state.siteId = result.insertId;
  }
};

export const insertPlotStep: ProvisioningStep = {
  key: 'insert_plot',
  label: 'Create first plot',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool) return false;
    const [rows]: any = await ctx.sitePool.query(`SELECT PlotID FROM \`${ctx.schemaName}\`.plots WHERE PlotName = ? LIMIT 1`, [ctx.input.plot.plotName]);
    if (rows.length > 0) {
      ctx.state.plotId = rows[0].PlotID ?? rows[0].plotid;
      return true;
    }
    return false;
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    const p = ctx.input.plot;
    const [result]: any = await ctx.sitePool.query(
      `INSERT INTO \`${ctx.schemaName}\`.plots
        (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area,
         GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription,
         DefaultDimensionUnits, DefaultCoordinateUnits, DefaultAreaUnits,
         DefaultDBHUnits, DefaultHOMUnits)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.plotName,
        ctx.input.site.location,
        ctx.input.site.country,
        p.dimensionX,
        p.dimensionY,
        p.area,
        p.globalX,
        p.globalY,
        p.globalZ,
        p.plotShape,
        p.description,
        p.defaultDimensionUnits,
        p.defaultCoordinateUnits,
        p.defaultAreaUnits,
        p.defaultDBHUnits,
        p.defaultHOMUnits
      ]
    );
    ctx.state.plotId = result.insertId;
  }
};

export const insertCensusStep: ProvisioningStep = {
  key: 'insert_census',
  label: 'Create first census',
  async alreadyDone(ctx: StepContext): Promise<boolean> {
    if (!ctx.sitePool || ctx.state.plotId == null) return false;
    const [rows]: any = await ctx.sitePool.query(
      `SELECT CensusID FROM \`${ctx.schemaName}\`.census
       WHERE PlotID = ? AND PlotCensusNumber = 1 LIMIT 1`,
      [ctx.state.plotId]
    );
    if (rows.length > 0) {
      ctx.state.censusId = rows[0].CensusID ?? rows[0].censusid;
      return true;
    }
    return false;
  },
  async run(ctx: StepContext): Promise<void> {
    if (!ctx.sitePool) throw new Error('sitePool not initialized');
    const plotId = ctx.state.plotId;
    if (plotId == null) throw new Error('plotId missing from state');
    const [result]: any = await ctx.sitePool.query(
      `INSERT INTO \`${ctx.schemaName}\`.census
        (PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive)
       VALUES (?, 1, NULL, NULL, ?, 1)`,
      [plotId, 'Initial census']
    );
    ctx.state.censusId = result.insertId;
  }
};
