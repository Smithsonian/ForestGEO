/** Shared DBH-validation identity contract. Formula thresholds remain SQL-owned. */
export const DBH_CHANGE_VALIDATION_IDS = {
  growth: 1,
  shrinkage: 2
} as const;

export const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
export const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
export const DBH_CHANGE_PROCEDURE_NAMES = [DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE] as const;

export type DbhChangeKind = keyof typeof DBH_CHANGE_VALIDATION_IDS;
export type DbhChangeProcedureName = (typeof DBH_CHANGE_PROCEDURE_NAMES)[number];
export type DbhIntervalSkipReason = 'missing-date' | 'zero-interval' | 'negative-interval';

export interface DbhChangeSkipCounts {
  SkippedNoInterval: number;
  SkippedMissingDate: number;
  SkippedZeroInterval: number;
  SkippedNegativeInterval: number;
  SkippedBelowDbhFloor: number;
}
