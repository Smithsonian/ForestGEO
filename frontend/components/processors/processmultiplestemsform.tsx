import {RowDataStructure} from "@/config/macros";
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  processCode,
  processStems
} from "@/components/processors/processorhelpers";
import {PoolConnection} from "mysql2/promise";

export default async function processMultipleStemsForm(
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

    const treeID = await getColumnValueByColumnName(
      connection,
      'Trees',
      'TreeID',
      'TreeTag',
      rowData.tag
    );
    if (treeID === null) throw new Error(`Tree with tag ${rowData.tag} does not exist.`);

    // Insert or update Stems
    await processStems(connection, rowData.stemTag, treeID, quadratID, null, null);

    const stemID = await getColumnValueByColumnName(
      connection,
      'Stems',
      'StemID',
      'StemTag',
      rowData.stemTag
    );
    if (stemID === null) throw new Error(`Stem with stemtag ${rowData.stemTag} could be found`);

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

    let collectedMeasurements = [];

    const measurementInsertQuery = `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const [result] = await connection.execute(measurementInsertQuery, [
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
    if (result.affectedRows <= 0) throw new Error(`No matching CoreMeasurement found for DBH.`);

    const dbhCMID = result.insertId;
    if (dbhCMID === null) {
      throw new Error(`the DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(dbhCMID);

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(
      connection,
      codesArray,
      collectedMeasurements,
    );
    // Commit transaction
    await connection.commit();
  } catch (error) {
    // Rollback transaction in case of error
    await connection.rollback();
    throw error;
  }
}