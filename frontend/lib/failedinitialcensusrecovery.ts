export type FailedInitialCensusRecoveryState = {
  completedUploads: number;
  incompleteUploads: number;
  treeCount: number;
  stemCount: number;
  coreMeasurementCount: number;
};

export function shouldRecoverFailedInitialCensus(state: FailedInitialCensusRecoveryState): boolean {
  const hasResidualCensusData = state.treeCount > 0 || state.stemCount > 0 || state.coreMeasurementCount > 0;

  return state.completedUploads === 0 && state.incompleteUploads > 0 && hasResidualCensusData;
}
