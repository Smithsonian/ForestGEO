import { createError, handleUpsert } from '@/config/utils';
import { PersonnelResult, RoleResult } from '@/config/sqlrdsdefinitions/personnel';
import { SpecialProcessingProps } from '@/config/macros';
import { CensusPersonnelResult } from '@/config/sqlrdsdefinitions/zones';

export async function processPersonnel(props: Readonly<SpecialProcessingProps>) {
  const { connectionManager, rowData, schema, census } = props;
  if (!census) throw createError('CensusID missing', { census });
  if (!rowData.role) throw createError('Row data does not contain a role property', { rowData });

  const { firstname, lastname, role, roledescription } = rowData;

  try {
    // Normalize the role name
    const normalizedRole = role
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    const { id: roleID } = await handleUpsert<RoleResult>(
      connectionManager,
      schema,
      'roles',
      {
        RoleName: normalizedRole,
        RoleDescription: roledescription
      },
      'RoleID'
    );

    // Handle Personnel insertion/updation
    const personnelData = {
      FirstName: firstname,
      LastName: lastname,
      RoleID: roleID
    };

    await handleUpsert<PersonnelResult>(connectionManager, schema, 'personnel', personnelData, 'PersonnelID');
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
