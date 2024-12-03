import { createError, createInsertOrUpdateQuery, createSelectQuery } from '@/config/utils';
import { PersonnelResult, RoleResult } from '@/config/sqlrdsdefinitions/personnel';
import { SpecialProcessingProps } from '@/config/macros';

export async function processPersonnel(props: Readonly<SpecialProcessingProps>) {
  const { connectionManager, rowData, schema, censusID } = props;
  if (!censusID) throw createError('CensusID missing', { censusID });
  if (!rowData.role) throw createError('Row data does not contain a role property', { rowData });

  const { firstname, lastname, role, roledescription } = rowData;

  try {
    // Normalize the role name
    const normalizedRole = role
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    // Handle Role insertion/updation
    const roleQuery = createSelectQuery<RoleResult>(schema, 'roles', { RoleName: normalizedRole });
    const existingRoles = await connectionManager.executeQuery(roleQuery, [normalizedRole]);

    let roleID;
    if (existingRoles.length > 0) {
      // If the role exists, update the description
      roleID = existingRoles[0].RoleID;
      const updateRoleQuery = `UPDATE \`${schema}\`.\`roles\` SET RoleDescription = ? WHERE RoleID = ?`;
      await connectionManager.executeQuery(updateRoleQuery, [roledescription, roleID]);
    } else {
      // If the role does not exist, insert a new role
      const insertRoleQuery = createInsertOrUpdateQuery<RoleResult>(schema, 'roles', {
        RoleName: normalizedRole,
        RoleDescription: roledescription
      });
      const insertResult = await connectionManager.executeQuery(insertRoleQuery, [normalizedRole, roledescription]);
      roleID = insertResult.insertId;
    }

    // Handle Personnel insertion/updation
    const personnelData = {
      CensusID: censusID,
      FirstName: firstname,
      LastName: lastname,
      RoleID: roleID
    };

    const personnelQuery = createSelectQuery<PersonnelResult>(schema, 'personnel', personnelData);
    const existingPersonnel = await connectionManager.executeQuery(personnelQuery, Object.values(personnelData));

    let personnelID;
    if (existingPersonnel.length > 0) {
      // If personnel exists, update the row
      personnelID = existingPersonnel[0].PersonnelID;
      const updatePersonnelQuery = createInsertOrUpdateQuery<PersonnelResult>(schema, 'personnel', personnelData);
      await connectionManager.executeQuery(updatePersonnelQuery, Object.values(personnelData));
    } else {
      // Insert new personnel record
      const insertPersonnelQuery = createInsertOrUpdateQuery<PersonnelResult>(schema, 'personnel', personnelData);
      const insertResult = await connectionManager.executeQuery(insertPersonnelQuery, Object.values(personnelData));
      personnelID = insertResult.insertId;
    }
    return personnelID;
  } catch (error: any) {
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
