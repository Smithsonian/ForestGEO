// reference custom data type
import { ResultType } from '@/config/utils';

export type ReferenceRDS = {
  id?: number;
  referenceID?: number;
  publicationTitle?: string;
  fullReference?: string;
  dateOfPublication?: Date;
};

export type ReferenceResult = ResultType<ReferenceRDS>;
