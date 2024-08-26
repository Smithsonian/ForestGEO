// roles custom data type
import { createInitialObject, ResultType } from '@/config/utils';

export type RoleRDS = {
  id?: number;
  roleID?: number;
  roleName?: string;
  roleDescription?: string;
};

export type RoleResult = ResultType<RoleRDS>;

export const initialRoleRDSRow = createInitialObject<RoleRDS>();
