import {FileRow, RowDataStructure} from "@/config/macros";
import {PoolConnection} from 'mysql2/promise';

export async function processSpecies(connection: PoolConnection, rowData: FileRow, plotKey: string, censusID: string, fullName: string) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    // Check if Genus exists, insert if not
    const [genusRows] = await connection.execute(`
      SELECT GenusID FROM ${schema}.Genus WHERE GenusName = ?;
    `, [rowData.genus]) as any;

    let genusID = null;
    if (genusRows.length === 0) {
      // Insert into Genus table if genus does not exist
      const [insertGenusResult] = await connection.execute(`
        INSERT INTO ${schema}.Genus (GenusName)
        VALUES (?);
      `, [rowData.genus]) as any;

      genusID = insertGenusResult.insertId;
    } else {
      genusID = genusRows[0].GenusID;
    }

    // Insert or update Species
    await connection.execute(`
      INSERT INTO ${schema}.Species (SpeciesCode, SpeciesName, IDLevel, FieldFamily, Authority)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      SpeciesCode = VALUES(SpeciesCode),
      SpeciesName = VALUES(SpeciesName),
      IDLevel = VALUES(IDLevel),
      FieldFamily = VALUES(FieldFamily),
      Authority = VALUES(Authority);
    `, [rowData.spcode, rowData.species, rowData.IDLevel, rowData.family, rowData.authority]);

    // Insert or update SubSpecies if provided
    if (rowData.subspecies) {
      await connection.execute(`
        INSERT INTO ${schema}.SubSpecies (SubSpeciesName, SpeciesID)
        VALUES (?, (SELECT SpeciesID FROM ${schema}.Species WHERE SpeciesCode = ?))
        ON DUPLICATE KEY UPDATE
        SubSpeciesName = VALUES(SubSpeciesName);
      `, [rowData.subspecies, rowData.spcode]);
    }
  } catch (error: any) {
    console.error('Error processing species:', error.message);
    throw error;
  }
}