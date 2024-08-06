// roles custom data type
import { ResultType } from '@/config/utils';

export type RolesRDS = {
  id?: number;
  roleID?: number;
  roleName?: string;
  description?: string;
};

export type RolesResult = ResultType<RolesRDS>;
