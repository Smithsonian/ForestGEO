import sql from "mssql";
import {RowDataStructure} from "@/config/macros";
import {
  getColumnValueByColumnName,
  getPersonnelIDByName, processCode,
  processStems,
  processTrees
} from "@/components/processors/processorhelpers";

export default async function processOldTreeForm(conn: sql.ConnectionPool, rowData: RowDataStructure, plotKey: string, censusID: string, fullName: string) {
  /**
   * for stems previously censused
   *
   *  "quadrat": "Quadrats.QuadratName",
   *  "tag": "Trees.TreeTag",
   *  "stemtag": "Stems.StemTag",
   *  "spcode": "Species.SpeciesCode",
   *  "olddbh": "CoreMeasurements.Measurement",
   *  "oldhom": "CoreMeasurements.Measurement",
   *  "dbh": "CoreMeasurements.Measurement",
   *  "codes": "Attributes.Code",
   *  "comments": "CoreMeasurements.Description"
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
    const personnelID = await getPersonnelIDByName(transaction, fullName);
    if (personnelID === null) throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);

    const speciesID = await getColumnValueByColumnName(transaction, 'Species', 'SpeciesID', 'SpeciesCode', rowData.spcode);
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);

    const quadratID = await getColumnValueByColumnName(transaction, 'Quadrats', 'QuadratID', 'QuadratName', rowData.quadrat);
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);

    const stemID = await getColumnValueByColumnName(transaction, 'Stems', 'StemID', 'StemTag', rowData.stemtag);
    if (!stemID) throw new Error(`Stem with tag ${rowData.stemtag} could not be found`);

    const treeID = await getColumnValueByColumnName(transaction, 'Trees', 'TreeID', 'TreeTag', rowData.tag);
    if (treeID) throw new Error(`Tree with tag ${rowData.tag} could not be found`);

    const plotID = await getColumnValueByColumnName(transaction, 'Plots', 'PlotID', 'PlotName', plotKey);
    if (!plotID) throw new Error(`Plot with name ${plotKey} does not exist.`);

    const coreMeasurementResult = await request
      .input('StemID', sql.Int, stemID)
      .input('TreeID', sql.Int, treeID)
      .query(`
        SELECT CoreMeasurementID 
        FROM CoreMeasurements
        WHERE StemID = @StemID AND TreeID = @TreeID;
      `);
    if (coreMeasurementResult.recordset.length === 0) throw new Error(`CoreMeasurementID via stemID ${stemID} and treeID ${treeID} could not be retrieved`)
    const oldCoreMeasurementID = coreMeasurementResult.recordset[0].CoreMeasurementID;
    if (!oldCoreMeasurementID) throw new Error("extracting oldcoremeasurementID: unforeseen error");

    const measurementDate = await getColumnValueByColumnName(transaction,
      'CoreMeasurements', 'MeasurementDate', 'CoreMeasurementID', oldCoreMeasurementID);
    if (!measurementDate) throw new Error(`Extracting the measurement date via ${oldCoreMeasurementID} failed`);

    let measurementTypeID = await getColumnValueByColumnName(
      transaction, 'MeasurementTypes', 'MeasurementTypeID','MeasurementTypeDescription', "dbh");
    if (measurementTypeID === null) throw new Error(`MeasurementType with description "dbh" does not exist.`);

    await request
      .input('CoreMeasurementID', sql.Int, oldCoreMeasurementID)
      .query(`
      UPDATE [YourSchema].CoreMeasurements
      SET IsCurrent = CASE 
                         WHEN IsCurrent = 'false' THEN 'true'
                         ELSE 'false'
                      END
      WHERE CoreMeasurementID = @CoreMeasurementID;`);

    let collectedMeasurements = [];
    const measurementInsertQuery = `
      INSERT INTO ${schema}.CoreMeasurements
      (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, MeasurementTypeID, MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields, Description, MasterMeasurementID)
      OUTPUT INSERTED.CoreMeasurementID
      VALUES (@CensusID, @PlotID, @QuadratID, @TreeID, @StemID, @PersonnelID, @MeasurementTypeID, @MeasurementDate, @Measurement, @IsRemeasurement, @IsCurrent, @UserDefinedFields, @Description, @MasterMeasurementID);
    `;
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
      .input('Description', sql.VarChar, rowData.comments)
      .input('MasterMeasurementID', sql.Int, oldCoreMeasurementID) // because this is a new measurement updating an old one, we need to associate measurements together
      .query(measurementInsertQuery);
    if (result.recordset.length <= 0) {
      throw new Error(`No matching CoreMeasurement found for DBH.`);
    }
    const dbhCMID = result.recordset[0].CoreMeasurementID;
    if (dbhCMID === null) {
      throw new Error(`the DBH insertion's CoreMeasurementID is null.`);
    }
    collectedMeasurements.push(dbhCMID);

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