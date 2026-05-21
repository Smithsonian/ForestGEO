/**
 * Query the app DB and return measurement and attribute rows in the shape
 * required by `renderStage1` (staging_measurements + staging_attributes INSERT values).
 *
 * Taxonomy fields come from the `species` table directly — the app stores
 * SubspeciesName and SpeciesAuthority on the species row itself rather than
 * in a separate subspecies table. `IDLevel` and `SubspeciesAuthority` exist
 * but are no longer carried through staging because no destination stage
 * reads them after the pivot.
 *
 * `PrimaryStem` is hardcoded to `null` in this MVP; marker-code splitting is
 * deferred per the spec.
 *
 * Schema names are validated and qualified through `safeFormatQuery` (the
 * project-wide pattern). CensusID/PlotID are bound via `?` placeholder.
 *
 * Attribute rows are linked to their parent measurement by CoreMeasurementID
 * only — Stage 9 JOINs on that natural key, so we no longer compute the
 * brittle positional `TempMeasurementID`.
 */

import type { Connection } from 'mysql2/promise';
import type { MeasurementStagingRow, AttributeStagingRow } from '../csv-to-sql-shared';
import { exportableMeasurementSelect, exportableMeasurementBaseWhere } from './exportable-measurement';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SelectInput {
  schema: string;
  plotId: number;
  censusId: number;
}

export interface SelectResult {
  measurementRows: MeasurementStagingRow[];
  attributeRows: AttributeStagingRow[];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Query the app DB for a census's exportable measurements and their attribute
 * codes, returning rows shaped for `renderStage1` INSERT rendering.
 *
 * The exportable-measurement WHERE clause is shared with `checkFinishedCensus`
 * via `exportable-measurement.ts` to prevent drift between the precondition
 * filter and the export filter.
 *
 * Attribute rows are limited to codes that resolve to an active `attributes`
 * row (`IsActive = 1`). This mirrors precondition check 5's requirement that
 * all codes be resolvable before export is allowed.
 */
export async function selectMeasurements(conn: Connection, input: SelectInput): Promise<SelectResult> {
  // Query 1 — measurements with full taxonomy context.
  const measurementsSql = safeFormatQuery(
    input.schema,
    `${exportableMeasurementSelect(`
            cm.SourceRowIndex,
            t.TreeTag              AS Tag,
            s.StemTag,
            sp.SpeciesCode         AS Mnemonic,
            q.QuadratName,
            c.PlotCensusNumber,
            fam.Family,
            gn.Genus,
            sp.SpeciesName,
            sp.SpeciesAuthority,
            sp.SubspeciesName,
            cm.MeasuredDBH         AS DBH,
            cm.MeasuredHOM         AS HOM,
            cm.MeasurementDate     AS ExactDate,
            cm.Description         AS Comments,
            s.LocalX               AS LX,
            s.LocalY               AS LY`)}
       ORDER BY cm.CoreMeasurementID`
  );
  const [measurementsRaw] = await conn.query<any[]>(measurementsSql, [input.censusId, input.plotId]);

  const measurementRows: MeasurementStagingRow[] = measurementsRaw.map(r => ({
    CoreMeasurementID: Number(r.CoreMeasurementID),
    SourceRowIndex: r.SourceRowIndex == null ? null : Number(r.SourceRowIndex),
    Tag: String(r.Tag),
    StemTag: String(r.StemTag),
    Mnemonic: String(r.Mnemonic),
    QuadratName: String(r.QuadratName),
    PlotCensusNumber: String(r.PlotCensusNumber),
    Family: String(r.Family),
    Genus: String(r.Genus),
    SpeciesName: String(r.SpeciesName),
    SpeciesAuthority: r.SpeciesAuthority == null ? null : String(r.SpeciesAuthority),
    SubspeciesName: r.SubspeciesName == null ? null : String(r.SubspeciesName),
    DBH: r.DBH == null ? null : Number(r.DBH),
    HOM: r.HOM == null ? null : String(r.HOM),
    ExactDate: r.ExactDate instanceof Date ? r.ExactDate.toISOString().slice(0, 10) : String(r.ExactDate),
    Comments: r.Comments == null ? null : String(r.Comments),
    LX: r.LX == null ? null : Number(r.LX),
    LY: r.LY == null ? null : Number(r.LY),
    PrimaryStem: null
  }));

  const exportedCmids = new Set(measurementRows.map(m => m.CoreMeasurementID));

  // Query 2 — active attribute codes for the same exportable measurement set.
  const attributesSql = safeFormatQuery(
    input.schema,
    `SELECT cma.CoreMeasurementID,
            cma.Code AS TSMCode,
            cma.CMAID
       FROM ??.cmattributes cma
       JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = cma.CoreMeasurementID
       JOIN ??.census           c  ON c.CensusID           = cm.CensusID
       JOIN ??.stems            s  ON s.StemGUID            = cm.StemGUID
       JOIN ??.trees            t  ON t.TreeID              = s.TreeID
       JOIN ??.attributes       a  ON a.Code = cma.Code AND a.IsActive = 1
      WHERE ${exportableMeasurementBaseWhere}
      ORDER BY cma.CoreMeasurementID, cma.CMAID`
  );
  const [attrsRaw] = await conn.query<any[]>(attributesSql, [input.censusId, input.plotId]);

  // Guard against any edge-case where attribute query and measurement query
  // diverge — attributes are only kept when their parent measurement appears
  // in the exported set.
  const attributeRows: AttributeStagingRow[] = attrsRaw
    .filter(a => exportedCmids.has(Number(a.CoreMeasurementID)))
    .map(a => ({
      CoreMeasurementID: Number(a.CoreMeasurementID),
      TSMCode: String(a.TSMCode)
    }));

  return { measurementRows, attributeRows };
}
