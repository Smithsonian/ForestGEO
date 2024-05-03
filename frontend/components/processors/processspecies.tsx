import {booleanToBit} from "@/config/macros";
import {runQuery, SpecialProcessingProps} from "@/components/processors/processormacros";
import { selectOrInsertFamily, selectOrInsertGenus } from "./processorhelperfunctions";

export async function processSpecies(props: Readonly<SpecialProcessingProps>) {
  const {connection, rowData, schema} = props;
  try {

    /**
     * new species input form:
     *       "spcode": "Species.SpeciesCode",
     *       "family": "Species.Family", --> 1
     *       "genus": "Genus.Genus", --> 2
     *       "species": "Species.SpeciesName", --> 3
     *       "subspecies": "Species.SubspeciesName" --> OPTIONAL --> 4
     *       "IDLevel": "Species.IDLevel",
     *       "authority": "Species.SpeciesAuthority" --> OPTIONAL
     *       "subAuthority": "Species.SubspeciesAuthority" --> OPTIONAL
     */
    // check family
    let familyID: number | undefined = undefined;
    if (rowData.family) {
      familyID = await selectOrInsertFamily(connection, schema, rowData.family);
    }
    let genusID: number | undefined = undefined;
    if (rowData.genus) {
      genusID = await selectOrInsertGenus(connection, schema, rowData.genus, familyID);
    }

    // Insert or update Species
    await runQuery(connection, `
      INSERT INTO ${schema}.species (GenusID, SpeciesCode, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, FieldFamily, Description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      GenusID = VALUES(GenusID),
      SpeciesCode = VALUES(SpeciesCode),
      CurrentTaxonFlag = VALUES(CurrentTaxonFlag),
      ObsoleteTaxonFlag = VALUES(ObsoleteTaxonFlag),
      SpeciesName = VALUES(SpeciesName),
      SubspeciesName = VALUES(SubspeciesName)
      IDLevel = VALUES(IDLevel),
      SpeciesAuthority = VALUES(SpeciesAuthority),
      SubspeciesAuthority = VALUES (SubspeciesAuthority),
      FieldFamily = VALUES(FieldFamily),
      Description = VALUES(Description);
    `, [genusID,
      rowData.spcode,
      booleanToBit(true),
      booleanToBit(false),
      rowData.species ?? null,
      rowData.subspecies ?? null,
      rowData.IDLevel ?? null,
      rowData.authority ?? null,
      rowData.subAuthority ?? null,
      null,
      null]);
  } catch (error: any) {
    console.error('Error processing species:', error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
  return null;
}