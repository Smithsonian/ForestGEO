/**
 * Shared SQL fragment defining what an "exportable measurement" is.
 *
 * Both `checkFinishedCensus` (precondition) and `selectMeasurements` (data
 * fetch) MUST filter rows the same way — otherwise a row could pass the
 * precondition check and then disappear from the export, or vice versa. This
 * module is the single source of truth for that definition.
 *
 * Schema interpolation uses the `??` placeholder, which `safeFormatQuery`
 * replaces with the validated backtick-quoted schema name. Two `?` parameters
 * are expected in the prepared statement: `[censusId, plotId]`, in that order.
 */

/**
 * The WHERE clause body that selects exportable measurements.
 *
 * Filters:
 *   - `coremeasurements.CensusID = ?` (censusId)
 *   - `coremeasurements.IsActive = 1`
 *   - `coremeasurements.IsValidated = TRUE`
 *   - `coremeasurements.StemGUID IS NOT NULL`
 *   - `census.PlotID = ?` (plotId)
 *   - `stems.IsActive = 1`
 *   - `trees.IsActive = 1`
 *
 * Designed to be dropped into a query that has already joined `cm`, `c`, `s`,
 * and `t` aliases on the relevant tables.
 */
export const exportableMeasurementBaseWhere = `cm.CensusID = ?
        AND c.PlotID     = ?
        AND cm.IsActive    = 1
        AND cm.IsValidated = TRUE
        AND cm.StemGUID   IS NOT NULL
        AND s.IsActive     = 1
        AND t.IsActive     = 1`;

/**
 * Build a complete SELECT against the full join graph for exportable
 * measurements. The caller supplies the columns it wants between
 * `SELECT cm.CoreMeasurementID,` and the trailing `FROM`.
 *
 * The schema name is interpolated via `??` placeholders that `safeFormatQuery`
 * resolves; pass the result through `safeFormatQuery` before `conn.query`.
 */
export function exportableMeasurementSelect(extraColumns: string): string {
  return `SELECT cm.CoreMeasurementID,${extraColumns}
       FROM ??.coremeasurements cm
       JOIN ??.stems   s   ON s.StemGUID  = cm.StemGUID
       JOIN ??.trees   t   ON t.TreeID    = s.TreeID
       JOIN ??.quadrats q  ON q.QuadratID = s.QuadratID
       JOIN ??.species  sp ON sp.SpeciesID = t.SpeciesID
       JOIN ??.genus    gn ON gn.GenusID  = sp.GenusID
       JOIN ??.family   fam ON fam.FamilyID = gn.FamilyID
       JOIN ??.census   c  ON c.CensusID  = cm.CensusID
      WHERE ${exportableMeasurementBaseWhere}`;
}
