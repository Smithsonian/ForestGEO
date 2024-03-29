import {booleanToBit} from '@/config/macros';
import {runQuery, SpecialProcessingProps,} from '@/components/processors/processormacros';
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
  const {connection, rowData, schema, plotID, censusID, fullName, unitOfMeasurement} = props;
  if (!plotID || !censusID || !fullName) throw new Error("Missing plotID, censusID, or full name");
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

    console.log('extracting quadrat ID by quadrat name');
    const quadratID = await getColumnValueByColumnName(
      connection,
      schema,
      'Quadrats',
      'QuadratID',
      'QuadratName',
      rowData.quadrat
    );
    if (!quadratID) throw new Error(`Quadrat with name ${rowData.quadrat} does not exist.`);
    console.log(`quadratID: ${quadratID}`);

    console.log('attempting subspecies ID by speciesID');
    let subSpeciesID = null;
    if (speciesID) subSpeciesID = await getSubSpeciesID(connection, schema, parseInt(speciesID));
    if (!subSpeciesID) console.log('no subspeciesID found');

    // Insert or update Trees with SpeciesID and SubSpeciesID
    const treeID = await processTrees(connection, schema, rowData.tag, speciesID, subSpeciesID ?? null);
    if (treeID === null) throw new Error(`Tree with tag ${rowData.tag} does not exist.`);
    console.log(`treeID: ${treeID}`);

    // Insert or update Stems
    const stemID = await processStems(connection, schema, rowData.stemtag, treeID, quadratID, rowData.lx, rowData.ly);
    if (stemID === null) throw new Error(`Insertion failure at processStems with data: ${[rowData.stemtag, treeID, quadratID, rowData.lx, rowData.ly]}`)
    console.log(`stemID: ${stemID}`);

    const personnelID = await getPersonnelIDByName(connection, schema, fullName);
    if (personnelID === null) throw new Error(`PersonnelID for personnel with name ${fullName} does not exist`);
    console.log(`personnelID: ${personnelID}`);

    // Enhanced date handling
    const parseDate = (dateString: string): Date | null => {
      // Define an array of date formats to try
      const formats = ['MM-DD-YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'YYYY-DD-MM'];
      for (const format of formats) {
        if (moment(dateString, format, true).isValid()) {
          return moment(dateString, format).toDate();
        }
      }
      return null; // Return null if none of the formats match
    };

    const measurementDate = parseDate(rowData.date);

    const measurementInsertQuery = `
    INSERT INTO ${schema}.coremeasurements
    (CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const dbhResult = await runQuery(connection, measurementInsertQuery, [
      censusID,
      plotID,
      quadratID,
      treeID,
      stemID,
      personnelID,
      booleanToBit(false), // isValidated is false by default
      measurementDate,
      rowData.dbh ?? null,
      rowData.hom ?? null,
      null,
      JSON.stringify({units: unitOfMeasurement}) ?? null,
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
