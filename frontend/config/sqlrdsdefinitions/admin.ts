import { ResultType } from '@/config/utils';

export interface AdminUserRDS {
  id?: number;
  userID?: number;
  lastName?: string;
  firstName?: string;
  email?: string;
  userStatus?: string;
}

export type AdminUserResult = ResultType<AdminUserRDS>;

export interface AdminSiteRDS {
  id?: number;
  siteID?: number;
  siteName?: string;
  schemaName?: string;
  sqDimX?: number;
  sqDimY?: number;
  defaultUOMDBH?: string;
  defaultUOMHOM?: string;
  doubleDataEntry?: boolean;
}

export type AdminSiteResult = ResultType<AdminSiteRDS>;

export interface AdminUserSiteRelationRDS {
  id?: number;
  userSiteRelationID?: number;
  userID?: number;
  siteID?: number;
}

export type AdminUserSiteRelationResult = ResultType<AdminUserSiteRelationRDS>;
