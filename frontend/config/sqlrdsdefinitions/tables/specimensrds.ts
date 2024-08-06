// specimens custom data type
import { ResultType } from '@/config/utils';

export type SpecimensRDS = {
  id?: number;
  specimenID?: number;
  stemID?: number;
  personnelID?: number;
  specimenNumber?: number;
  speciesID?: number;
  herbarium?: string;
  voucher?: number;
  collectionDate?: Date;
  determinedBy?: string;
  description?: string;
};

export type SpecimensResult = ResultType<SpecimensRDS>;
