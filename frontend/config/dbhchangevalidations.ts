/** Shared DBH-validation identity contract. Formula thresholds remain SQL-owned. */
export const DBH_CHANGE_VALIDATION_IDS = {
  growth: 1,
  shrinkage: 2
} as const;

export const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
export const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
export const DBH_CHANGE_PROCEDURE_NAMES = [DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE] as const;

export const DBH_CHANGE_VALIDATION_ID_LIST = [DBH_CHANGE_VALIDATION_IDS.growth, DBH_CHANGE_VALIDATION_IDS.shrinkage] as const;
export type DbhChangeValidationID = (typeof DBH_CHANGE_VALIDATION_ID_LIST)[number];

export const DBH_CHANGE_PROCEDURE_BY_VALIDATION_ID: ReadonlyMap<DbhChangeValidationID, (typeof DBH_CHANGE_PROCEDURE_NAMES)[number]> = new Map([
  [DBH_CHANGE_VALIDATION_IDS.growth, DBH_GROWTH_PROCEDURE],
  [DBH_CHANGE_VALIDATION_IDS.shrinkage, DBH_SHRINKAGE_PROCEDURE]
]);

export function isDbhChangeValidationID(validationID: number): validationID is DbhChangeValidationID {
  return (DBH_CHANGE_VALIDATION_ID_LIST as readonly number[]).includes(validationID);
}

export type DbhChangeKind = keyof typeof DBH_CHANGE_VALIDATION_IDS;
export type DbhChangeProcedureName = (typeof DBH_CHANGE_PROCEDURE_NAMES)[number];
export type DbhIntervalSkipReason = 'negative-interval' | 'implausible-interval';
export type DbhComparisonBasis = 'annualised' | 'absolute';

export interface DbhChangeSkipCounts {
  SkippedNoInterval: number;
  SkippedNegativeInterval: number;
  SkippedImplausibleInterval: number;
  SkippedBelowDbhFloor: number;
}

/** Mirrors cMinDbhMm in BuildDBHChangePairs; comparisons below it are skipped, not judged. */
export const DBH_COMPARISON_FLOOR_MM = 10;

/** User-facing notice for DBH comparisons excluded by the floor, or null when none were. */
export function describeDbhFloorSkips(skippedBelowDbhFloor: number): string | null {
  if (skippedBelowDbhFloor <= 0) return null;
  const comparisons = skippedBelowDbhFloor === 1 ? '1 DBH comparison was' : `${skippedBelowDbhFloor} DBH comparisons were`;
  return `${comparisons} skipped because a diameter is missing or under ${DBH_COMPARISON_FLOOR_MM} mm after unit conversion. If this is unexpected, check the plot's DBH units.`;
}
