import {PoolConnection} from "mysql2/promise"; // Import the mysql2/promise library
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  processCode,
  processStems,
  processTrees
} from "@/components/processors/processorhelpers";
import {FileRow, RowDataStructure} from "@/config/macros";

export default async function processNewPlantsForm(
  connection: PoolConnection,
  rowData: FileRow,
  plotKey: string,
  censusID: string,
  fullName: string
) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Foreign key checks and error handling for species, quadrat, and plot
    const speciesID = await getColumnValueByColumnName(connection, 'Species', 'SpeciesID', 'SpeciesCode', rowData.spcode);
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);

    const quadratID = await getColumnValueByColumnName(connection, 'Quadrats', 'QuadratID', 'QuadratName', rowData.quadrat);
    if (!quadratID) throw Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const plotID = await getColumnValueByColumnName(connection, 'Plots', 'PlotID', 'PlotName', plotKey);
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    // Insert or update Trees with SpeciesID and SubSpeciesID
    await processTrees(connection, rowData.treeTag, speciesID, null);

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
    await processStems(connection, rowData.stemTag, treeID, quadratID, null, null);

    const stemID = await getColumnValueByColumnName(
      connection,
      'Stems',
      'StemID',
      'StemTag',
      rowData.stemTag
    )
    if (stemID === null) {
      throw new Error(`Stem with stemtag ${rowData.stemTag} could be found`);
    }

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

    // Cast the result to include affectedRows and insertId
    // Execute the INSERT query
    const [result] = await connection.execute(
      `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
      [
        censusID,
        plotID,
        quadratID,
        treeID,
        stemID,
        personnelID,
        measurementTypeID,
        rowData.date,
        rowData.dbh.toString(),
        null,
        1,
        null,
        rowData.comments,
        null,
      ]
    );

    // Check if the result is an OkPacket and extract affectedRows and insertId
    let affectedRows: number | undefined;
    let insertId: number | undefined;

    if ('affectedRows' in result) {
      affectedRows = result.affectedRows as number;
    }

    if ('insertId' in result) {
      insertId = result.insertId as number;
    }

    if (affectedRows === undefined || insertId === undefined) {
      throw new Error('Unable to extract affectedRows or insertId from the result.');
    }

    if (affectedRows <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    if (insertId === 0) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(insertId);

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