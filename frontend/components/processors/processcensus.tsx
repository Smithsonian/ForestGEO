import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import moment from 'moment';
import { createError, fetchPrimaryKey, handleUpsert } from '@/config/utils';
import { SpeciesResult, StemResult, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { QuadratsResult } from '@/config/sqlrdsdefinitions/zones';
import { CMAttributesResult, CoreMeasurementsResult } from '@/config/sqlrdsdefinitions/core';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<number | undefined> {
  const { connection, rowData, schema, plotID, censusID } = props;
  if (!plotID || !censusID) {
    console.error('Missing required parameters: plotID or censusID');
    throw new Error('Process Census: Missing plotID or censusID');
  }

  const { tag, stemtag, spcode, quadrat, lx, ly, coordinateunit, dbh, dbhunit, hom, homunit, date, codes } = rowData;

  try {
    await connection.beginTransaction();

    // Fetch species
    const speciesID = await fetchPrimaryKey<SpeciesResult>(schema, 'species', { SpeciesCode: spcode }, connection, 'SpeciesID');

    // Fetch quadrat
    const quadratID = await fetchPrimaryKey<QuadratsResult>(schema, 'quadrats', { QuadratName: quadrat, PlotID: plotID }, connection, 'QuadratID');

    if (tag) {
      // Handle Tree Upsert
      const treeID = await handleUpsert<TreeResult>(connection, schema, 'trees', { TreeTag: tag, SpeciesID: speciesID }, 'TreeID');

      if (stemtag && lx && ly) {
        console.log('Processing stem with StemTag:', stemtag);
        // Handle Stem Upsert
        const stemID = await handleUpsert<StemResult>(
          connection,
          schema,
          'stems',
          { StemTag: stemtag, TreeID: treeID, QuadratID: quadratID, LocalX: lx, LocalY: ly, CoordinateUnits: coordinateunit },
          'StemID'
        );

        if (dbh && hom && date) {
          // Handle Core Measurement Upsert
          const coreMeasurementID = await handleUpsert<CoreMeasurementsResult>(
            connection,
            schema,
            'coremeasurements',
            {
              CensusID: censusID,
              StemID: stemID,
              IsValidated: null,
              MeasurementDate: moment(date).format('YYYY-MM-DD'),
              MeasuredDBH: dbh,
              DBHUnit: dbhunit,
              MeasuredHOM: hom,
              HOMUnit: homunit
            },
            'CoreMeasurementID'
          );

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
                const attributeRows = await runQuery(connection, `SELECT COUNT(*) as count FROM ${schema}.attributes WHERE Code = ?`, [code]);
                if (!attributeRows || attributeRows.length === 0 || !attributeRows[0].count) {
                  throw createError(`Attribute code ${code} not found or query failed.`, { code });
                }
                await handleUpsert<CMAttributesResult>(connection, schema, 'cmattributes', { CoreMeasurementID: coreMeasurementID, Code: code }, 'CMAID');
              }
            }
          }

          // Update Census Start/End Dates
          const combinedQuery = `
            UPDATE ${schema}.census c
            JOIN (
              SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
              FROM ${schema}.coremeasurements
              WHERE CensusID = ${censusID} 
              GROUP BY CensusID
            ) m ON c.CensusID = m.CensusID
            SET c.StartDate = m.FirstMeasurementDate, c.EndDate = m.LastMeasurementDate
            WHERE c.CensusID = ${censusID};`;

          await runQuery(connection, combinedQuery);
          await connection.commit();
          console.log('Upsert successful. CoreMeasurement ID generated:', coreMeasurementID);
          return coreMeasurementID;
        }
      }
    }
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw error;
  }
}
