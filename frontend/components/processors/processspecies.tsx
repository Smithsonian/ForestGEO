import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import { booleanToBit } from '@/config/macros';

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
    let familyID;
    if (rowData.family) {
      const query = `INSERT INTO ${schema}.family (Family) VALUES (?) ON DUPLICATE KEY UPDATE FamilyID = LAST_INSERT_ID(FamilyID)`;
      const result = await runQuery(connection, query, [rowData.family]);
      familyID = result.insertId;
    }

    // Handle Genus insertion/updation
    let genusID;
    if (rowData.genus) {
      const query = `INSERT INTO ${schema}.genus (Genus, FamilyID) VALUES (?, ?) ON DUPLICATE KEY UPDATE GenusID = LAST_INSERT_ID(GenusID), FamilyID = VALUES(FamilyID)`;
      const result = await runQuery(connection, query, [rowData.genus, familyID]);
      genusID = result.insertId;
    }

    // Handle Species insertion/updation
    let speciesID;
    if (rowData.spcode) {
      const speciesData = {
        spcode: rowData.spcode,
        species: rowData.species,
        subspecies: rowData.subspecies,
        IDLevel: rowData.IDLevel,
        authority: rowData.authority,
        subauthority: rowData.subauthority,
        genusID: genusID
      };

      const cleanedSpeciesData = cleanInputData(speciesData);
      // "species": [{label: "spcode"}, {label: "family"}, {label: "genus"}, {label: "species"}, {label: "subspecies"}, {label: "idlevel"}, {label: "authority"}, {label: "subspeciesauthority"}],

      const query = `
        INSERT INTO ${schema}.species (SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, GenusID, CurrentTaxonFlag) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
        SpeciesName = VALUES(SpeciesName), 
        SubspeciesName = VALUES(SubspeciesName), 
        IDLevel = VALUES(IDLevel), 
        SpeciesAuthority = VALUES(SpeciesAuthority), 
        SubspeciesAuthority = VALUES(SubspeciesAuthority), 
        GenusID = VALUES(GenusID),
        CurrentTaxonFlag = VALUES(CurrentTaxonFlag)
      `;
      const result = await runQuery(connection, query, [
        cleanedSpeciesData.spcode,
        cleanedSpeciesData.species,
        cleanedSpeciesData.subspecies,
        cleanedSpeciesData.IDLevel,
        cleanedSpeciesData.authority,
        cleanedSpeciesData.subauthority,
        cleanedSpeciesData.genusID,
        booleanToBit(true),
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
