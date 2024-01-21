import {PoolConnection} from 'mysql2/promise';
import {RowDataStructure} from '@/config/macros';
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  getSubSpeciesID,
  processCode,
  processStems,
  processTrees,
} from '@/components/processors/processorhelpers';

export default async function processCensus(
  connection: PoolConnection,
  rowData: RowDataStructure,
  plotKey: string,
  censusID: string,
  fullName: string
) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");
  try {
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
      subSpeciesID = await getSubSpeciesID(connection, speciesID);
    }

    // Insert or update Trees with SpeciesID and SubSpeciesID
    await processTrees(connection, rowData.treeTag, speciesID, subSpeciesID || null);

    const treeID = await getColumnValueByColumnName(
      connection,
      'Trees',
      'TreeID',
      'TreeTag',
      rowData.tag
    );
    if (treeID === null) {
      throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    }

    // Insert or update Stems
    await processStems(connection, rowData.stemTag, treeID, quadratID, rowData.lx, rowData.ly);

    const stemID = await getColumnValueByColumnName(
      connection,
      'Stems',
      'StemID',
      'StemTag',
      rowData.stemTag
    );

    const personnelID = await getPersonnelIDByName(connection, fullName);
    if (personnelID === null) {
      throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    }

    // Process CoreMeasurements for dbh
    // Note: The following assumes that you have a way to link these measurements to a specific Tree and Census
    let measurementTypeID = await getColumnValueByColumnName(
      connection,
      'MeasurementTypes',
      'MeasurementTypeID',
      'MeasurementTypeDescription',
      "dbh"
    );
    if (measurementTypeID === null) {
      throw new Error(`MeasurementType with description "dbh" does not exist.`);
    }

    let collectedMeasurements: number[] = [];

    const measurementInsertQuery = `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const [dbhResult] = await connection.execute(measurementInsertQuery, [
      censusID,
      plotID,
      quadratID,
      treeID,
      stemID,
      personnelID,
      measurementTypeID, // DBH Measurement Type
      rowData.date,
      rowData.dbh.toString(),
      null,
      1,
      null,
      null,
      null,
    ]) as any[];
    if (dbhResult.affectedRows <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    const dbhCMID = dbhResult.insertId;
    if (dbhCMID === null) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(dbhCMID);

    measurementTypeID = await getColumnValueByColumnName(
      connection,
      'MeasurementTypes',
      'MeasurementTypeID',
      'MeasurementTypeDescription',
      "hom"
    );
    if (measurementTypeID === null) {
      throw new Error(`MeasurementType with description "hom" does not exist.`);
    }

    const [homResult] = await connection.execute(measurementInsertQuery, [
      censusID,
      plotID,
      quadratID,
      treeID,
      stemID,
      personnelID,
      measurementTypeID, // HOM Measurement Type
      rowData.date,
      rowData.dbh.toString(),
      null,
      1,
      null,
      null,
      dbhCMID,
    ]) as any[];
    if (homResult.affectedRows <= 0) {
      throw new Error(`No matching CoreMeasurement found for HOM.`);
    }
    const homCMID = homResult.insertId;
    if (homCMID === null) {
      throw new Error(`The HOM insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(homCMID);

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(connection, codesArray, collectedMeasurements);

    // Commit transaction
    await connection.commit();
  } catch (error) {
    // Rollback transaction in case of error
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    // Release the connection back to the pool
    if (connection) {
      connection.release();
    }
  }
}
