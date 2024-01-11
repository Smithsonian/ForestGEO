import sql from "mssql";
import {RowDataStructure} from "@/config/macros";
import {getColumnValueByColumnName} from "@/components/processors/processorhelpers";

export async function processSpecies(conn: sql.ConnectionPool, rowData: RowDataStructure, plotKey: string) {
  const transaction = new sql.Transaction(conn);
  await transaction.begin();

  const request = new sql.Request(transaction || conn);

  try {
    // Check if Genus exists, insert if not
    const genusID = await getColumnValueByColumnName(
      transaction,
      'forestgeo.Genus',
      'GenusID',
      'GenusName',
      rowData.genus
    );

    if (!genusID) {
      // Insert into Genus table if genus does not exist
      await request.input('GenusName', sql.VarChar, rowData.genus)
        .query(`
                    INSERT INTO forestgeo.Genus (GenusName)
                    VALUES (@GenusName);
                  `);
    }

    // Insert or update Species
    await request
      .input('SpeciesCode', sql.VarChar, rowData.spcode)
      .input('SpeciesName', sql.VarChar, rowData.species)
      .input('IDLevel', sql.VarChar, rowData.IDLevel)
      .input('FieldFamily', sql.VarChar, rowData.family)
      .input('Authority', sql.VarChar, rowData.authority)
      .query(`
        MERGE INTO forestgeo.Species AS target
        USING (VALUES (@SpeciesCode, @SpeciesName, @IDLevel, @FieldFamily, @Authority)) AS source (SpeciesCode, SpeciesName, IDLevel, FieldFamily, Authority)
        ON target.SpeciesCode = source.SpeciesCode
        WHEN NOT MATCHED THEN
          INSERT (SpeciesCode, SpeciesName, IDLevel, FieldFamily, Authority)
          VALUES (@SpeciesCode, @SpeciesName, @IDLevel, @FieldFamily, @Authority);
      `);

    // Insert or update SubSpecies if provided
    if (rowData.subspecies) {
      await request
        .input('SubSpeciesName', sql.VarChar, rowData.subspecies)
        .query(`
          INSERT INTO forestgeo.SubSpecies (SubSpeciesName, SpeciesID)
          VALUES (@SubSpeciesName, (SELECT SpeciesID FROM forestgeo.Species WHERE SpeciesCode = @SpeciesCode));
        `);
    }

    // Commit transaction
    await transaction.commit();
  } catch (error) {
    // Rollback transaction in case of error
    await transaction.rollback();
    throw error;
  }
}