/**
 * Shared SQL for the dashboard "Total Trees" / "Total Stems" tiles.
 *
 * Both dashboardmetrics route files (the aggregated `all` endpoint and the
 * legacy per-metric endpoint) must count the SAME thing, so the SQL lives
 * here once instead of being copy-pasted twice and drifting.
 *
 * A stem/tree counts only while it has at least one active (IsActive = 1)
 * measurement in the selected census, scoped to the selected plot. Counts
 * shrink the moment a measurement is hard-deleted, without mutating the
 * `stems`/`trees` identity rows themselves. Failed/unresolved measurements
 * (`cm.StemGUID IS NULL`) are excluded for free by the inner join to `stems`.
 *
 * Parameter contract: both builders below bind positional parameters in the
 * order [censusID, plotID].
 */

export function buildMeasuredStemCountSql(schema: string): string {
  return `SELECT COUNT(DISTINCT s.StemGUID) AS CountStems
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = cm.CensusID
          JOIN ${schema}.census c ON cm.CensusID = c.CensusID
          WHERE cm.CensusID = ? AND c.PlotID = ?
            AND cm.IsActive = 1 AND s.IsActive = 1 AND c.IsActive = 1`;
}

export function buildMeasuredTreeCountSql(schema: string): string {
  return `SELECT COUNT(DISTINCT t.TreeID) AS CountTrees
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = cm.CensusID
          JOIN ${schema}.trees t ON s.TreeID = t.TreeID AND t.CensusID = cm.CensusID
          JOIN ${schema}.census c ON cm.CensusID = c.CensusID
          WHERE cm.CensusID = ? AND c.PlotID = ?
            AND cm.IsActive = 1 AND s.IsActive = 1 AND t.IsActive = 1 AND c.IsActive = 1`;
}
