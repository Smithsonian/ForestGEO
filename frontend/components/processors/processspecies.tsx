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
  const { connectionManager, rowData, schema } = props;
  console.log('rowData: ', rowData);

  try {
    let familyID: number | undefined;
    if (rowData.family) {
      familyID = (await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family: rowData.family }, 'FamilyID')).id;
    }

    let genusID: number | undefined;
    if (rowData.genus) {
      genusID = (await handleUpsert<GenusResult>(connectionManager, schema, 'genus', { Genus: rowData.genus, FamilyID: familyID }, 'GenusID')).id;
    }

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

      speciesID = (await handleUpsert<SpeciesResult>(connectionManager, schema, 'species', cleanedSpeciesData, 'SpeciesID')).id;
    }

    console.log('Upsert successful');
    return speciesID;
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
