// roles custom data type
import { ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';

export type RolesRDS = {
  id?: number;
  roleID?: number;
  roleName?: string;
  description?: string;
};

export type RolesResult = ResultType<RolesRDS>;
