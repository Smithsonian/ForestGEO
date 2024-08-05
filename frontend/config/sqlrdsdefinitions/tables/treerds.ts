// trees custom data type
import { ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';
import { bitToBoolean, booleanToBit, unitSelectionOptions } from '../../macros';

export type TreeRDS = {
  id?: number;
  treeID?: number;
  treeTag?: string;
  speciesID?: number;
};

export type TreeResult = ResultType<TreeRDS>;
