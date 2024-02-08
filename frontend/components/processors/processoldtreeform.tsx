import {booleanToBit, FileRow} from "@/config/macros";
import {runQuery} from "@/components/processors/processormacros";
import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  processCode
} from "@/components/processors/processorhelperfunctions";

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
    /**
     *       "quadrat": "Quadrats.QuadratName",
     *       "tag": "Trees.TreeTag",
     *       "stemtag": "Stems.StemTag",
     *       "spcode": "Species.SpeciesCode",
     *       "olddbh": "CoreMeasurements.MeasuredDBH",
     *       "oldhom": "CoreMeasurements.MeasuredHOM",
     *       "dbh": "CoreMeasurements.MeasuredDBH",
     *       "codes": "Attributes.Code",
     *       "comments": "CoreMeasurements.Description"
     */
    await connection.beginTransaction();
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
      rowData.oldhom,
      rowData.comments,
      null,
    ]);

    if (dbhResult.affectedRows <= 0) {
      throw new Error(`Insertion failed for CoreMeasurement.`);
    }

    const dbhCMID = dbhResult.insertId;
    if (dbhCMID === null) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null.`);
    }

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';');
    await processCode(connection, codesArray, dbhCMID);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    // Release the connection back to the pool
    if (connection) {
      connection.release();
    }
  }
}