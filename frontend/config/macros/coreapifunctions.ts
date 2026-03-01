import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { getUpdatedValues, handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { getCookie } from '@/app/actions/cookiemanager';
import { CMAttributesResult } from '@/config/sqlrdsdefinitions/core';
import ailogger from '@/ailogger';
import {
  INGESTION_ERROR_SOURCE,
  ensureMeasurementErrorDefinition,
  getIngestionErrorMessage,
  inferIngestionErrorCode,
  insertIngestionFailureRows,
  revalidateEditedFailedRow
} from '@/config/measurementerrors';

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

export async function PATCH(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const { dataType, slugs } = await props.params;
  const [schema, gridID] = slugs ?? [];
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const connectionManager = ConnectionManager.getInstance();
  // Get the primary key column name for this dataType, or fallback to capitalized gridID
  const primaryKeyColumn = PRIMARY_KEY_MAP[dataType] || gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const demappedGridID = primaryKeyColumn;
  const { newRow, oldRow } = await request.json();
  let updateIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    if (dataType === 'alltaxonomiesview') {
      let queryConfig;
      switch (dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      updateIDs = await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig);
    } else {
      if (dataType === 'measurementssummary') {
        const mappedOldRow = MapperFactory.getMapper<any, any>('measurementssummary').demapData([oldRow])[0];
        const mappedUpdatedRow = MapperFactory.getMapper<any, any>('measurementssummary').demapData([
          {
            ...Object.fromEntries(Object.entries(oldRow).filter(([, val]) => val !== undefined && val !== null)),
            ...Object.fromEntries(Object.entries(newRow).filter(([, val]) => val !== undefined && val !== null))
          }
        ])[0];
        let changesFound = false;
        const updatedFields = {
          ...Object.fromEntries(Object.entries(getUpdatedValues(mappedOldRow, mappedUpdatedRow)).filter(([, val]: any) => val !== undefined && val !== null))
        };
        if (updatedFields.SpeciesCode) {
          const speciesSearchResults = await connectionManager.executeQuery(`SELECT SpeciesID FROM ${schema}.species WHERE SpeciesCode = ? LIMIT 1`, [
            updatedFields.SpeciesCode
          ]);
          if (speciesSearchResults.length === 0) throw new Error('Species not found');
          mappedUpdatedRow.SpeciesID = speciesSearchResults[0].SpeciesID;
          if (updatedFields.SpeciesName || updatedFields.SubspeciesName) {
            changesFound = true;
            await connectionManager.executeQuery('UPDATE ?? SET ? WHERE SpeciesID = ?', [
              `${schema}.species`,
              {
                SpeciesName: updatedFields.SpeciesName ?? mappedUpdatedRow.SpeciesName,
                SubspeciesName: updatedFields.SubspeciesName ?? mappedUpdatedRow.SubspeciesName
              },
              mappedUpdatedRow.SpeciesID
            ]);
          }
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.trees`, { SpeciesID: mappedUpdatedRow.SpeciesID }, 'TreeID', mappedUpdatedRow.TreeID])
          );
        }
        if (updatedFields.TreeTag) {
          changesFound = true;
          const treeSearchResults = await connectionManager.executeQuery(`SELECT TreeID FROM ${schema}.trees WHERE TreeTag = ? LIMIT 1`, [
            updatedFields.TreeTag
          ]);
          if (treeSearchResults.length === 0) {
            const newTree = {
              TreeTag: updatedFields.TreeTag,
              SpeciesID: mappedUpdatedRow.SpeciesID
            };
            const treeInsertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.trees`, newTree]);
            const treeResult = await connectionManager.executeQuery(treeInsertQuery);
            mappedUpdatedRow.TreeID = treeResult.insertId;
          } else mappedUpdatedRow.TreeID = treeSearchResults[0].TreeID;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, { TreeID: mappedUpdatedRow.TreeID }, 'StemGUID', mappedUpdatedRow.StemGUID])
          );
        }

        if (updatedFields.QuadratName) {
          changesFound = true;
          const quadratSearchResults = await connectionManager.executeQuery(`SELECT QuadratID FROM ${schema}.quadrats WHERE QuadratName = ? LIMIT 1`, [
            updatedFields.QuadratName
          ]);
          if (quadratSearchResults.length === 0) throw new Error('Quadrat not found');
          mappedUpdatedRow.QuadratID = quadratSearchResults[0].QuadratID;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, { QuadratID: mappedUpdatedRow.QuadratID }, 'StemGUID', mappedUpdatedRow.StemGUID])
          );
        }

        if (updatedFields.StemTag) {
          changesFound = true;
          const stemSearchResults = await connectionManager.executeQuery(`SELECT StemGUID FROM ${schema}.stems WHERE StemTag = ? LIMIT 1`, [
            updatedFields.StemTag
          ]);
          if (stemSearchResults.length === 0) {
            const stemInsertQuery = format(`INSERT INTO ?? SET ?`, [
              `${schema}.stems`,
              {
                StemTag: updatedFields.StemTag,
                TreeID: mappedUpdatedRow.TreeID,
                QuadratID: mappedUpdatedRow.QuadratID,
                LocalX: updatedFields.StemLocalX ?? mappedUpdatedRow.StemLocalX,
                LocalY: updatedFields.StemLocalY ?? mappedUpdatedRow.StemLocalY
              }
            ]);
            const stemResult = await connectionManager.executeQuery(stemInsertQuery);
            mappedUpdatedRow.StemGUID = stemResult.insertId;
          } else mappedUpdatedRow.StemGUID = stemSearchResults[0].StemGUID;
          if (updatedFields.StemLocalX || updatedFields.StemLocalY) {
            await connectionManager.executeQuery(
              format(`UPDATE ?? SET ? WHERE ?? = ?`, [
                `${schema}.stems`,
                {
                  LocalX: updatedFields.StemLocalX ?? mappedUpdatedRow.StemLocalX,
                  LocalY: updatedFields.StemLocalY ?? mappedUpdatedRow.StemLocalY
                },
                'StemGUID',
                mappedUpdatedRow.StemGUID
              ])
            );
          }
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              { StemGUID: mappedUpdatedRow.StemGUID },
              'CoreMeasurementID',
              mappedUpdatedRow.CoreMeasurementID
            ])
          );
        }

        if (updatedFields.MeasuredDBH || updatedFields.MeasuredHOM || updatedFields.MeasurementDate) {
          changesFound = true;
          // Convert MeasurementDate from ISO format to MySQL format (YYYY-MM-DD) if needed
          let measurementDate = updatedFields.MeasurementDate ?? mappedUpdatedRow.MeasurementDate;
          if (measurementDate && typeof measurementDate === 'string' && measurementDate.includes('T')) {
            const date = new Date(measurementDate);
            if (!isNaN(date.getTime())) {
              measurementDate = date.toISOString().split('T')[0];
            }
          }
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              {
                MeasuredDBH: updatedFields.MeasuredDBH ?? mappedUpdatedRow.MeasuredDBH,
                MeasuredHOM: updatedFields.MeasuredHOM ?? mappedUpdatedRow.MeasuredHOM,
                MeasurementDate: measurementDate
              },
              'CoreMeasurementID',
              mappedUpdatedRow.CoreMeasurementID
            ])
          );
        }

        if (updatedFields.Attributes) {
          const parsedCodes = updatedFields.Attributes.split(';')
            .map((code: string) => code.trim())
            .filter(Boolean);
          await connectionManager.executeQuery(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.cmattributes`, `CoreMeasurementID`, mappedOldRow.CoreMeasurementID]);
          if (parsedCodes.length === 0) {
            ailogger.error('No valid attribute codes found:', updatedFields.Attributes);
          } else {
            for (const code of parsedCodes) {
              await handleUpsert<CMAttributesResult>(
                connectionManager,
                schema,
                'cmattributes',
                {
                  CoreMeasurementID: mappedOldRow.CoreMeasurementID,
                  Code: code
                },
                'CMAID'
              );
            }
          }
        }

        if (changesFound) {
          const deleteErrorsQuery = format(
            `DELETE mel
             FROM ??.measurement_error_log mel
             JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation'`,
            [schema, schema]
          );
          await connectionManager.executeQuery(deleteErrorsQuery, [mappedUpdatedRow.CoreMeasurementID]);

          const resetValidationQuery = format('UPDATE ?? SET ?? = ? WHERE ?? = ?', [
            `${schema}.coremeasurements`,
            'IsValidated',
            null,
            'CoreMeasurementID',
            mappedUpdatedRow.CoreMeasurementID
          ]);
          await connectionManager.executeQuery(resetValidationQuery);
        }
      } else {
        const newRowData = MapperFactory.getMapper<any, any>(dataType).demapData([{ ...oldRow, ...newRow }])[0];
        const { [demappedGridID]: gridIDKey, ...remainingProperties } = newRowData;

        let dataToUpdate;
        const censusID = parseInt((await getCookie('censusID')) ?? '0');

        if (dataType === 'failedmeasurements') {
          const { Hash_ID, ...failedTrimmed } = newRowData;
          if (failedTrimmed['CurrentFailureReasons'] == null && failedTrimmed['FailureReasons'] != null) {
            failedTrimmed['CurrentFailureReasons'] = failedTrimmed['FailureReasons'];
          }
          if (failedTrimmed['FailureReasons'] == null && failedTrimmed['CurrentFailureReasons'] != null) {
            failedTrimmed['FailureReasons'] = failedTrimmed['CurrentFailureReasons'];
          }
          failedTrimmed['LastValidatedAt'] = null;
          // Convert Date from ISO format to MySQL format (YYYY-MM-DD)
          if (failedTrimmed['Date']) {
            const date = new Date(failedTrimmed['Date']);
            if (!isNaN(date.getTime())) {
              // Format as YYYY-MM-DD for MySQL DATE column
              failedTrimmed['Date'] = date.toISOString().split('T')[0];
            }
          }
          const failedMeasurementID = Number(gridIDKey);
          const updateFailedQuery = format(
            `UPDATE ??.coremeasurements
             SET RawTreeTag = ?, RawStemTag = ?, RawSpCode = ?, RawQuadrat = ?,
                 RawX = ?, RawY = ?, MeasuredDBH = ?, MeasuredHOM = ?, MeasurementDate = ?,
                 RawCodes = ?, RawComments = ?, Description = ?, UploadFileID = COALESCE(?, UploadFileID),
                 UploadBatchID = COALESCE(?, UploadBatchID), IsValidated = FALSE
             WHERE CoreMeasurementID = ? AND StemGUID IS NULL`,
            [schema]
          );
          await connectionManager.executeQuery(updateFailedQuery, [
            failedTrimmed['Tag'] ?? null,
            failedTrimmed['StemTag'] ?? null,
            failedTrimmed['SpCode'] ?? null,
            failedTrimmed['Quadrat'] ?? null,
            failedTrimmed['X'] ?? null,
            failedTrimmed['Y'] ?? null,
            failedTrimmed['DBH'] ?? null,
            failedTrimmed['HOM'] ?? null,
            failedTrimmed['Date'] ?? null,
            failedTrimmed['Codes'] ?? null,
            failedTrimmed['Comments'] ?? null,
            failedTrimmed['Comments'] ?? null,
            failedTrimmed['FileID'] ?? null,
            failedTrimmed['BatchID'] ?? null,
            failedMeasurementID
          ]);

          // Clear all existing ingestion errors before revalidation
          const clearIngestionErrorQuery = format(
            `DELETE mel
             FROM ??.measurement_error_log mel
             JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = ? AND me.ErrorSource = ?`,
            [schema, schema]
          );
          await connectionManager.executeQuery(clearIngestionErrorQuery, [failedMeasurementID, INGESTION_ERROR_SOURCE]);

          // Revalidate ALL checks against the edited field values (not text-inferred)
          const validationErrors = await revalidateEditedFailedRow(
            connectionManager,
            schema,
            censusID,
            {
              Tag: failedTrimmed['Tag'],
              StemTag: failedTrimmed['StemTag'],
              SpCode: failedTrimmed['SpCode'],
              Quadrat: failedTrimmed['Quadrat'],
              X: failedTrimmed['X'],
              Y: failedTrimmed['Y'],
              DBH: failedTrimmed['DBH'],
              HOM: failedTrimmed['HOM'],
              Date: failedTrimmed['Date']
            },
            transactionID
          );

          // Insert ALL applicable error codes into the error log
          for (const { errorCode, errorMessage } of validationErrors) {
            const errorID = await ensureMeasurementErrorDefinition(
              connectionManager, schema, INGESTION_ERROR_SOURCE, errorCode, errorMessage, transactionID
            );
            const insertErrorLogQuery = format(
              'INSERT IGNORE INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, FALSE)',
              [schema]
            );
            await connectionManager.executeQuery(insertErrorLogQuery, [failedMeasurementID, errorID]);
          }

          // Update Description with concatenated current failure reasons
          if (validationErrors.length > 0) {
            const descriptionText = validationErrors.map(e => e.errorMessage).join('; ');
            const updateDescQuery = format('UPDATE ??.coremeasurements SET Description = ? WHERE CoreMeasurementID = ?', [schema]);
            await connectionManager.executeQuery(updateDescQuery, [descriptionText, failedMeasurementID], transactionID);
          }

          updateIDs = { [dataType]: failedMeasurementID };
          await connectionManager.commitTransaction(transactionID ?? '');
          return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
        } else if (dataType === 'plots') {
          const { NumQuadrats, ...plotTrimmed } = newRowData;
          dataToUpdate = plotTrimmed;
        } else if (['attributes', 'quadrats', 'species'].includes(dataType)) {
          const { CensusID, ...specTrimmed } = newRowData;
          dataToUpdate = specTrimmed;
        } else if (dataType === 'personnel') {
          const { CensusActive, ...personnelTrimmed } = newRowData;
          const query = CensusActive
            ? `INSERT IGNORE INTO ${schema}.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?);`
            : `DELETE FROM ${schema}.censusactivepersonnel WHERE CensusID = ? AND PersonnelID = ?`;
          await connectionManager.executeQuery(query, [censusID, gridIDKey]);
          dataToUpdate = personnelTrimmed;
        } else dataToUpdate = remainingProperties;

        const updateQuery = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${dataType}`, dataToUpdate, demappedGridID, gridIDKey]);
        await connectionManager.executeQuery(`SET @CURRENT_CENSUS_ID = ?`, [censusID]);
        await connectionManager.executeQuery(updateQuery);

        updateIDs = { [dataType]: gridIDKey };
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ message: 'Update successful', updatedIDs: updateIDs }, { status: HTTPResponses.OK });
  } catch (error: any) {
    return handleError(error, connectionManager, newRow, transactionID ?? undefined);
  } finally {
    await connectionManager.closeConnection();
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

      const { id: newFamilyID } = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family }, 'FamilyID');

      const { id: newGenusID } = await handleUpsert<GenusResult>(
        connectionManager,
        schema,
        'genus',
        {
          Genus,
          GenusAuthority,
          FamilyID: newFamilyID
        },
        'GenusID'
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
        'SpeciesID'
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
    const storedCensusID = parseInt((await getCookie('censusID')) ?? '0');
    transactionID = await connectionManager.beginTransaction();

    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      await connectionManager.executeQuery(`DELETE FROM ${schema}.species WHERE SpeciesID = ? AND CensusID = ?`, [SpeciesID, storedCensusID]);
    } else if (params.dataType === 'failedmeasurements') {
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
