// family custom data type
import { ResultType } from '@/config/utils';

export type FamilyRDS = {
  id?: number;
  familyID?: number;
  family?: string;
  referenceID?: number;
};

export type FamilyResult = ResultType<FamilyRDS>;
