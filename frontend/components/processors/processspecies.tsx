import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import { booleanToBit } from '@/config/macros';
import { FamilyRDS, FamilyResult } from '@/config/sqlrdsdefinitions/tables/familyrds';
import { GenusRDS, GenusResult } from '@/config/sqlrdsdefinitions/tables/genusrds';
import { SpeciesRDS, SpeciesResult } from '@/config/sqlrdsdefinitions/tables/speciesrds';
import { createInsertOrUpdateQuery } from '@/config/utils';

function cleanInputData(data: any) {
  const cleanedData: any = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      cleanedData[key] = data[key] !== undefined ? data[key] : null;
    }
  }
  return cleanedData;
}

export async function processSpecies(props: Readonly<SpecialProcessingProps>): Promise<number | undefined> {
  const { connection, rowData, schema } = props;
  console.log('rowData: ', rowData);

  try {
    await connection.beginTransaction();

    // Handle Family insertion/updation
    let familyID: number | undefined;
    if (rowData.family) {
      const query = createInsertOrUpdateQuery<FamilyRDS, FamilyResult>(schema, 'family', { Family: rowData.family });
      const result = await runQuery(connection, query, [rowData.family]);
      familyID = result.insertId;
    }

    // Handle Genus insertion/updation
    let genusID: number | undefined;
    if (rowData.genus) {
      const query = createInsertOrUpdateQuery<GenusRDS, GenusResult>(schema, 'genus', { Genus: rowData.genus, FamilyID: familyID });
      const result = await runQuery(connection, query, [rowData.genus, familyID]);
      genusID = result.insertId;
    }

    // Handle Species insertion/updation
    let speciesID: number | undefined;
    if (rowData.spcode) {
      const speciesData = {
        speciesCode: rowData.spcode,
        speciesName: rowData.species,
        subspeciesName: rowData.subspecies,
        idLevel: rowData.IDLevel,
        speciesAuthority: rowData.authority,
        subspeciesAuthority: rowData.subauthority,
        genusID: genusID,
        currentTaxonFlag: booleanToBit(true),
      };

      const cleanedSpeciesData = cleanInputData(speciesData);
      const query = createInsertOrUpdateQuery<SpeciesRDS, SpeciesResult>(schema, 'species', cleanedSpeciesData);
      const result = await runQuery(connection, query, [
        cleanedSpeciesData.speciesCode,
        cleanedSpeciesData.speciesName,
        cleanedSpeciesData.subspeciesName,
        cleanedSpeciesData.idLevel,
        cleanedSpeciesData.speciesAuthority,
        cleanedSpeciesData.subspeciesAuthority,
        cleanedSpeciesData.genusID,
        cleanedSpeciesData.currentTaxonFlag,
      ]);
      speciesID = result.insertId;
    }

    await connection.commit();
    console.log('Upsert successful');
    return speciesID !== undefined ? speciesID : undefined;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw error;
  }
}
