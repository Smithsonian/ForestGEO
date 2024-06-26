import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import { getPersonnelIDByName } from './processorhelperfunctions';
import moment from 'moment';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<number | undefined> {
  const { connection, rowData, schema, plotID, censusID, quadratID, fullName } = props;
  if (!plotID || !censusID || !quadratID || !fullName) throw new Error("Process Census: Missing plotID, censusID, quadratID or full name");

  try {
    await connection.beginTransaction();

    let coreMeasurementID: number | undefined = undefined;

    // Fetch the necessary foreign key IDs
    let speciesID: number | null = null;
    if (rowData.spcode) {
      const query = `SELECT SpeciesID FROM ${schema}.species WHERE SpeciesCode = ?`;
      const rows = await runQuery(connection, query, [rowData.spcode]);
      if (rows.length === 0) throw new Error(`SpeciesCode ${rowData.spcode} not found.`);
      console.log('SpeciesCode found:', rowData.spcode);
      speciesID = rows[0].SpeciesID;
    }

    let quadratIDFromDB: number | null = null;
    if (rowData.quadrat) {
      const query = `SELECT QuadratID FROM ${schema}.quadrats WHERE QuadratName = ?`;
      const rows = await runQuery(connection, query, [rowData.quadrat]);
      if (rows.length === 0) throw new Error(`QuadratName ${rowData.quadrat} not found.`);
      console.log('QuadratName found:', rowData.quadrat);
      quadratIDFromDB = rows[0].QuadratID;
    }

    let subquadratID: number | null = null;
    if (rowData.subquadrat) {
      const query = `SELECT SubquadratID FROM ${schema}.subquadrats WHERE SubquadratName = ?`;
      const rows = await runQuery(connection, query, [rowData.subquadrat]);
      if (rows.length > 0) subquadratID = rows[0].SubquadratID;
      console.log('SubquadratName not found:', rowData.subquadrat);
    }

    // Upsert into trees
    if (rowData.tag) {
      let query = `INSERT INTO ${schema}.trees (TreeTag, SpeciesID) VALUES (?, ?) ON DUPLICATE KEY UPDATE TreeID = LAST_INSERT_ID(TreeID), SpeciesID = VALUES(SpeciesID)`;
      let result = await runQuery(connection, query, [rowData.tag, speciesID ?? null]);
      console.log('TreeTag upserted:', rowData.tag, 'Result:', result);
      const treeID = result.insertId;

      // Upsert into stems
      if (rowData.stemtag && rowData.lx && rowData.ly) {
        query = `
          INSERT INTO ${schema}.stems (StemTag, TreeID, QuadratID, SubquadratID, LocalX, LocalY, Unit) 
          VALUES (?, ?, ?, ?, ?, ?, ?) 
          ON DUPLICATE KEY UPDATE StemID = LAST_INSERT_ID(StemID), TreeID = VALUES(TreeID), QuadratID = VALUES(QuadratID), SubquadratID = VALUES(SubquadratID), LocalX = VALUES(LocalX), LocalY = VALUES(LocalY), Unit = VALUES(Unit)
        `;
        result = await runQuery(connection, query, [
          rowData.stemtag,
          treeID,
          quadratIDFromDB ?? null,
          subquadratID ?? null,
          rowData.lx ?? null,
          rowData.ly ?? null,
          rowData.unit ?? null
        ]);
        console.log('Stem upserted:', rowData.stemtag, 'Result:', result);
        const stemID = result.insertId;

        // Upsert into coremeasurements
        if (rowData.dbh && rowData.hom && rowData.date) {
          const personnelID = await getPersonnelIDByName(connection, schema, fullName);
          console.log('Personnel ID:', personnelID);

          console.log('Preparing to upsert into coremeasurements with values:', {
            censusID,
            plotID,
            quadratIDFromDB,
            subquadratID,
            treeID,
            stemID,
            personnelID,
            date: moment(rowData.date).format('YYYY-MM-DD'),
            dbh: rowData.dbh,
            dbhunit: rowData.dbhunit,
            hom: rowData.hom,
            homunit: rowData.homunit
          });

          query = `
            INSERT INTO ${schema}.coremeasurements 
            (CensusID, PlotID, QuadratID, SubquadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE CoreMeasurementID = LAST_INSERT_ID(CoreMeasurementID), 
            MeasuredDBH = VALUES(MeasuredDBH), DBHUnit = VALUES(DBHUnit), 
            MeasuredHOM = VALUES(MeasuredHOM), HOMUnit = VALUES(HOMUnit), MeasurementDate = VALUES(MeasurementDate)
          `;
          result = await runQuery(connection, query, [
            censusID,
            plotID,
            quadratIDFromDB ?? null,
            subquadratID ?? null,
            treeID,
            stemID,
            personnelID,
            0,
            moment(rowData.date).format('YYYY-MM-DD'),
            rowData.dbh ?? null,
            rowData.dbhunit ?? null,
            rowData.hom ?? null,
            rowData.homunit ?? null
          ]);

          console.log('CoreMeasurement upsert result:', result);

          if (result && result.insertId) {
            coreMeasurementID = result.insertId;
          } else {
            console.error('CoreMeasurement insertion did not return an insertId.');
            throw new Error('CoreMeasurement insertion failure');
          }

          // Insert into cmattributes after verifying each code exists in attributes table
          if (rowData.codes) {
            const codes = rowData.codes.split(';').map(code => code.trim()).filter(Boolean);
            for (const code of codes) {
              query = `SELECT COUNT(*) as count FROM ${schema}.attributes WHERE Code = ?`;
              const attributeRows = await runQuery(connection, query, [code]);
              if (!attributeRows || attributeRows.length === 0) {
                throw new Error(`Attribute code ${code} not found or query failed.`);
              }
              if (!attributeRows[0] || !attributeRows[0].count) {
                throw new Error(`Invalid response structure for attribute code ${code}.`);
              }
              console.log('Attribute found:', code);
              query = `
                INSERT INTO ${schema}.cmattributes (CoreMeasurementID, Code) 
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE CMAID = LAST_INSERT_ID(CMAID)
              `;
              result = await runQuery(connection, query, [coreMeasurementID, code]);
              console.log('CMAttribute upserted:', code, 'Result:', result);
            }
          }
        }
      }
    }

    await connection.commit();
    console.log('Upsert successful. CoreMeasurement ID generated:', coreMeasurementID);
    return coreMeasurementID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    console.error('Error object:', error);
    throw error;
  }
}
