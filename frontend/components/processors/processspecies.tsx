import { FamilyResult, GenusResult, SpeciesResult } from '@/config/sqlrdsdefinitions/taxonomies';
import { createError, handleUpsert } from '@/config/utils';
import { SpecialProcessingProps } from '@/config/macros';

function cleanInputData(data: any) {
  const cleanedData: any = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      cleanedData[key] = data[key] !== undefined && data[key] !== '' ? data[key] : null;
    }
  }
  return cleanedData;
}

export async function processSpecies(props: Readonly<SpecialProcessingProps>): Promise<void> {
  const { connectionManager, rowData, schema } = props;

  try {
    let familyID: number | undefined;
    if (rowData.family) {
      familyID = (await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family: rowData.family }, 'FamilyID')).id;
    }

    let genusID: number | undefined;
    if (rowData.genus) {
      genusID = (await handleUpsert<GenusResult>(connectionManager, schema, 'genus', { Genus: rowData.genus, FamilyID: familyID }, 'GenusID')).id;
    }

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
      await handleUpsert<SpeciesResult>(connectionManager, schema, 'species', cleanedSpeciesData, 'SpeciesID');
    }
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
