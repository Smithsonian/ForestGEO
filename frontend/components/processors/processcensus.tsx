import moment from 'moment';
import { createError, fetchPrimaryKey, handleUpsert } from '@/config/utils';
import { SpeciesResult, StemResult, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { QuadratResult } from '@/config/sqlrdsdefinitions/zones';
import { CMAttributesResult, CoreMeasurementsResult } from '@/config/sqlrdsdefinitions/core';
import { SpecialProcessingProps } from '@/config/macros';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<void> {
  const { connectionManager, rowData, schema, plot, census } = props;
  if (!plot || !census) {
    console.error('Missing required parameters: plotID or censusID');
    throw new Error('Process Census: Missing plotID or censusID');
  }
  const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes } = rowData;
  console.log('rowData: ', rowData);

  try {
    // Fetch species
    const speciesID = await fetchPrimaryKey<SpeciesResult>(schema, 'species', { SpeciesCode: spcode }, connectionManager, 'SpeciesID');
    console.log('found speciesID: ', speciesID);
    // Fetch quadrat
    const quadratID = await fetchPrimaryKey<QuadratResult>(schema, 'quadrats', { QuadratName: quadrat, PlotID: plot.plotID }, connectionManager, 'QuadratID');
    console.log('found quadratID: ', quadratID);

    if (tag) {
      const tagSearch: Partial<TreeResult> = {
        TreeTag: tag,
        SpeciesID: speciesID
      };
      // Handle Tree Upsert
      const { id: treeID, operation: treeOperation } = await handleUpsert<TreeResult>(connectionManager, schema, 'trees', tagSearch, 'TreeID');
      console.log('upsert performed against ', tagSearch, ' with result: ', treeID, ' and operation ', treeOperation);

      if (stemtag || lx || ly) {
        let stemStatus: 'new recruit' | 'multistem' | 'old tree';
        // Handle Stem Upsert
        const stemSearch: Partial<StemResult> = {
          StemTag: stemtag,
          TreeID: treeID,
          QuadratID: quadratID,
          LocalX: lx,
          LocalY: ly
        };
        const { id: stemID, operation: stemOperation } = await handleUpsert<StemResult>(connectionManager, schema, 'stems', stemSearch, 'StemID');
        console.log('upsert performed against ', stemSearch, ' with result: ', stemID, ' and operation ', stemOperation);

        if (stemOperation === 'inserted') {
          stemStatus = treeOperation === 'inserted' ? 'new recruit' : 'multistem';
        } else {
          stemStatus = 'old tree';
        }

        // Prepare additional fields for core measurements
        const userDefinedFields = JSON.stringify({
          treestemstate: { stem: stemOperation, tree: treeOperation, status: stemStatus }
        });

        // Handle Core Measurement Upsert
        const coreMeasurementSearch: Partial<CoreMeasurementsResult> = {
          CensusID: census.dateRanges[0].censusID,
          StemID: stemID,
          IsValidated: null,
          MeasurementDate: date && moment(date).isValid() ? moment.utc(date).format('YYYY-MM-DD') : null,
          MeasuredDBH: dbh ? parseFloat(dbh) : null,
          MeasuredHOM: hom ? parseFloat(hom) : null,
          Description: null,
          UserDefinedFields: userDefinedFields
        };
        const { id: coreMeasurementID } = await handleUpsert<CoreMeasurementsResult>(
          connectionManager,
          schema,
          'coremeasurements',
          coreMeasurementSearch,
          'CoreMeasurementID'
        );
        console.log('upsert performed against ', coreMeasurementSearch, ' with result: ', coreMeasurementID);

        // Handle CM Attributes Upsert
        if (codes) {
          const parsedCodes = codes
            .split(';')
            .map(code => code.trim())
            .filter(Boolean);
          if (parsedCodes.length === 0) {
            console.error('No valid attribute codes found:', codes);
          } else {
            for (const code of parsedCodes) {
              const attributeRows = await connectionManager.executeQuery(
                `SELECT COUNT(*) as count
                 FROM ${schema}.attributes
                 WHERE Code = ?`,
                [code]
              );
              if (!attributeRows || attributeRows.length === 0 || !attributeRows[0].count) {
                throw createError(`Attribute code ${code} not found or query failed.`, { code });
              }
              await handleUpsert<CMAttributesResult>(connectionManager, schema, 'cmattributes', { CoreMeasurementID: coreMeasurementID, Code: code }, 'CMAID');
            }
          }
        }
        // Update Census Start/End Dates
        // const combinedQuery = `
        //     UPDATE ${schema}.census c
        //     JOIN (
        //       SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
        //       FROM ${schema}.coremeasurements
        //       WHERE CensusID = ${censusID}
        //       GROUP BY CensusID
        //     ) m ON c.CensusID = m.CensusID
        //     SET c.StartDate = m.FirstMeasurementDate, c.EndDate = m.LastMeasurementDate
        //     WHERE c.CensusID = ${censusID};`;
        //
        // await connectionManager.executeQuery(combinedQuery);
        // console.log('Upsert successful. CoreMeasurement ID generated:', coreMeasurementID);
      }
    }
  } catch (error: any) {
    console.error('Rolling back changes! Upsert failed:', error.message);
    console.error('Storing row for return to user and proceeding...');
    throw error;
  }
}
