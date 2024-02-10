import {PoolConnection} from 'mysql2/promise';
import {booleanToBit, FileRow} from '@/config/macros';
import {runQuery,} from '@/components/processors/processormacros';
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  getSubSpeciesID,
  processCode,
  processStems,
  processTrees
} from './processorhelperfunctions';

export default async function processCensus(
  connection: PoolConnection,
  rowData: FileRow,
  plotKey: string,
  censusID: string,
  fullName: string
) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  try {
    /**
     *       "tag": "Trees.TreeTag",
     *       "stemtag": "Stems.StemTag",
     *       "spcode": "Species.SpeciesCode",
     *       "quadrat": "Quadrats.QuadratName",
     *       "lx": "Stems.StemQuadX",
     *       "ly": "Stems.StemQuadY",
     *       "dbh": "CoreMeasurements.MeasuredDBH",
     *       "codes": "Attributes.Code",
     *       "hom": "CoreMeasurement.MeasuredHOM",
     *       "date": "CoreMeasurement.MeasurementDate",
     */
    await connection.beginTransaction();
    // Foreign key checks and error handling for species, quadrat, and plot
    const speciesID = await getColumnValueByColumnName(
      connection,
      'Species',
      'SpeciesID',
      'SpeciesCode',
      rowData.spcode
    );
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);

    const quadratID = await getColumnValueByColumnName(
      connection,
      'Quadrats',
      'QuadratID',
      'QuadratName',
      rowData.quadrat
    );
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const plotID = await getColumnValueByColumnName(
      connection,
      'Plots',
      'PlotID',
      'PlotName',
      plotKey
    );
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    let subSpeciesID = null;
    if (speciesID) {
      subSpeciesID = await getSubSpeciesID(connection, parseInt(speciesID));
    }

    // Insert or update Trees with SpeciesID and SubSpeciesID
    const treeID = await processTrees(connection, rowData.treeTag, speciesID, subSpeciesID ?? null);

    if (treeID === null) {
      throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    }

    // Insert or update Stems
    const stemID = await processStems(connection, rowData.stemTag, treeID, quadratID, rowData.lx, rowData.ly);
    if (stemID === null) throw new Error(`Insertion failure at processStems with data: ${[rowData.stemTag, treeID, quadratID, rowData.lx, rowData.ly]}`)

    const personnelID = await getPersonnelIDByName(connection, fullName);
    if (personnelID === null) {
      throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    }

    // Process CoreMeasurements for dbh
    const isPrimaryStemQuery = `
    SELECT IF(COUNT(*) > 0, MAX(IsPrimaryStem), b'1') AS IsPrimaryStem
    FROM ${schema}.CoreMeasurements
    WHERE TreeID = ? AND StemID = ? AND CensusID = ? AND PlotID = ? AND QuadratID = ?;
    `;

    const stemResult = await runQuery(connection, isPrimaryStemQuery, [
      treeID,
      stemID,
      censusID,
      plotID,
      quadratID,
    ]);

    const isPrimaryStem = stemResult.length > 0 ? stemResult[0].IsPrimaryStem : false;

    const measurementInsertQuery = `
    INSERT INTO ${schema}.CoreMeasurements
    (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, IsRemeasurement, IsCurrent, IsPrimaryStem, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const dbhResult = await runQuery(connection, measurementInsertQuery, [
      censusID,
      plotID,
      quadratID,
      treeID,
      stemID,
      personnelID,
      booleanToBit(false), // is not remeasurement
      booleanToBit(true),
      isPrimaryStem,  // Using the value obtained from the previous query
      booleanToBit(false), // isValidated is false by default
      rowData.date,
      rowData.dbh,
      rowData.hom,
      null,
      null,
    ]);

    if (dbhResult.affectedRows <= 0) {
      throw new Error(`Insertion failed for CoreMeasurement.`);
    }

    const dbhCMID: number = dbhResult.insertId;
    if (dbhCMID === null) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null.`);
    }

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(connection, codesArray, dbhCMID);

    // Commit transaction
    await connection.commit();
    return dbhCMID;
  } catch (error) {
    // Rollback transaction in case of error
    await connection.rollback();
    throw error;
  } finally {
    // Release the connection back to the pool
    if (connection) {
      connection.release();
    }
  }
}
