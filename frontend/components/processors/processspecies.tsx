import { FamilyResult, GenusResult, SpeciesResult } from '@/lib/db/definitions/taxonomies';
import { createError, handleUpsert } from '@/config/utils';
import { SpecialProcessingProps } from '@/config/macros';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import { auditHandleUpsertResult } from '@/lib/changelog/reference-audit';

function cleanInputData(data: any) {
  const cleanedData: any = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      cleanedData[key] = data[key] !== undefined && data[key] !== '' ? data[key] : '';
    }
  }
  return cleanedData;
}

export async function processSpecies(props: Readonly<SpecialProcessingProps>): Promise<void> {
  const { connectionManager, rowData, schema, transactionID, fullName } = props;
  if (!transactionID) {
    throw createError('processSpecies requires a transactionID so family/genus/species writes and their changelog audit share the caller transaction', {
      rowData
    });
  }
  if (!fullName) {
    throw createError('processSpecies requires fullName (the resolved session identity) to attribute the changelog entry honestly', { rowData });
  }
  const changedBy = fullName.slice(0, CHANGED_BY_MAX_LENGTH);

  try {
    let familyID: number | undefined;
    if (rowData.family) {
      const familyResult = await handleUpsert<FamilyResult>(connectionManager, schema, 'family', { Family: rowData.family }, 'FamilyID', transactionID);
      familyID = familyResult.id;
      await auditHandleUpsertResult(connectionManager, schema, transactionID, 'family', 'FamilyID', familyResult, changedBy);
    }

    let genusID: number | undefined;
    if (rowData.genus && familyID) {
      const genusResult = await handleUpsert<GenusResult>(
        connectionManager,
        schema,
        'genus',
        { Genus: rowData.genus, FamilyID: familyID },
        'GenusID',
        transactionID
      );
      genusID = genusResult.id;
      await auditHandleUpsertResult(connectionManager, schema, transactionID, 'genus', 'GenusID', genusResult, changedBy);
    }

    if (rowData.spcode && genusID) {
      const speciesData = {
        SpeciesCode: rowData.spcode,
        SpeciesName: rowData.species,
        SubspeciesName: rowData.subspecies,
        IDLevel: rowData.idlevel,
        SpeciesAuthority: rowData.authority,
        SubspeciesAuthority: rowData.subauthority,
        GenusID: genusID
      };

      const cleanedSpeciesData = cleanInputData(speciesData);
      const speciesResult = await handleUpsert<SpeciesResult>(connectionManager, schema, 'species', cleanedSpeciesData, 'SpeciesID', transactionID);
      await auditHandleUpsertResult(connectionManager, schema, transactionID, 'species', 'SpeciesID', speciesResult, changedBy);
    }
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
