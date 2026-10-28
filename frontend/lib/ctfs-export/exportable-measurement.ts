/**
 * Shared SQL fragments defining what an "exportable measurement" is, and how a
 * measurement links to its stem, tree, quadrat and taxonomy.
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

export type MeasurementLinkAlias = 's' | 't' | 'q' | 'sp' | 'gn' | 'fam';
export type MeasurementLinkJoin = 'JOIN' | 'LEFT JOIN';

interface MeasurementLink {
  alias: MeasurementLinkAlias;
  table: string;
  on: string;
  /** The joined table's primary key: NULL after a LEFT JOIN exactly when the link found no row. */
  key: string;
}

/**
 * Every link joins on the linked table's primary key, so joining any of them adds at most one row per
 * measurement. The overview's single pass relies on that: it LEFT JOINs every link and tests `key IS NOT NULL`
 * where a per-check query inner-joins. A link keyed on anything else would multiply rows and break those counts.
 */
export const MEASUREMENT_LINKS: readonly MeasurementLink[] = [
  { alias: 's', table: 'stems', on: 's.StemGUID = cm.StemGUID', key: 's.StemGUID' },
  { alias: 't', table: 'trees', on: 't.TreeID = s.TreeID', key: 't.TreeID' },
  { alias: 'q', table: 'quadrats', on: 'q.QuadratID = s.QuadratID', key: 'q.QuadratID' },
  { alias: 'sp', table: 'species', on: 'sp.SpeciesID = t.SpeciesID', key: 'sp.SpeciesID' },
  { alias: 'gn', table: 'genus', on: 'gn.GenusID = sp.GenusID', key: 'gn.GenusID' },
  { alias: 'fam', table: 'family', on: 'fam.FamilyID = gn.FamilyID', key: 'fam.FamilyID' }
];

export const ALL_MEASUREMENT_LINK_ALIASES: readonly MeasurementLinkAlias[] = MEASUREMENT_LINKS.map(link => link.alias);

function linksIn(aliases: readonly MeasurementLinkAlias[]): readonly MeasurementLink[] {
  return MEASUREMENT_LINKS.filter(link => aliases.includes(link.alias));
}

/** The joins for `aliases`, in catalog order, with `??` schema placeholders. */
export function joinMeasurementLinks(aliases: readonly MeasurementLinkAlias[], join: MeasurementLinkJoin): string {
  return linksIn(aliases)
    .map(link => `${join} ??.${link.table} ${link.alias} ON ${link.on}`)
    .join('\n       ');
}

/** TRUE exactly when every link in `aliases` found its row: over a LEFT JOIN graph, the stand-in for inner-joining them. */
export function measurementLinksMatched(aliases: readonly MeasurementLinkAlias[]): string {
  const keyGuards = linksIn(aliases).map(link => `${link.key} IS NOT NULL`);
  return keyGuards.length === 0 ? 'TRUE' : keyGuards.join(' AND ');
}

/** The export predicate's row clauses; the census scope and the inner-joined links make up the rest. */
export const EXPORTABLE_ROW_CONDITION = 'cm.IsValidated = TRUE AND cm.StemGUID IS NOT NULL AND s.IsActive = 1 AND t.IsActive = 1';

/**
 * The WHERE clause body that selects exportable measurements: the census and
 * plot (`[censusId, plotId]`), active measurements, then EXPORTABLE_ROW_CONDITION.
 * Designed to be dropped into a query that has already joined `cm`, `c`, `s`,
 * and `t` aliases on the relevant tables.
 */
export const exportableMeasurementBaseWhere = `cm.CensusID = ?
        AND c.PlotID = ?
        AND cm.IsActive = 1
        AND (${EXPORTABLE_ROW_CONDITION})`;

/**
 * The inner-join graph every exportable measurement must satisfy. Five of these
 * links (stems.TreeID, stems.QuadratID, trees.SpeciesID, species.GenusID,
 * genus.FamilyID) are nullable, so a validated row can still fall out here.
 */
const exportableMeasurementJoinGraph = `FROM ??.coremeasurements cm
       ${joinMeasurementLinks(ALL_MEASUREMENT_LINK_ALIASES, 'JOIN')}
       JOIN ??.census c ON c.CensusID = cm.CensusID`;

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
       ${exportableMeasurementJoinGraph}
      WHERE ${exportableMeasurementBaseWhere}`;
}

/**
 * `SELECT cm.CoreMeasurementID` for every exportable measurement, for the gate's
 * check-8 count and the exported-with-unresolved-error count. selectMeasurements
 * uses exportableMeasurementSelect instead; both are built from
 * exportableMeasurementJoinGraph and exportableMeasurementBaseWhere, so a change
 * to what counts as exportable belongs in MEASUREMENT_LINKS and
 * EXPORTABLE_ROW_CONDITION. Same `??` and `[censusId, plotId]` contract as
 * exportableMeasurementSelect.
 * Used as a subquery, its aliases shadow the outer query's, so it never correlates.
 */
export function exportableMeasurementIdSelect(): string {
  return `SELECT cm.CoreMeasurementID
       ${exportableMeasurementJoinGraph}
      WHERE ${exportableMeasurementBaseWhere}`;
}
