// trees custom data type
import { ResultType } from '@/config/utils';

export type TreeRDS = {
  id?: number;
  treeID?: number;
  treeTag?: string;
  speciesID?: number;
};

export type TreeResult = ResultType<TreeRDS>;
