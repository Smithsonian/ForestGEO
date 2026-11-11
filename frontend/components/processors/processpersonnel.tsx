import { createError, handleUpsert } from '@/config/utils';
import { PersonnelResult, RoleResult } from '@/lib/db/definitions/personnel';
import { SpecialProcessingProps } from '@/config/macros';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import { auditHandleUpsertResult } from '@/lib/changelog/reference-audit';

export async function processPersonnel(props: Readonly<SpecialProcessingProps>) {
  const { connectionManager, rowData, schema, transactionID, fullName } = props;
  if (!rowData.role) throw createError('Row data does not contain a role property - role is required for personnel processing', { rowData });
  if (!transactionID) {
    throw createError('processPersonnel requires a transactionID so personnel/role writes and their changelog audit share the caller transaction', {
      rowData
    });
  }
  if (!fullName) {
    throw createError('processPersonnel requires fullName (the resolved session identity) to attribute the changelog entry honestly', { rowData });
  }
  const changedBy = fullName.slice(0, CHANGED_BY_MAX_LENGTH);

  const { firstname, lastname, role, roledescription } = rowData;

  try {
    // Normalize the role name
    const normalizedRole = role
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    const roleResult = await handleUpsert<RoleResult>(
      connectionManager,
      schema,
      'roles',
      {
        RoleName: normalizedRole,
        RoleDescription: roledescription
      },
      'RoleID',
      transactionID
    );
    const { id: roleID } = roleResult;
    await auditHandleUpsertResult(connectionManager, schema, transactionID, 'roles', 'RoleID', roleResult, changedBy);

    // Handle Personnel insertion/updation
    const personnelData = {
      FirstName: firstname,
      LastName: lastname,
      RoleID: roleID
    };

    const personnelResult = await handleUpsert<PersonnelResult>(connectionManager, schema, 'personnel', personnelData, 'PersonnelID', transactionID);
    await auditHandleUpsertResult(connectionManager, schema, transactionID, 'personnel', 'PersonnelID', personnelResult, changedBy);
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
