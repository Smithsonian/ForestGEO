// roles custom data type
import { IDataMapper } from '../../datamapper';

export type RolesRDS = {
  id?: number;
  roleID?: number;
  roleName?: string;
  description?: string;
};

export type RolesResult = {
  RoleID: any;
  RoleName: any;
  Description: any;
};

export class RolesMapper implements IDataMapper<RolesResult, RolesRDS> {
  mapData(results: RolesResult[], indexOffset: number = 1): RolesRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      roleID: item.RoleID != null ? Number(item.RoleID) : undefined,
      roleName: item.RoleName != null ? String(item.RoleName) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
    }));
  }
  demapData(results: RolesRDS[]): RolesResult[] {
    return results.map((item) => ({
      RoleID: item.roleID != undefined ? Number(item.roleID) : null,
      RoleName: item.roleName != undefined ? String(item.roleName) : null,
      Description: item.description != undefined ? String(item.description) : null,
    }));
  }
}

