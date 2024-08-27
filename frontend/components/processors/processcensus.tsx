import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import moment from 'moment';
import { createError, fetchPrimaryKey, handleUpsert } from '@/config/utils';
import { SpeciesResult, StemResult, TreeResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { QuadratsResult } from '@/config/sqlrdsdefinitions/zones';
import { CMAttributesResult, CoreMeasurementsResult } from '@/config/sqlrdsdefinitions/core';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<number | undefined> {
  const { connection, rowData, schema, plotID, censusID } = props;
  if (!plotID || !censusID) throw new Error('Process Census: Missing plotID, censusID, quadratID or full name');

  const { tag, stemtag, spcode, quadrat, lx, ly, coordinateunit, dbh, dbhunit, hom, homunit, date, codes } = rowData;

  try {
    await connection.beginTransaction();

    const speciesID = await fetchPrimaryKey<SpeciesResult>(schema, 'species', { SpeciesCode: spcode }, connection, 'SpeciesID');
    const quadratID = await fetchPrimaryKey<QuadratsResult>(
      schema,
      'quadrats',
      {
        QuadratName: quadrat,
        PlotID: plotID,
        CensusID: censusID
      },
      connection,
      'QuadratID'
    );
    // const subquadratID = subquadrat
    //   ? await fetchPrimaryKey<SubquadratResult, SubquadratRDS>(schema, 'subquadrats', { SubquadratName: subquadrat }, connection)
    //   : null;

    if (tag) {
      const treeID = await handleUpsert<TreeResult>(connection, schema, 'trees', { TreeTag: tag, SpeciesID: speciesID }, 'TreeID');

      if (stemtag && lx && ly) {
        const stemID = await handleUpsert<StemResult>(
          connection,
          schema,
          'stems',
          {
            StemTag: stemtag,
            TreeID: treeID,
            QuadratID: quadratID,
            LocalX: lx,
            LocalY: ly,
            CoordinateUnits: coordinateunit
          },
          'StemID'
        );

        if (dbh && hom && date) {
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

          if (codes) {
            const parsedCodes = codes
              .split(';')
              .map(code => code.trim())
              .filter(Boolean);
            for (const code of parsedCodes) {
              const attributeRows = await runQuery(connection, `SELECT COUNT(*) as count FROM ${schema}.attributes WHERE Code = ?`, [code]);
              if (!attributeRows || attributeRows.length === 0 || !attributeRows[0].count) {
                throw createError(`Attribute code ${code} not found or query failed.`, { code });
              }
              await handleUpsert<CMAttributesResult>(
                connection,
                schema,
                'cmattributes',
                {
                  CoreMeasurementID: coreMeasurementID,
                  Code: code
                },
                'CMAID'
              );
            }
          }
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
