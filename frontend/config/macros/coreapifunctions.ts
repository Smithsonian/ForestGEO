import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { getUpdatedValues } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';

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
        console.log('demapped old row: ', mappedOldRow);
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

        /*
        const fieldGroups = {
          coremeasurements: ['measuredDBH', 'measuredHOM', 'measurementDate'],
          quadrats: ['quadratName'],
          trees: ['treeTag'],
          stems: ['stemTag', 'stemLocalX', 'stemLocalY'],
          species: ['speciesName', 'subspeciesName', 'speciesCode']
        };

        // Initialize a flag for changes
        let changesFound = false;

        // Helper function to handle updates
        const handleUpdate = async (groupName: keyof typeof fieldGroups, tableName: string, idColumn: string, idValue: any) => {
          console.log('updating: ', groupName);
          const matchingFields = Object.keys(updatedFields).reduce(
            (acc, key) => {
              if (fieldGroups[groupName].includes(key)) {
                acc[key] = updatedFields[key];
              }
              return acc;
            },
            {} as Partial<typeof updatedFields>
          );

          if (Object.keys(matchingFields).length > 0) {
            changesFound = true;
            if (groupName === 'stems') {
              // need to correct for key matching
              if (matchingFields.stemLocalX) {
                matchingFields.localX = matchingFields.stemLocalX;
                delete matchingFields.stemLocalX;
              }
              if (matchingFields.stemLocalY) {
                matchingFields.localY = matchingFields.stemLocalY;
                delete matchingFields.stemLocalY;
              }
            }
            const demappedData = MapperFactory.getMapper<any, any>(groupName).demapData([matchingFields])[0];
            const query = format('UPDATE ?? SET ? WHERE ?? = ?', [`${schema}.${tableName}`, demappedData, idColumn, idValue]);
            await connectionManager.executeQuery(query);
          }
        };

        // Process each group
        await handleUpdate('coremeasurements', 'coremeasurements', 'CoreMeasurementID', coreMeasurementID);
        await handleUpdate('quadrats', 'quadrats', 'QuadratID', quadratID);
        await handleUpdate('trees', 'trees', 'TreeID', treeID);
        await handleUpdate('stems', 'stems', 'StemID', stemID);
        await handleUpdate('species', 'species', 'SpeciesID', speciesID);
          */

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

        if (dataType === 'failedmeasurements') {
          ({ Hash_ID: _ignored, ...failedTrimmed } = newRowData);
          failedTrimmed['FailureReasons'] = '';
        }

        // Use failedTrimmed for failedmeasurements, otherwise use remainingProperties
        const dataToUpdate = dataType === 'failedmeasurements' ? failedTrimmed : remainingProperties;

        const updateQuery = format(
          `UPDATE ??
           SET ?
           WHERE ?? = ?`,
          [`${schema}.${dataType}`, dataToUpdate, demappedGridID, gridIDKey]
        );

        // Execute the UPDATE query
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
