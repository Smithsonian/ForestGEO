import sql from "mssql";
import {RowDataStructure} from "@/config/macros";
import {
  getColumnValueByColumnName, getPersonnelIDByName,
  getSubSpeciesID, processCode,
  processStems,
  processTrees
} from "@/components/processors/processorhelpers";

export default async function processBigTreesForm(conn: sql.ConnectionPool, rowData: RowDataStructure, plotKey: string, censusID: string, fullName: string) {
  /**
   *       "quadrat": "Quadrats.QuadratName",
   *       "subquadrat": "",
   *       "tag": "Trees.TreeTag",
   *       "multistemtag": "Stems.StemTag",
   *       "species": "Species.SpeciesName",
   *       "dbh": "CoreMeasurements.Measurement",
   *       "hom": "CoreMeasurements.Measurement",
   *       "comments": "CoreMeasurements.Measurement"
   */

  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  // need the following IDs --> CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID
  // Start transaction
  const transaction = new sql.Transaction(conn);
  await transaction.begin();

  const request = new sql.Request(transaction || conn);

  try {
    // Foreign key checks and error handling for species, quadrat, and plot
    const speciesID = await getColumnValueByColumnName(transaction, 'Species', 'SpeciesID', 'SpeciesName', rowData.species);
    if (!speciesID) throw new Error(`Species with code ${rowData.species} does not exist.`);

    const quadratID = await getColumnValueByColumnName(transaction, 'Quadrats', 'QuadratID', 'QuadratName', rowData.quadrat);
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const plotID = await getColumnValueByColumnName(transaction, 'Plots', 'PlotID', 'PlotName', plotKey);
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    let subSpeciesID = null;
    if (speciesID) {
      subSpeciesID = await getSubSpeciesID(transaction, speciesID);
    }

    // Insert or update Trees with SpeciesID and SubSpeciesID
    await processTrees(transaction, rowData.treeTag, speciesID, subSpeciesID || null);

    const treeID = await getColumnValueByColumnName(transaction, 'Trees', 'TreeID', 'TreeTag', rowData.tag);
    if (treeID === null) throw new Error(`Tree with tag ${rowData.tag} does not exist.`);

    // Insert or update Stems
    await processStems(transaction, rowData.multistemtag, treeID, quadratID, rowData.lx, rowData.ly);

    const stemID = await getColumnValueByColumnName(transaction, 'Stems', 'StemID', 'StemTag', rowData.multistemtag);
    if (stemID === null) throw new Error(`Stem with tag ${rowData.multistemtag} does not exist`);

    const personnelID = await getPersonnelIDByName(transaction, fullName);
    if (personnelID === null){
      throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    }

    // Process CoreMeasurements for dbh
    // Note: The following assumes that you have a way to link these measurements to a specific Tree and Census
    let measurementTypeID = await getColumnValueByColumnName(transaction, 'MeasurementTypes', 'MeasurementTypeID',
      'MeasurementTypeDescription', "dbh");
    if (measurementTypeID === null) throw new Error(`MeasurementType with description "dbh" does not exist.`);

    let collectedMeasurements = [];

    const measurementInsertQuery = `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      OUTPUT INSERTED.CoreMeasurementID
      VALUES (@CensusID, @PlotID, @QuadratID, @TreeID, @StemID, @PersonnelID, @MeasurementTypeID, @MeasurementDate, @Measurement, @IsRemeasurement, @IsCurrent, @UserDefinedFields, @Description, @MasterMeasurementID);
    `;
    const dbhResult = await request
      .input('CensusID', sql.Int, censusID)
      .input('PlotID', sql.Int, plotID)
      .input('QuadratID', sql.Int, quadratID)
      .input('TreeID', sql.Int, treeID)
      .input('StemID', sql.Int, stemID)
      .input('PersonnelID', sql.Int, personnelID)
      .input('MeasurementTypeID', sql.Int, measurementTypeID) // DBH Measurement Type
      .input('MeasurementDate', sql.Date, rowData.date)
      .input('Measurement', sql.VarChar, rowData.dbh.toString())
      .input('IsRemeasurement', sql.Bit, null)
      .input('IsCurrent', sql.Bit, 1)
      .input('UserDefinedFields', sql.VarChar, null)
      .input('Description', sql.VarChar, null)
      .input('MasterMeasurementID', sql.Int, null)
      .query(measurementInsertQuery);
    if (dbhResult.recordset.length <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    const dbhCMID = dbhResult.recordset[0].CoreMeasurementID;
    if (dbhCMID === null) {
      throw new Error(`the DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(dbhCMID);

    measurementTypeID = await getColumnValueByColumnName(
      transaction,
      'MeasurementTypes',
      'MeasurementTypeID',
      'MeasurementTypeDescription',
      "hom"
    );
    if (measurementTypeID === null) {
      throw new Error(`MeasurementType with description "hom" does not exist.`);
    }

    const result = await request
      .input('CensusID', sql.Int, censusID)
      .input('PlotID', sql.Int, plotID)
      .input('QuadratID', sql.Int, quadratID)
      .input('TreeID', sql.Int, treeID)
      .input('StemID', sql.Int, stemID)
      .input('PersonnelID', sql.Int, personnelID)
      .input('MeasurementTypeID', sql.Int, measurementTypeID) // DBH Measurement Type
      .input('MeasurementDate', sql.Date, rowData.date)
      .input('Measurement', sql.VarChar, rowData.dbh.toString())
      .input('IsRemeasurement', sql.Bit, null)
      .input('IsCurrent', sql.Bit, 1)
      .input('UserDefinedFields', sql.VarChar, null)
      .input('Description', sql.VarChar, null)
      .input('MasterMeasurementID', sql.Int, dbhCMID)
      .query(measurementInsertQuery);
    if (result.recordset.length <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    const homCMID = result.recordset[0].CoreMeasurementID;
    if (homCMID === null) {
      throw new Error(`the HOM insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(homCMID);

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(
      transaction,
      codesArray,
      collectedMeasurements,
    );

    // Commit transaction
    await transaction.commit();
  } catch (error) {
    // Rollback transaction in case of error
    await transaction.rollback();
    throw error;
  }
}