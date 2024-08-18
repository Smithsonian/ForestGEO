import { SpecialProcessingProps } from '@/components/processors/processormacros';
import { createError, handleUpsert } from '@/config/utils';
import { RoleResult } from '@/config/sqlrdsdefinitions/tables/rolesrds';
import { PersonnelResult } from '@/config/sqlrdsdefinitions/tables/personnelrds';

export async function processPersonnel(props: Readonly<SpecialProcessingProps>) {
  const { connection, rowData, schema, censusID } = props;
  if (!censusID) throw createError('CensusID missing', { censusID });
  if (!rowData.role) throw createError('Row data does not contain a role property', { rowData });

  try {
    await connection.beginTransaction();

    // Normalize the role name
    const normalizedRole = rowData.role
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
    console.log('normalizedRole: ', normalizedRole);

    // Handle Role insertion/updation
    const roleID = await handleUpsert<RoleResult>(connection, schema, 'roles', { RoleName: normalizedRole }, 'RoleID');

    // Handle Personnel insertion/updation
    const personnelData = {
      CensusID: censusID,
      FirstName: rowData.firstname,
      LastName: rowData.lastname,
      RoleID: roleID
    };

    const personnelID = await handleUpsert<PersonnelResult>(connection, schema, 'personnel', personnelData, 'PersonnelID');

    await connection.commit();
    console.log('Upsert successful. Personnel ID:', personnelID);
    return personnelID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
