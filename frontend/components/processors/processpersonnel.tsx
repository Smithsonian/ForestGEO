import { createError, createInsertOrUpdateQuery, createSelectQuery } from '@/config/utils';
import { runQuery, SpecialProcessingProps } from '@/components/processors/processormacros';
import { PersonnelResult, RoleResult } from '@/config/sqlrdsdefinitions/personnel';

export async function processPersonnel(props: Readonly<SpecialProcessingProps>) {
  const { connection, rowData, schema, censusID } = props;
  if (!censusID) throw createError('CensusID missing', { censusID });
  if (!rowData.role) throw createError('Row data does not contain a role property', { rowData });

  const { firstname, lastname, role, roledescription } = rowData;

  try {
    await connection.beginTransaction();

    // Normalize the role name
    const normalizedRole = role
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
    console.log('normalizedRole: ', normalizedRole);

    // Handle Role insertion/updation
    const roleQuery = createSelectQuery<RoleResult>(schema, 'roles', { RoleName: normalizedRole });
    console.log('role query: ', roleQuery);
    const existingRoles = await runQuery(connection, roleQuery, [normalizedRole]);
    console.log('existing roles: ', existingRoles);

    let roleID;
    if (existingRoles.length > 0) {
      console.log('role exists');
      // If the role exists, update the description
      roleID = existingRoles[0].RoleID;
      console.log('existing role id: ', roleID);
      const updateRoleQuery = `UPDATE \`${schema}\`.\`roles\` SET RoleDescription = ? WHERE RoleID = ?`;
      console.log('update role query: ', updateRoleQuery);
      await runQuery(connection, updateRoleQuery, [roledescription, roleID]);
      console.log('Role updated with description:', roledescription);
    } else {
      // If the role does not exist, insert a new role
      const insertRoleQuery = createInsertOrUpdateQuery<RoleResult>(schema, 'roles', {
        RoleName: normalizedRole,
        RoleDescription: roledescription
      });
      const insertResult = await runQuery(connection, insertRoleQuery, [normalizedRole, roledescription]);
      roleID = insertResult.insertId;
      console.log('New role inserted with RoleID:', roleID);
    }

    // Handle Personnel insertion/updation
    const personnelData = {
      CensusID: censusID,
      FirstName: firstname,
      LastName: lastname,
      RoleID: roleID
    };

    const personnelQuery = createSelectQuery<PersonnelResult>(schema, 'personnel', personnelData);
    const existingPersonnel = await runQuery(connection, personnelQuery, Object.values(personnelData));

    let personnelID;
    if (existingPersonnel.length > 0) {
      // If personnel exists, update the row
      personnelID = existingPersonnel[0].PersonnelID;
      const updatePersonnelQuery = createInsertOrUpdateQuery<PersonnelResult>(schema, 'personnel', personnelData);
      await runQuery(connection, updatePersonnelQuery, Object.values(personnelData));
      console.log('Personnel updated:', personnelID);
    } else {
      // Insert new personnel record
      const insertPersonnelQuery = createInsertOrUpdateQuery<PersonnelResult>(schema, 'personnel', personnelData);
      const insertResult = await runQuery(connection, insertPersonnelQuery, Object.values(personnelData));
      personnelID = insertResult.insertId;
      console.log('New personnel inserted with PersonnelID:', personnelID);
    }

    await connection.commit();
    console.log('Upsert successful. Personnel ID:', personnelID);
    return personnelID;
  } catch (error: any) {
    await connection.rollback();
    console.error('Upsert failed:', error.message);
    throw createError('Upsert failed', { error });
  }
}
