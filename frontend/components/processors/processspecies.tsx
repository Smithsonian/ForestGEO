import { SpecialProcessingProps } from '@/components/processors/processormacros';
import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { createError, handleUpsert } from '@/config/utils';

function cleanInputData(data: any) {
  const cleanedData: any = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      cleanedData[key] = data[key] !== undefined && data[key] !== '' ? data[key] : null;
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
      try {
        familyID = (await handleUpsert<FamilyResult>(connection, schema, 'family', { Family: rowData.family }, 'FamilyID')).id;
      } catch (error: any) {
        console.error('Family upsert failed:', error.message);
        throw createError('Family upsert failed', { error });
      }
    }

    // Handle Genus insertion/updation
    let genusID: number | undefined;
    if (rowData.genus) {
      try {
        genusID = (await handleUpsert<GenusResult>(connection, schema, 'genus', { Genus: rowData.genus, FamilyID: familyID }, 'GenusID')).id;
      } catch (error: any) {
        console.error('Genus upsert failed:', error.message);
        throw createError('Genus upsert failed', { error });
      }
    }

    // Handle Species insertion/updation
    let speciesID: number | undefined;
    if (rowData.spcode) {
      const speciesData = {
        SpeciesCode: rowData.spcode,
        SpeciesName: rowData.species,
        SubspeciesName: rowData.subspecies,
        IDLevel: rowData.IDLevel,
        SpeciesAuthority: rowData.authority,
        SubspeciesAuthority: rowData.subauthority,
        GenusID: genusID
      };

      const cleanedSpeciesData = cleanInputData(speciesData);
      console.log('Cleaned species data: ', cleanedSpeciesData);

      try {
        speciesID = (await handleUpsert<SpeciesResult>(connection, schema, 'species', cleanedSpeciesData, 'SpeciesID')).id;
      } catch (error: any) {
        console.error('Species upsert failed:', error.message);
        throw createError('Species upsert failed', { error });
      }
    }

    await connection.commit();
    console.log('Upsert successful');
    return speciesID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
