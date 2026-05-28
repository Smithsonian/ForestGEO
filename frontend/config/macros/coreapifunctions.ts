import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { getCookie } from '@/app/actions/cookiemanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

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
  trees: 'TreeID',
  rolemapping: 'RoleMappingID',
  roles: 'RoleID',
  sites: 'SiteID'
};

const MEASUREMENT_PATCH_BLOCKED_DATATYPES = new Set(['measurementssummary', 'failedmeasurements']);

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

        // NOTE (deferred): handleUpsertForSlices does not accept a transaction id
        // and calls handleUpsert without threading one, so its writes run on
        // autocommit pool connections OUTSIDE this transaction. Migrating that
        // helper to a TxExecutor is out of scope for this fix; left as-is.
        return await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig);
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
      await tx.query(updateQuery);

      return { [dataType]: updatedGridIDKey };
    });

    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
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
  let insertIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    if (Object.keys(newRow).includes('isNew')) delete newRow.isNew;

    const newRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);

    if (params.dataType === 'alltaxonomiesview') {
      const { Family } = newRowData;
      const { Genus, GenusAuthority } = newRowData;
      const { SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, ValidCode, FieldFamily, Description } = newRowData;

      const { id: newFamilyID } = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family }, 'FamilyID', transactionID);

      const { id: newGenusID } = await handleUpsert<GenusResult>(
        connectionManager,
        schema,
        'genus',
        {
          Genus,
          GenusAuthority,
          FamilyID: newFamilyID
        },
        'GenusID',
        transactionID
      );

      await handleUpsert<SpeciesResult>(
        connectionManager,
        schema,
        'species',
        {
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
        },
        'SpeciesID',
        transactionID
      );
    } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(params.dataType)) {
      if (params.dataType === 'attributes') {
        await connectionManager.executeQuery(format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]));
      } else if (params.dataType === 'personnel') {
        await connectionManager.executeQuery(`INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [
          censusID ?? 0,
          newRowData.PersonnelID
        ]);
      } else {
        const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData;
        const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
        await connectionManager.executeQuery(insertQuery);
      }
    } else {
      delete newRowData[demappedGridID];
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      if (params.dataType === 'personnel') delete newRowData.CensusActive;

      let insertQuery = '';
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
          transactionID
        );
        insertIDs = { [params.dataType]: inserted[0] ?? 0 };
      } else {
        insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
        const results = await connectionManager.executeQuery(insertQuery);
        insertIDs = { [params.dataType]: results.insertId };
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Insert successful', createdIDs: insertIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
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
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();

    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      await connectionManager.executeQuery(`DELETE FROM ${schema}.species WHERE SpeciesID = ?`, [SpeciesID]);
    } else if (params.dataType === 'failedmeasurements') {
      // Measurement deletes bypass the edit_operations ledger: deletion is a
      // terminal operation, not a revertable edit, and the ledger's
      // single-row revert path cannot reconstruct a deleted coremeasurements
      // row from beforeState alone (stems/trees/cmattributes dependencies).
      // Audit trail for deletes lives in the uploadmetrics and database
      // binlog, not edit_operations.
      const deleteFailedQuery = format('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [schema]);
      await connectionManager.executeQuery(deleteFailedQuery, [gridIDKey]);
    } else if (params.dataType === 'measurementssummary') {
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE MeasurementID = ?', [`${schema}.measurement_error_log`]), [gridIDKey]);
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.cmattributes`, demappedGridID, gridIDKey]));
      await connectionManager.executeQuery(format('DELETE FROM ?? WHERE ?? = ?', [`${schema}.coremeasurements`, demappedGridID, gridIDKey]));
    } else {
      const softDelete = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(softDelete);
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Delete successful' }, { status: HTTPResponses.OK });
  } catch (error: any) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      await connectionManager.rollbackTransaction(transactionID ?? '');
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
  } finally {
    await connectionManager.closeConnection();
  }
}
