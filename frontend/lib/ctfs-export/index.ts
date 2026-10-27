/**
 * Public API barrel for the CTFS export module.
 *
 * Re-exports precondition checks, measurement/attribute selection,
 * artifact rendering, and identifier utilities.
 */

export {
  checkFinishedCensus,
  exportableShortfallKind,
  partitionPreconditionFailures,
  isBlockingPreconditionKind,
  WARNING_PRECONDITION_KINDS,
  MIN_EXPORTABLE_FRACTION,
  type BlockingKindClassifier,
  type BlockingPreconditionKind,
  type PreconditionResult,
  type PreconditionFailure,
  type PreconditionFailureKind,
  type PublishBlockerCount
} from './precondition';
export { selectMeasurements, type SelectResult, type SelectInput } from './select-measurements';
export { countPublishPreconditions, countExportedRowsWithUnresolvedErrors, type PublishPreconditionCounts } from './export-preview';
export { renderArtifact, renderRebuildViewFullTableArtifact, type RenderArtifactInput, type RenderArtifactResult } from './render-procedure';
export { buildProcedureName, buildLockName, deterministicSuffix } from './identifier-safety';
export { exportableMeasurementBaseWhere, exportableMeasurementSelect } from './exportable-measurement';
