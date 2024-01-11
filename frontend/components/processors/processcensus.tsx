import sql from "mssql";
import {RowDataStructure} from "@/config/macros";
import {
  getColumnValueByColumnName,
  getCoreMeasurementID,
  getSubSpeciesID,
  processCode
} from "@/components/processors/processorhelpers";

export default async function processCensus(conn: sql.ConnectionPool, rowData: RowDataStructure, plotKey: string) {
  // need the following IDs --> CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID
  // Start transaction
  const transaction = new sql.Transaction(conn);
  await transaction.begin();

  const request = new sql.Request(transaction || conn);

  try {
    // Foreign key checks and error handling for species, quadrat, and plot
    const speciesID = await getColumnValueByColumnName(transaction, 'forestgeo.Species', 'SpeciesID', 'SpeciesCode', rowData.spcode);
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);

    const quadratID = await getColumnValueByColumnName(transaction, 'forestgeo.Quadrats', 'QuadratID', 'QuadratName', rowData.quadrat);
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const plotID = await getColumnValueByColumnName(transaction, 'forestgeo.Plots', 'PlotID', 'PlotName', plotKey);
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    let subSpeciesID = null;
    if (speciesID) {
      subSpeciesID = await getSubSpeciesID(transaction, speciesID);
    }

    // Insert or update Trees with SpeciesID and SubSpeciesID
    await request
      .input('TreeTag', sql.VarChar, rowData.tag)
      .input('SpeciesID', sql.Int, speciesID)
      .input('SubSpeciesID', sql.Int, subSpeciesID || null) // Handle null if no SubSpecies
      .query(`
        MERGE INTO forestgeo.Trees AS target
        USING (VALUES (@TreeTag, @SpeciesID, @SubSpeciesID)) AS source (TreeTag, SpeciesID, SubSpeciesID)
        ON target.TreeTag = source.TreeTag
        WHEN NOT MATCHED THEN
          INSERT (TreeTag, SpeciesID, SubSpeciesID) VALUES (@TreeTag, @SpeciesID, @SubSpeciesID);
      `);


    // Insert or update Stems
    await request
      .input('StemTag', sql.VarChar, rowData.stemtag)
      .input('StemX', sql.Float, rowData.lx)
      .input('StemY', sql.Float, rowData.ly)
      .query(`
        MERGE INTO forestgeo.Stems AS target
        USING (VALUES (@StemTag, @StemX, @StemY)) AS source (StemTag, StemX, StemY)
        ON target.StemTag = source.StemTag
        WHEN NOT MATCHED THEN
          INSERT (StemTag, StemX, StemY) VALUES (@StemTag, @StemX, @StemY);
      `);

    // Process CoreMeasurements for dbh
    // Note: The following assumes that you have a way to link these measurements to a specific Tree and Census
    const dbhTreeID = await getColumnValueByColumnName(
      transaction,
      'forestgeo.Trees',
      'TreeID',
      'TreeTag',
      rowData.tag
    );

    if (dbhTreeID === null) {
      throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    }

    const measurementInsertQuery = `
      INSERT INTO forestgeo.CoreMeasurements (TreeID, MeasurementTypeID, MeasurementDate, Measurement)
      VALUES (@TreeID, @MeasurementTypeID, @MeasurementDate, @Measurement);
    `;

    await request
      .input('TreeID', sql.Int, dbhTreeID)
      .input('MeasurementTypeID', sql.Int, 1) // DBH Measurement Type
      .input('MeasurementDate', sql.Date, rowData.date)
      .input('Measurement', sql.VarChar, rowData.dbh.toString())
      .query(measurementInsertQuery);

    // Get the CoreMeasurementID for DBH
    const dbhCoreMeasurementID = await getCoreMeasurementID(
      transaction,
      dbhTreeID,
      1, // MeasurementTypeID for DBH
      rowData.date
    );

    if (dbhCoreMeasurementID === null) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }

    // Process CoreMeasurements for hom
    const homTreeID = await getColumnValueByColumnName(
      transaction,
      'forestgeo.Trees',
      'TreeID',
      'TreeTag',
      rowData.tag
    );

    if (homTreeID === null) {
      throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    }

    await request
      .input('TreeID', sql.Int, homTreeID)
      .input('MeasurementTypeID', sql.Int, 2) // HOM Measurement Type
      .input('MeasurementDate', sql.Date, rowData.date)
      .input('Measurement', sql.VarChar, rowData.hom.toString())
      .query(measurementInsertQuery);

    // Get the CoreMeasurementID for HOM
    const homCoreMeasurementID = await getCoreMeasurementID(
      transaction,
      homTreeID,
      2, // MeasurementTypeID for HOM
      rowData.date
    );

    if (homCoreMeasurementID === null) {
      throw new Error(`No matching CoreMeasurement found for HOM.`);
    }

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(',');

    for (const code of codesArray) {
      await processCode(
        transaction,
        code.trim(),
        dbhTreeID,
        1, // MeasurementTypeID for DBH
        rowData.date
      );
    }

    // Commit transaction
    await transaction.commit();
  } catch (error) {
    // Rollback transaction in case of error
    await transaction.rollback();
    throw error;
  }
}