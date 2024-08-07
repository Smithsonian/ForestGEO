import { ResultType } from '@/config/utils';

export type UnifiedChangelogRDS = {
  id?: number;
  changeID?: number;
  tableName?: string;
  recordID?: string;
  operation?: string;
  oldRowState?: Record<string, any>;
  newRowState?: Record<string, any>;
  changeTimestamp?: Date;
  changedBy?: string;
};

export type UnifiedChangelogResult = ResultType<UnifiedChangelogRDS>;
