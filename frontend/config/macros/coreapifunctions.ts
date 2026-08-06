import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/lib/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/lib/db/definitions/taxonomies';
import { getCookie } from '@/app/actions/cookiemanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { auth } from '@/auth';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { ChangelogOperation, recordMutation } from '@/lib/changelog/record-mutation';
import { safeEscapeId, safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { TxExecutor } from '@/lib/db/connectionmanager';

// Mapping from dataType to primary key column name
const PRIMARY_KEY_MAP: Record<string, string> = {
  failedmeasurements: 'FailedMeasurementID',
  coremeasurements: 'CoreMeasurementID',
  attributes: 'Code',
  census: 'CensusID',
  cmattributes: 'CMAID',
  family: 'FamilyID',
  genus: 'GenusID',
  personnel: 'PersonnelID',
  plots: 'PlotID',
  quadrats: 'QuadratID',
  species: 'SpeciesID',
  stems: 'StemGUID',
  stemtaxonomiesview: 'StemGUID',
  trees: 'TreeID',
  rolemapping: 'RoleMappingID',
  roles: 'RoleID',
  sites: 'SiteID'
};

const MEASUREMENT_PATCH_BLOCKED_DATATYPES = new Set(['measurementssummary', 'failedmeasurements']);

/**
 * Resolves the changelog's PlotID scope from the row itself. Most tables the
 * grids mutate carry a PlotID column; for `plots` it is the record's own key.
 * Tables without one (attributes, personnel, family, genus, roles, sites) get
 * NULL — recordMutation normalizes a missing/zero id rather than inventing a
 * plot the change did not belong to.
 */
function changelogPlotID(rowData: Record<string, unknown> | undefined): number | null {
  const value = rowData?.PlotID;
  return value === undefined || value === null ? null : Number(value);
}

/**
 * One created row awaiting its changelog entry. A POST branch knows which table
 * it wrote, but only learns the RecordID after the insert returns, so the audit
 * write is deferred to the end of the same transaction.
 */
interface CreatedRowAudit {
  /** The table actually written — not the view or dataType the request named. */
  tableName: string;
  recordID: string | number;
  rowState: Record<string, unknown>;
}

/** handleUpsert's report that it created the row rather than overwriting one. */
const UPSERT_INSERTED = 'inserted';

/**
 * Records one slice of an `alltaxonomiesview` write against its real table.
 * The view spans family, genus and species; a family edit filed under the view's
 * name is the same invisibility this audit exists to remove.
 *
 * An upsert overwrites the row before anything can read it, so an UPDATE here
 * carries no prior state — see recordMutation's oldRowState contract.
 */
async function recordTaxonomySliceUpsert(
  tx: TxExecutor,
  schema: string,
  slice: { sliceKey: string; id: number; operation?: string; rowData: Record<string, unknown> },
  changedBy: string
): Promise<void> {
  const shared = { tx, schema, tableName: slice.sliceKey, recordID: slice.id, changedBy, plotID: null, censusID: null };
  await recordMutation(
    slice.operation === UPSERT_INSERTED
      ? { ...shared, operation: ChangelogOperation.INSERT, newRowState: slice.rowData }
      : { ...shared, operation: ChangelogOperation.UPDATE, oldRowState: null, newRowState: slice.rowData }
  );
}

/** One removed row awaiting its changelog entry. */
interface DeletedRowAudit {
  /** The table actually emptied — not the view or dataType the request named. */
  tableName: string;
  recordID: string;
  rowState: Record<string, unknown>;
}

const FAILED_MEASUREMENT_PREDICATE = 'StemGUID IS NULL';

/**
 * Reads the rows a DELETE is about to remove, so the changelog records their
 * real prior state rather than the client's payload. The grid sends only the row
 * the user was looking at; for the dependent tables a measurement delete also
 * clears, it describes nothing at all. Selecting first also means a delete that
 * matches no row logs nothing, instead of asserting a removal that never
 * happened.
 *
 * Runs on the mutation's own connection, so it observes the transaction's view.
 */
async function captureRowsForDeletion(
  tx: TxExecutor,
  schema: string,
  tableName: string,
  keyColumn: string,
  keyValue: unknown,
  options: { recordIDColumns?: string[]; extraPredicate?: string } = {}
): Promise<DeletedRowAudit[]> {
  const { recordIDColumns = [keyColumn], extraPredicate } = options;
  const predicate = `${safeEscapeId(keyColumn)} = ?${extraPredicate ? ` AND ${extraPredicate}` : ''}`;
  const selectSQL = safeFormatQuery(schema, `SELECT * FROM ??.${safeEscapeId(tableName)} WHERE ${predicate}`);
  const rows: Record<string, unknown>[] = await tx.query(selectSQL, [keyValue]);

  return rows.map(row => ({
    tableName,
    // Composite keys (measurement_error_log is keyed on MeasurementID+ErrorID)
    // are joined so one changelog row still identifies exactly one table row.
    recordID: recordIDColumns.map(column => String(row[column])).join('-'),
    rowState: row
  }));
}

/**
 * A DELETE handler has no census in scope, so the changelog takes the census the
 * removed row itself belonged to. Tables without the column record NULL.
 */
function changelogCensusID(rowData: Record<string, unknown> | undefined): number | null {
  const value = rowData?.CensusID;
  return value === undefined || value === null ? null : Number(value);
}

/**
 * `withRouteAuthz` has already resolved and validated the session by the time a
 * handler runs, but its Handler type does not pass the session through. Reading
 * it again here costs one extra `auth()` per mutating request; widening the
 * Handler type would instead touch every wrapped route in the app.
 */
async function changelogChangedBy(): Promise<string> {
  return authenticatedSessionIdentity((await auth())?.user);
}

/**
 * Raised when a PATCH UPDATE matches/changes no row, so the mutation cannot be
 * reported as a success. Carries the HTTP status the route should surface,
 * mirroring the ArcgisImportSessionError pattern in lib/arcgis/import-session.ts.
 */
class RowNotFoundError extends Error {
  readonly status: HTTPResponses;

  constructor(message: string) {
    super(message);
    this.name = 'RowNotFoundError';
    this.status = HTTPResponses.NOT_FOUND;
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const { dataType, slugs } = await props.params;
  const [schema, gridID] = slugs ?? [];
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  // Measurement editing is handled exclusively by POST /api/edits/preview +
  // POST /api/edits/apply. The legacy PATCH path is rejected at the public
  // boundary so the preview/drift/ledger contract can't be bypassed by a
  // crafted request. If an internal call site ever needs to skip preview,
  // it must invoke config/editplan/apply::applyEditInTransaction directly —
  // never through this route.
  if (MEASUREMENT_PATCH_BLOCKED_DATATYPES.has(dataType)) {
    return NextResponse.json(
      {
        error: 'measurement edits must go through /api/edits/preview and /api/edits/apply'
      },
      { status: HTTPResponses.METHOD_NOT_ALLOWED }
    );
  }

  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow, oldRow } = await request.json();

  try {
    // Resolved before the transaction opens so the auth round-trip never holds a
    // pooled connection.
    const changedBy = await changelogChangedBy();

    const updateIDs = await connectionManager.withTransaction(async tx => {
      if (dataType === 'alltaxonomiesview') {
        let queryConfig;
        switch (dataType) {
          case 'alltaxonomiesview':
            queryConfig = AllTaxonomiesViewQueryConfig;
            break;
          default:
            throw new Error('Incorrect view call');
        }

        return await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig, tx.id, async slice =>
          recordTaxonomySliceUpsert(tx, schema, slice as Parameters<typeof recordTaxonomySliceUpsert>[2], changedBy)
        );
      }

      const mapper = MapperFactory.getMapper<any, any>(dataType);
      const oldRowData = mapper.demapData([oldRow])[0];
      const newRowData = mapper.demapData([{ ...oldRow, ...newRow }])[0];
      const previousGridIDKey = oldRowData?.[demappedGridID];
      const { [demappedGridID]: updatedGridIDKey, ...remainingProperties } = newRowData;

      let dataToUpdate;
      const censusID = parseInt((await getCookie('censusID')) ?? '0');

      if (dataType === 'plots') {
        const { NumQuadrats, ...plotTrimmed } = newRowData;
        dataToUpdate = plotTrimmed;
      } else if (dataType === 'attributes') {
        dataToUpdate = {
          [demappedGridID]: updatedGridIDKey,
          ...remainingProperties
        };
      } else if (['quadrats', 'species'].includes(dataType)) {
        const { CensusID, ...specTrimmed } = newRowData;
        dataToUpdate = specTrimmed;
      } else if (dataType === 'personnel') {
        const { CensusActive, ...personnelTrimmed } = newRowData;
        const hasCensusActiveFlag =
          Object.prototype.hasOwnProperty.call(oldRowData ?? {}, 'CensusActive') || Object.prototype.hasOwnProperty.call(newRowData, 'CensusActive');
        if (hasCensusActiveFlag) {
          if (!Number.isInteger(censusID) || censusID <= 0) {
            throw new Error('Census context required to update personnel census activity');
          }
          const query = CensusActive
            ? `INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?);`
            : `DELETE FROM ${schema}.censusactivepersonnel WHERE CensusID = ? AND PersonnelID = ?`;
          await tx.query(query, [censusID, previousGridIDKey]);
        }
        dataToUpdate = personnelTrimmed;
      } else dataToUpdate = remainingProperties;

      const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${dataType}`, dataToUpdate, demappedGridID, previousGridIDKey]);
      // Must run on the same connection as the UPDATE so the changelog trigger
      // reads the session variable this statement sets — hence tx.query, not a
      // fresh pool connection.
      await tx.query(`SET @CURRENT_CENSUS_ID = ?`, [censusID]);
      const updateResult = await tx.query(updateQuery);

      // A zero-row UPDATE must never be reported as success. The pool uses mysql2's
      // default connection flags, which include FOUND_ROWS (connection_config.js
      // getDefaultFlags) and are not overridden in poolmonitorsingleton, so
      // affectedRows counts MATCHED rows: a matched-but-unchanged re-save reports
      // affectedRows >= 1, and affectedRows === 0 uniquely means the target row
      // does not exist. Throwing here rolls the transaction back (undoing any
      // earlier write in this handler, e.g. the personnel censusactivepersonnel
      // row) and surfaces NOT_FOUND, so a stale-key edit can never be reported as
      // a successful persist.
      const affectedRows = (updateResult as { affectedRows?: number })?.affectedRows ?? 0;
      if (affectedRows === 0) {
        throw new RowNotFoundError(`No ${dataType} row found for ${demappedGridID}=${previousGridIDKey}`);
      }

      // Logged only after the zero-row guard, so a stale-key edit that throws
      // RowNotFoundError records nothing. The write shares tx, so the log entry
      // and the UPDATE commit or roll back together.
      await recordMutation({
        tx,
        schema,
        tableName: dataType,
        recordID: previousGridIDKey,
        operation: ChangelogOperation.UPDATE,
        oldRowState: oldRowData ?? {},
        newRowState: newRowData,
        changedBy,
        plotID: changelogPlotID(newRowData),
        censusID
      });

      return { [dataType]: updatedGridIDKey };
    });

    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    // A zero-row UPDATE must not report success: surface the NOT_FOUND status the
    // error carries instead of the generic 500 handleError would produce. Use the
    // `message` key so the grid consumer (isolateddatagridcommons reads
    // responseJSON.message) shows the specific not-found reason, consistent with
    // this handler's success and handleError responses.
    if (error instanceof RowNotFoundError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    // withTransaction has already rolled back on throw; pass no transactionID so
    // handleError only formats the response and does not attempt a second
    // rollback (which would log against an already-released connection).
    return handleError(error, connectionManager, newRow);
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID, _plotIDParam, censusIDParam] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;

  const connectionManager = ConnectionManager.getInstance();
  const { newRow } = await request.json();
  try {
    const changedBy = await changelogChangedBy();

    const insertIDs = await connectionManager.withTransaction(async tx => {
      const createdIDs: Record<string, number> = {};
      // Collected per branch and written once below, because each branch knows a
      // different table and only learns the RecordID after its own insert.
      const createdRows: CreatedRowAudit[] = [];

      if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;

      const newRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
      const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

      if (params.dataType === 'alltaxonomiesview') {
        const { Family } = newRowData;
        const { Genus, GenusAuthority } = newRowData;
        const { SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, ValidCode, FieldFamily, Description } = newRowData;

        // handleUpsert still takes a string transactionID; threading tx.id keeps
        // these upserts on the same tx connection as the rest of this handler.
        const familyRow = { Family };
        const { id: newFamilyID, operation: familyOperation } = await handleUpsert<FamilyResult>(
          connectionManager,
          schema,
          'family',
          familyRow,
          'FamilyID',
          tx.id
        );

        const genusRow = { Genus, GenusAuthority, FamilyID: newFamilyID };
        const { id: newGenusID, operation: genusOperation } = await handleUpsert<GenusResult>(connectionManager, schema, 'genus', genusRow, 'GenusID', tx.id);

        const speciesRow = {
          GenusID: newGenusID,
          SpeciesCode,
          SpeciesName,
          SubspeciesName,
          IDLevel,
          SpeciesAuthority,
          SubspeciesAuthority,
          ValidCode,
          FieldFamily,
          Description
        };
        // The species upsert's result used to be discarded, leaving no id to log.
        const { id: newSpeciesID, operation: speciesOperation } = await handleUpsert<SpeciesResult>(
          connectionManager,
          schema,
          'species',
          speciesRow,
          'SpeciesID',
          tx.id
        );

        // Three rows, one per real table — see recordTaxonomySliceUpsert.
        for (const slice of [
          { sliceKey: 'family', id: newFamilyID, operation: familyOperation, rowData: familyRow },
          { sliceKey: 'genus', id: newGenusID, operation: genusOperation, rowData: genusRow },
          { sliceKey: 'species', id: newSpeciesID, operation: speciesOperation, rowData: speciesRow }
        ]) {
          await recordTaxonomySliceUpsert(tx, schema, slice, changedBy);
        }
      } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(params.dataType)) {
        if (params.dataType === 'attributes') {
          await tx.query(format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]));
          // `attributes` keys on Code, so there is no insert id to read back.
          createdRows.push({ tableName: params.dataType, recordID: newRowData.Code, rowState: newRowData });
        } else if (params.dataType === 'personnel') {
          const censusActiveRow = { CensusID: censusID ?? 0, PersonnelID: newRowData.PersonnelID };
          await tx.query(`INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [censusID ?? 0, newRowData.PersonnelID]);
          // This branch creates no `personnel` row — it only links an existing
          // person to a census. Logging it as a personnel INSERT would assert a
          // person was created who wasn't.
          createdRows.push({
            tableName: 'censusactivepersonnel',
            recordID: newRowData.PersonnelID,
            rowState: censusActiveRow
          });
        } else {
          const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData;
          const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
          const results = await tx.query(insertQuery);
          createdRows.push({
            tableName: params.dataType,
            recordID: results.insertId,
            rowState: { ...remaining, [demappedGridID]: results.insertId }
          });
        }
      } else {
        delete newRowData[demappedGridID];
        if (params.dataType === 'plots') delete newRowData.NumQuadrats;
        if (params.dataType === 'personnel') delete newRowData.CensusActive;

        if (params.dataType === 'failedmeasurements') {
          const inserted = await insertIngestionFailureRows(
            connectionManager,
            schema,
            [
              {
                plotID: Number(newRowData.PlotID ?? 0),
                censusID: Number(newRowData.CensusID ?? censusID ?? 0),
                tag: newRowData.Tag ?? null,
                stemTag: newRowData.StemTag ?? null,
                spCode: newRowData.SpCode ?? null,
                quadrat: newRowData.Quadrat ?? null,
                x: newRowData.X ?? null,
                y: newRowData.Y ?? null,
                dbh: newRowData.DBH ?? null,
                hom: newRowData.HOM ?? null,
                date: newRowData.Date ?? null,
                codes: newRowData.Codes ?? null,
                comments: newRowData.Comments ?? null,
                failureReason: newRowData.FailureReasons ?? null,
                fileID: newRowData.FileID ?? null,
                batchID: newRowData.BatchID ?? null,
                sourceRowIndex: newRowData.SourceRowIndex ?? null
              }
            ],
            tx.id
          );
          createdIDs[params.dataType] = inserted[0] ?? 0;
          // insertIngestionFailureRows writes a coremeasurements row with a NULL
          // StemGUID; `failedmeasurements` is a view over those, not a table.
          createdRows.push({
            tableName: 'coremeasurements',
            recordID: createdIDs[params.dataType],
            rowState: newRowData
          });
        } else {
          const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
          const results = await tx.query(insertQuery);
          createdIDs[params.dataType] = results.insertId;
          createdRows.push({
            tableName: params.dataType,
            recordID: results.insertId,
            rowState: { ...newRowData, [demappedGridID]: results.insertId }
          });
        }
      }

      for (const created of createdRows) {
        await recordMutation({
          tx,
          schema,
          tableName: created.tableName,
          recordID: created.recordID,
          operation: ChangelogOperation.INSERT,
          newRowState: created.rowState,
          changedBy,
          plotID: changelogPlotID(created.rowState),
          censusID: censusID ?? null
        });
      }

      return createdIDs;
    });

    return NextResponse.json({ message: 'Insert successful', createdIDs: insertIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    // withTransaction has already rolled back on throw; pass no transactionID so
    // handleError only formats the response and does not attempt a second
    // rollback (same change Task 5 made for PATCH).
    return handleError(error, connectionManager, newRow);
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, gridID] = params.slugs;
  if (!schema || !gridID) throw new Error('no schema or gridID provided');
  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[params.dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow } = await request.json();
  try {
    const changedBy = await changelogChangedBy();

    await connectionManager.withTransaction(async tx => {
      const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
      const { [demappedGridID]: gridIDKey } = deleteRowData;
      // Captured before each DELETE runs; a removed row cannot be read back.
      const removedRows: DeletedRowAudit[] = [];

      if (params.dataType === 'alltaxonomiesview') {
        const { SpeciesID } = deleteRowData;
        removedRows.push(...(await captureRowsForDeletion(tx, schema, 'species', 'SpeciesID', SpeciesID)));
        await tx.query(`DELETE FROM ${schema}.species WHERE SpeciesID = ?`, [SpeciesID]);
      } else if (params.dataType === 'failedmeasurements') {
        // Measurement deletes bypass the edit_operations ledger: deletion is a
        // terminal operation, not a revertable edit, and the ledger's
        // single-row revert path cannot reconstruct a deleted coremeasurements
        // row from beforeState alone (stems/trees/cmattributes dependencies).
        // Because that makes them terminal AND unrecorded, they are logged to
        // unifiedchangelog here — against coremeasurements, the table this
        // actually empties.
        removedRows.push(
          ...(await captureRowsForDeletion(tx, schema, 'coremeasurements', 'CoreMeasurementID', gridIDKey, {
            extraPredicate: FAILED_MEASUREMENT_PREDICATE
          }))
        );
        const deleteFailedQuery = format('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [schema]);
        await tx.query(deleteFailedQuery, [gridIDKey]);
      } else if (params.dataType === 'measurementssummary') {
        // Three tables are emptied, so three sets of changelog rows: naming them
        // all `measurementssummary` would hide which table lost what.
        removedRows.push(
          ...(await captureRowsForDeletion(tx, schema, 'measurement_error_log', 'MeasurementID', gridIDKey, {
            recordIDColumns: ['MeasurementID', 'ErrorID']
          }))
        );
        await tx.query(format('DELETE FROM ?? WHERE MeasurementID = ?', [`${schema}.measurement_error_log`]), [gridIDKey]);

        removedRows.push(...(await captureRowsForDeletion(tx, schema, 'cmattributes', demappedGridID, gridIDKey, { recordIDColumns: ['CMAID'] })));
        await tx.query(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.cmattributes`, demappedGridID, gridIDKey]));

        removedRows.push(...(await captureRowsForDeletion(tx, schema, 'coremeasurements', demappedGridID, gridIDKey)));
        await tx.query(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.coremeasurements`, demappedGridID, gridIDKey]));
      } else {
        removedRows.push(...(await captureRowsForDeletion(tx, schema, params.dataType, demappedGridID, gridIDKey)));
        const softDelete = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
        await tx.query(softDelete);
      }

      for (const removed of removedRows) {
        await recordMutation({
          tx,
          schema,
          tableName: removed.tableName,
          recordID: removed.recordID,
          operation: ChangelogOperation.DELETE,
          // The request field is called `newRow`, but semantically it is the row
          // being removed — it belongs in OldRowState, with no new state at all.
          oldRowState: removed.rowState,
          changedBy,
          plotID: changelogPlotID(removed.rowState),
          censusID: changelogCensusID(removed.rowState)
        });
      }
    });
    return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
  } catch (error: any) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      // withTransaction has already rolled back; no manual rollback here.
      const referencingTableMatch = error.message.match(/CONSTRAINT `(.*?)` FOREIGN KEY \(`(.*?)`\) REFERENCES `(.*?)`/);
      const referencingTable = referencingTableMatch ? referencingTableMatch[3] : 'unknown';
      return NextResponse.json(
        {
          message: 'Foreign key conflict detected',
          referencingTable
        },
        { status: HTTPResponses.FOREIGN_KEY_CONFLICT }
      );
    } else return handleError(error, connectionManager, newRow);
  }
}
