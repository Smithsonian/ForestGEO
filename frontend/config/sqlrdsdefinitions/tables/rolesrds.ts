// roles custom data type
import { ResultType } from '@/config/utils';

export type RoleRDS = {
  id?: number;
  roleID?: number;
  roleName?: string;
  description?: string;
};

export type RoleResult = ResultType<RoleRDS>;
