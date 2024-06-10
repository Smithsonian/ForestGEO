import {runQuery, SpecialProcessingProps} from '@/components/processors/processormacros';
import {getPersonnelIDByName} from './processorhelperfunctions';
import moment from 'moment';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<number | undefined> {
  const {connection, rowData, schema, plotID, censusID, quadratID, fullName} = props;
  if (!plotID || !censusID || !quadratID || !fullName) throw new Error("Process Census: Missing plotID, censusID, quadratID or full name");

  try {
    await connection.beginTransaction();

    // Upsert into trees
    if (rowData.tag) {
      let query = `INSERT INTO ${schema}.trees (TreeTag) VALUES (?) ON DUPLICATE KEY UPDATE TreeID = LAST_INSERT_ID(TreeID)`;
      let result = await runQuery(connection, query, [rowData.tag]);
      const treeID = result.insertId;

      // Fetch the necessary foreign key IDs
      let rows;
      if (rowData.spcode) {
        query = `SELECT SpeciesID FROM ${schema}.species WHERE SpeciesCode = ?`;
        rows = await runQuery(connection, query, [rowData.spcode]);
        if (rows.length === 0) throw new Error(`SpeciesCode ${rowData.spcode} not found.`);
        const speciesID = rows[0].SpeciesID;

        query = `SELECT SubquadratID FROM ${schema}.subquadrats WHERE SubquadratName = ?`;
        rows = await runQuery(connection, query, [rowData.subquadrat]);
        if (rows.length === 0) throw new Error(`SubquadratName ${rowData.subquadrat} not found.`);
        const subquadratID = rows[0].SubquadratID;

        // Upsert into stems
        if (rowData.stemtag && rowData.lx && rowData.ly) {
          query = `
            INSERT INTO ${schema}.stems (StemTag, TreeID, SpeciesID, SubquadratID, LocalX, LocalY, Unit) 
            VALUES (?, ?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE StemID = LAST_INSERT_ID(StemID), TreeID = VALUES(TreeID), SpeciesID = VALUES(SpeciesID), SubquadratID = VALUES(SubquadratID), LocalX = VALUES(LocalX), LocalY = VALUES(LocalY), Unit = VALUES(Unit)
          `;
          result = await runQuery(connection, query, [rowData.stemtag, treeID, speciesID, subquadratID, rowData.lx, rowData.ly, rowData.unit]);
          const stemID = result.insertId;

          // Upsert into coremeasurements
          if (rowData.dbh && rowData.dbhunit && rowData.hom && rowData.homunit && rowData.date) {
            query = `
              INSERT INTO ${schema}.coremeasurements 
              (CensusID, PlotID, QuadratID, SubquadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
              ON DUPLICATE KEY UPDATE CoreMeasurementID = LAST_INSERT_ID(CoreMeasurementID), 
              MeasuredDBH = VALUES(MeasuredDBH), DBHUnit = VALUES(DBHUnit), 
              MeasuredHOM = VALUES(MeasuredHOM), HOMUnit = VALUES(HOMUnit), MeasurementDate = VALUES(MeasurementDate)
            `;
            const personnelID = await getPersonnelIDByName(connection, schema, fullName);
            result = await runQuery(connection, query, [
              censusID, plotID, quadratID, subquadratID, treeID, stemID, personnelID, 0, moment(rowData.date).format('YYYY-MM-DD'),
              rowData.dbh, rowData.dbhunit, rowData.hom, rowData.homunit
            ]);
            const coreMeasurementID = result.insertId;

            // Insert into cmattributes after verifying each code exists in attributes table
            if (rowData.codes) {
              const codes = rowData.codes.split(';').map(code => code.trim()).filter(Boolean);
              for (const code of codes) {
                query = `SELECT COUNT(*) as count FROM ${schema}.attributes WHERE Code = ?`;
                const [attributeRows] = await runQuery(connection, query, [code]);
                if (attributeRows[0].count === 0) {
                  throw new Error(`Attribute code ${code} not found.`);
                }
                query = `
                  INSERT INTO ${schema}.cmattributes (CoreMeasurementID, Code) 
                  VALUES (?, ?)
                  ON DUPLICATE KEY UPDATE CMAID = LAST_INSERT_ID(CMAID)
                `;
                await runQuery(connection, query, [coreMeasurementID, code]);
              }
            }
            await connection.commit();
            return coreMeasurementID;
          }
        }
      }
    }

    await connection.commit();
    console.log('Upsert successful');
    return undefined;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw error;
  }
}
