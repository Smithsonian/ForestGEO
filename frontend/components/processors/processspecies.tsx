import {booleanToBit} from "@/config/macros";
import {runQuery, SpecialProcessingProps} from "@/components/processors/processormacros";

export async function processSpecies(props: Readonly<SpecialProcessingProps>) {
  const {connection, rowData} = props;
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  try {
    const genusResult = await runQuery(connection, `
      SELECT GenusID FROM ${schema}.Genus WHERE Genus = ?;
    `, [rowData.genus]);

    const genusID = genusResult[0].GenusID;

    /**
     *       "spcode": "Species.SpeciesCode",
     *       "genus": "Genus.Genus",
     *       "species": "Species.SpeciesName",
     *       "IDLevel": "Species.IDLevel",
     *       "family": "Species.Family", --> OPTIONAL
     *       "authority": "Species.Authority" --> OPTIONAL
     */

    // Insert or update Species
    await runQuery(connection, `
      INSERT INTO ${schema}.Species (GenusID, SpeciesCode, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, IDLevel, Authority, FieldFamily, Description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      GenusID = VALUES(GenusID),
      SpeciesCode = VALUES(SpeciesCode),
      CurrentTaxonFlag = VALUES(CurrentTaxonFlag),
      ObsoleteTaxonFlag = VALUES(ObsoleteTaxonFlag),
      SpeciesName = VALUES(SpeciesName),
      IDLevel = VALUES(IDLevel),
      Authority = VALUES(Authority),
      FieldFamily = VALUES(FieldFamily),
      Description = VALUES(Description);
    `, [genusID,
      rowData.spcode ?? null,
      booleanToBit(true),
      booleanToBit(false),
      rowData.species ?? null,
      rowData.IDLevel ?? null,
      rowData.authority ?? null,
      rowData.family ?? null,
      null]);
  } catch (error: any) {
    console.error('Error processing species:', error.message);
    throw error;
  }
}