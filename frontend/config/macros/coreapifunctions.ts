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

export async function PATCH(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const { dataType, slugs } = await props.params;
  const [schema, gridID] = slugs ?? [];
  if (!schema || !gridID) throw new Error('no schema or gridID provided');

  const connectionManager = ConnectionManager.getInstance();
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow, oldRow } = await request.json();
  let updateIDs: Record<string, number> = {};
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    // Handle views with handleUpsertForSlices (applies to both insert and update logic)
    if (dataType === 'alltaxonomiesview') {
      let queryConfig;
      switch (dataType) {
        case 'alltaxonomiesview':
          queryConfig = AllTaxonomiesViewQueryConfig;
          break;
        default:
          throw new Error('Incorrect view call');
      }

      // Use handleUpsertForSlices for update operations as well (updates where needed)
      updateIDs = await handleUpsertForSlices(connectionManager, schema, { ...oldRow, ...newRow }, queryConfig);
    }

    // Handle non-view table updates
    else {
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
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, { TreeID: mappedUpdatedRow.TreeID }, 'StemID', mappedUpdatedRow.StemID])
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
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, { QuadratID: mappedUpdatedRow.QuadratID }, 'StemID', mappedUpdatedRow.StemID])
          );
        }

        if (updatedFields.StemTag) {
          changesFound = true;
          const stemSearchResults = await connectionManager.executeQuery(`SELECT StemID FROM ${schema}.stems WHERE StemTag = ? LIMIT 1`, [
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
            mappedUpdatedRow.StemID = stemResult.insertId;
          } else mappedUpdatedRow.StemID = stemSearchResults[0].StemID;
          if (updatedFields.StemLocalX || updatedFields.StemLocalY) {
            await connectionManager.executeQuery(
              format(`UPDATE ?? SET ? WHERE ?? = ?`, [
                `${schema}.stems`,
                {
                  LocalX: updatedFields.StemLocalX ?? mappedUpdatedRow.StemLocalX,
                  LocalY: updatedFields.StemLocalY ?? mappedUpdatedRow.StemLocalY
                },
                'StemID',
                mappedUpdatedRow.StemID
              ])
            );
          }
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              { StemID: mappedUpdatedRow.StemID },
              'CoreMeasurementID',
              mappedUpdatedRow.CoreMeasurementID
            ])
          );
        }

        if (updatedFields.MeasuredDBH || updatedFields.MeasuredHOM || updatedFields.MeasurementDate) {
          changesFound = true;
          await connectionManager.executeQuery(
            format(`UPDATE ?? SET ? WHERE ?? = ?`, [
              `${schema}.coremeasurements`,
              {
                MeasuredDBH: updatedFields.MeasuredDBH ?? mappedUpdatedRow.MeasuredDBH,
                MeasuredHOM: updatedFields.MeasuredHOM ?? mappedUpdatedRow.MeasuredHOM,
                MeasurementDate: updatedFields.MeasurementDate ?? mappedUpdatedRow.MeasurementDate
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
          // clear existing connections
          await connectionManager.executeQuery(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.cmattributes`, `CoreMeasurementID`, mappedOldRow.CoreMeasurementID]);
          if (parsedCodes.length === 0) {
            console.error('No valid attribute codes found:', updatedFields.Attributes);
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

        // Reset validation status and clear errors if changes were made
        if (changesFound) {
          const resetValidationQuery = format('UPDATE ?? SET ?? = ? WHERE ?? = ?', [
            `${schema}.coremeasurements`,
            'IsValidated',
            null,
            'CoreMeasurementID',
            mappedUpdatedRow.CoreMeasurementID
          ]);
          const deleteErrorsQuery = `DELETE FROM ${schema}.cmverrors WHERE CoreMeasurementID = ${mappedUpdatedRow.CoreMeasurementID}`;
          await connectionManager.executeQuery(resetValidationQuery);
          await connectionManager.executeQuery(deleteErrorsQuery);
        }
      } else {
        // special handling need not apply to non-measurements tables
        // failedmeasurements executed here
        const newRowData = MapperFactory.getMapper<any, any>(dataType).demapData([{ ...oldRow, ...newRow }])[0];
        const { [demappedGridID]: gridIDKey, ...remainingProperties } = newRowData;

        let failedTrimmed, _ignored;
        let plotTrimmed, _ignored2;
        let specTrimmed, _ignored3;
        let dataToUpdate;

        if (dataType === 'failedmeasurements') {
          ({ Hash_ID: _ignored, ...failedTrimmed } = newRowData);
          failedTrimmed['FailureReasons'] = '';
          dataToUpdate = failedTrimmed;
        } else if (dataType === 'plots') {
          ({ NumQuadrats: _ignored2, ...plotTrimmed } = newRowData);
          dataToUpdate = plotTrimmed;
        } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(dataType)) {
          ({ CensusID: _ignored2, ...specTrimmed } = newRowData);
          dataToUpdate = specTrimmed;
        } else dataToUpdate = remainingProperties;
        const updateQuery = format(
          `UPDATE ??
           SET ?
           WHERE ?? = ?`,
          [`${schema}.${dataType}`, dataToUpdate, demappedGridID, gridIDKey]
        );
        // set session var in case, connect to original transaction ID
        const censusID = parseInt((await getCookie('censusList')) ?? '0');
        await connectionManager.executeQuery(`SET @CURRENT_CENSUS_ID = ?`, [censusID]);
        await connectionManager.executeQuery(updateQuery);

        // For non-view tables, standardize the response format
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

    // Handle SQL views with handleUpsertForSlices
    if (params.dataType === 'alltaxonomiesview') {
      // systematic: add FAMILY, then GENUS, then SPECIES
      const { Family } = newRowData;
      const { Genus, GenusAuthority } = newRowData;
      const { SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, ValidCode, FieldFamily, Description } = newRowData;

      // family handler
      const { id: newFamilyID } = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family }, 'FamilyID');

      // genus handler
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

      // species handler
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
        const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]);
        await connectionManager.executeQuery(insertQuery);
      } else {
        const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData; // separate out PK
        const insertQuery = format(`INSERT INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
        await connectionManager.executeQuery(insertQuery);
      }
    } else {
      // Handle all other cases
      delete newRowData[demappedGridID];
      if (params.dataType === 'plots') delete newRowData.NumQuadrats;
      let insertQuery = '';
      if (params.dataType === 'failedmeasurements') insertQuery = format('INSERT IGNORE INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      else insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.${params.dataType}`, newRowData]);
      const results = await connectionManager.executeQuery(insertQuery);
      insertIDs = { [params.dataType]: results.insertId }; // Standardize output with table name as key
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
  const demappedGridID = gridID.charAt(0).toUpperCase() + gridID.substring(1);
  const { newRow } = await request.json();
  let transactionID: string | undefined = undefined;
  try {
    const storedCensusID = parseInt((await getCookie('censusID')) ?? '0');
    transactionID = await connectionManager.beginTransaction();

    // Handle deletion for tables
    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    // census-correlated tables need cleared first
    if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      await connectionManager.executeQuery(`DELETE FROM ${schema}.species WHERE SpeciesID = ? AND CensusID = ?`, [SpeciesID, storedCensusID]);
    } else if (params.dataType === 'measurementssummary') {
      // start with surrounding data
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmverrors WHERE ${demappedGridID} = ${gridIDKey}`);
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmattributes WHERE ${demappedGridID} = ${gridIDKey}`);
      // finally, perform core SOFT deletion
      await connectionManager.executeQuery(`DELETE FROM ${schema}.coremeasurements WHERE ${demappedGridID} = ${gridIDKey}`);
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
