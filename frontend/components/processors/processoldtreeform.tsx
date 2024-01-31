import {FileRow, RowDataStructure} from "@/config/macros";
import {getColumnValueByColumnName, getPersonnelIDByName, processCode} from "@/components/processors/processorhelpers";
import {PoolConnection, RowDataPacket} from "mysql2/promise";

export default async function processOldTreeForm(
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
    const personnelID = await getPersonnelIDByName(connection, fullName);
    if (personnelID === null) throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);

    const speciesID = await getColumnValueByColumnName(connection, 'Species', 'SpeciesID', 'SpeciesCode', rowData.spcode);
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);

    const quadratID = await getColumnValueByColumnName(connection, 'Quadrats', 'QuadratID', 'QuadratName', rowData.quadrat);
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const stemID = await getColumnValueByColumnName(connection, 'Stems', 'StemID', 'StemTag', rowData.stemtag);
    if (!stemID) throw new Error(`Stem with tag ${rowData.stemtag} could not be found`);

    const treeID = await getColumnValueByColumnName(connection, 'Trees', 'TreeID', 'TreeTag', rowData.tag);
    if (treeID) throw new Error(`Tree with tag ${rowData.tag} could not be found`);

    const plotID = await getColumnValueByColumnName(connection, 'Plots', 'PlotID', 'PlotName', plotKey);
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    const coreMeasurementResult = await connection.query(
      `
        SELECT CoreMeasurementID 
        FROM CoreMeasurements
        WHERE StemID = ? AND TreeID = ?;
      `,
      [stemID, treeID]
    ) as unknown;

    const rowDataPacketArray = coreMeasurementResult as RowDataPacket[];
    if (rowDataPacketArray.length === 0) throw new Error(`CoreMeasurementID via stemID ${stemID} and treeID ${treeID} could not be retrieved`);

    const oldCoreMeasurementID = rowDataPacketArray[0].CoreMeasurementID;
    if (!oldCoreMeasurementID) throw new Error("Extracting oldCoreMeasurementID: unforeseen error");


    const measurementDate = await getColumnValueByColumnName(
      connection,
      'CoreMeasurements',
      'MeasurementDate',
      'CoreMeasurementID',
      oldCoreMeasurementID
    );
    if (!measurementDate) throw new Error(`Extracting the measurement date via ${oldCoreMeasurementID} failed`);

    let measurementTypeID = await getColumnValueByColumnName(
      connection,
      'MeasurementTypes',
      'MeasurementTypeID',
      'MeasurementTypeDescription',
      "dbh"
    );
    if (measurementTypeID === null) throw new Error(`MeasurementType with description "dbh" does not exist.`);

    await connection.query(
      `
          UPDATE ${schema}.CoreMeasurements
          SET IsCurrent = CASE
                              WHEN IsCurrent = 'false' THEN 'true'
                              ELSE 'false'
              END
          WHERE CoreMeasurementID = ?;
      `,
      [oldCoreMeasurementID]
    );

    let collectedMeasurements = [];
    const measurementInsertQuery = `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING CoreMeasurementID;
    `;

    const [result] = (await connection.query(measurementInsertQuery, [
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
      oldCoreMeasurementID,
    ])) as RowDataPacket[][];

    if (result.length <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    const dbhCMID = result[0][0].CoreMeasurementID;
    if (dbhCMID === null) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(dbhCMID);

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(connection, codesArray, collectedMeasurements);
  } catch (error) {
    throw error;
  }
}