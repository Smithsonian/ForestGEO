// genus custom data type
import { ResultType } from '@/config/utils';

export type GenusRDS = {
  id?: number;
  genusID?: number;
  familyID?: number;
  genus?: string;
  referenceID?: number;
  genusAuthority?: string;
};

export type GenusResult = ResultType<GenusRDS>;
