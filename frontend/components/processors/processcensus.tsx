import { booleanToBit } from '@/config/macros';
import { runQuery, SpecialProcessingProps, } from '@/components/processors/processormacros';
import {
  getColumnValueByColumnName,
  getPersonnelIDByName,
  getSubSpeciesID,
  processCode,
  processStems,
  processTrees
} from './processorhelperfunctions';
import moment from 'moment';

export async function processCensus(props: Readonly<SpecialProcessingProps>): Promise<number | null> {
  const { connection, rowData, schema, plotID, censusID, quadratID, fullName, unitOfMeasurement } = props;
  if (!plotID || !censusID || !quadratID || !fullName) throw new Error("Process Census: Missing plotID, censusID, quadratID or full name");
  try {
    /**
     *       "tag": "Trees.TreeTag",
     *       "stemtag": "Stems.StemTag",
     *       "spcode": "Species.SpeciesCode",
     *       "subquadrat": "SubQuadrats.SQName",
     *       "lx": "Stems.LocalX",
     *       "ly": "Stems.LocalY",
     *       "dbh": "CoreMeasurements.MeasuredDBH",
     *       "codes": "Attributes.Code",
     *       "hom": "CoreMeasurement.MeasuredHOM",
     *       "date": "CoreMeasurement.MeasurementDate",
     */
    await connection.beginTransaction();
    // Foreign key checks and error handling for species, quadrat, and plot
    console.log('extracting species ID by code');
    const speciesID = await getColumnValueByColumnName(
      connection,
      schema,
      'Species',
      'SpeciesID',
      'SpeciesCode',
      rowData.spcode
    );
    if (!speciesID) throw new Error(`Species with code ${rowData.spcode} does not exist.`);
    console.log(`speciesID: ${speciesID}`);

    const query = `SELECT sq.SQID, sq.QuadratID FROM ${schema}.subquadrats sq JOIN ${schema}.quadrats q ON sq.QuadratID = q.QuadratID WHERE (sq.SQName = ? AND q.PlotID = ?);`;
    const sqResults = await runQuery(connection, query, [rowData.subquadrat, plotID]);
    console.log(sqResults);
    const subquadratID = sqResults[0].SQID;
    const quadratID = sqResults[0].QuadratID;

    console.log('attempting subspecies ID by speciesID');
    let subSpeciesID = null;
    if (speciesID) subSpeciesID = await getSubSpeciesID(connection, schema, parseInt(speciesID));
    if (!subSpeciesID) console.log('no subspeciesID found');

    // Insert or update Trees with SpeciesID and SubSpeciesID
    const treeID = await processTrees(connection, schema, rowData.tag, speciesID, subSpeciesID ?? null);
    if (treeID === null) throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    console.log(`treeID: ${treeID}`);

    // Insert or update Stems
    const stemID = await processStems(connection, schema, rowData.stemtag, treeID, subquadratID, rowData.lx, rowData.ly);
    if (stemID === null) throw new Error(`Insertion failure at processStems with data: ${[rowData.stemtag, treeID, subquadratID, rowData.lx, rowData.ly]}`);
    console.log(`stemID: ${stemID}`);

    const personnelID = await getPersonnelIDByName(connection, schema, fullName);
    if (personnelID === null) throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    console.log(`personnelID: ${personnelID}`);

    const measurementInsertQuery = `
    INSERT INTO ${schema}.coremeasurements
    (CensusID, PlotID, QuadratID, SubquadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const dbhResult = await runQuery(connection, measurementInsertQuery, [
      censusID,
      plotID,
      quadratID,
      subquadratID,
      treeID,
      stemID,
      personnelID,
      booleanToBit(false), // isValidated is false by default
      moment(rowData.date).format('YYYY-MM-DD'),
      rowData.dbh ?? null,
      rowData.hom ?? null,
      null,
      JSON.stringify({ units: unitOfMeasurement }) ?? null,
    ]);

    if (dbhResult.affectedRows <= 0) {
      throw new Error(`Insertion failed for CoreMeasurement.`);
    }

    const dbhCMID = dbhResult.insertId;
    if (dbhCMID === null || dbhCMID === 0) {
      throw new Error(`The DBH insertion's CoreMeasurementID is null, or 0, indicating that insertion was not successful`);
    }

    // Process Attributes and CMAttributes for codes
    const codesArray = rowData.codes.split(';').filter(code => code.trim());
    await processCode(connection, schema, codesArray, dbhCMID);

    // Commit transaction
    await connection.commit();
    return dbhCMID ?? null;
  } catch (error) {
    // Rollback transaction in case of error
    await connection.rollback();
    throw error;
  }
}
