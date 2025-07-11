import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import MapperFactory from '@/config/datamapper';
import { getUpdatedValues, handleUpsert } from '@/config/utils';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { handleError } from '@/utils/errorhandler';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { CensusSpeciesResult } from '@/config/sqlrdsdefinitions/zones';

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
        let plotTrimmed, _ignored2;
        let dataToUpdate;

        if (dataType === 'failedmeasurements') {
          ({ Hash_ID: _ignored, ...failedTrimmed } = newRowData);
          failedTrimmed['FailureReasons'] = '';
          dataToUpdate = failedTrimmed;
        } else if (dataType === 'plots') {
          ({ NumQuadrats: _ignored2, ...plotTrimmed } = newRowData);
          dataToUpdate = plotTrimmed;
        } else dataToUpdate = remainingProperties;

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
      const { id: newSpeciesID } = await handleUpsert<SpeciesResult>(
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

      // associate with census:
      await handleUpsert<CensusSpeciesResult>(
        connectionManager,
        schema,
        'censusspecies',
        {
          CensusID: censusID,
          SpeciesID: newSpeciesID
        },
        'CSID'
      );
    } else if (['attributes', 'quadrats', 'personnel', 'species'].includes(params.dataType)) {
      if (params.dataType === 'attributes') {
        const insertQuery = format(`INSERT IGNORE INTO ?? SET ?`, [`${schema}.${params.dataType}`, newRowData]);
        await connectionManager.executeQuery(insertQuery);
        const caQuery = format(`INSERT IGNORE INTO ?? SET ?`, [
          `${schema}.${params.dataType}`,
          {
            CensusID: censusID,
            [demappedGridID]: newRowData[demappedGridID]
          }
        ]);
        const results = await connectionManager.executeQuery(caQuery);
        if (results.length === 0) throw new Error('Error inserting into censusattribute');
      } else {
        const { [demappedGridID]: demappedIDValue, ...remaining } = newRowData; // separate out PK
        const insertQuery = format(`INSERT IGNORE INTO ?? SET ?`, [`${schema}.${params.dataType}`, remaining]);
        const results = await connectionManager.executeQuery(insertQuery);
        insertIDs = { [params.dataType]: results.insertId }; // Standardize output with table name as key
        const cqQuery = format(`INSERT IGNORE INTO ?? SET ?`, [
          `${schema}.census${params.dataType}`,
          {
            CensusID: censusID,
            [demappedGridID]: insertIDs[params.dataType]
          }
        ]);
        const cqResults = await connectionManager.executeQuery(cqQuery);
        if (cqResults.length === 0) throw new Error(`Error inserting into census junction table for ${params.dataType}`);
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
    transactionID = await connectionManager.beginTransaction();

    // Handle deletion for tables
    const deleteRowData = MapperFactory.getMapper<any, any>(params.dataType).demapData([newRow])[0];
    const { [demappedGridID]: gridIDKey } = deleteRowData;
    // census-correlated tables need cleared first
    if (['attributes', 'quadrats', 'species', 'personnel'].includes(params.dataType)) {
      const qDeleteQuery = format(`DELETE FROM ?? WHERE ?? = ?`, [`${schema}.census${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(qDeleteQuery);
      const softDelete = format(`UPDATE ?? SET IsActive = FALSE WHERE ?? = ?`, [`${schema}.${params.dataType}`, demappedGridID, gridIDKey]);
      await connectionManager.executeQuery(softDelete);
    } else if (params.dataType === 'alltaxonomiesview') {
      const { SpeciesID } = deleteRowData;
      const softDelete = format(`UPDATE ?? SET IsActive = FALSE WHERE ?? = ?`, [`${schema}.${params.dataType}`, 'SpeciesID', SpeciesID]);
      await connectionManager.executeQuery(softDelete);
    } else if (params.dataType === 'measurementssummary') {
      // start with surrounding data
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmverrors WHERE ${demappedGridID} = ${gridIDKey}`);
      await connectionManager.executeQuery(`DELETE FROM ${schema}.cmattributes WHERE ${demappedGridID} = ${gridIDKey}`);
      // finally, perform core SOFT deletion
      await connectionManager.executeQuery(`UPDATE ${schema}.coremeasurements SET IsActive = FALSE WHERE ${demappedGridID} = ${gridIDKey}`);
    } else {
      const softDelete = format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.${params.dataType}`, { IsActive: false }, demappedGridID, gridIDKey]);
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
