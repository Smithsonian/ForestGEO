/**
 * Artifact composer for the CTFS SQL export endpoint (app-side path).
 *
 * Orchestrates all stage renderers into a complete procedure artifact,
 * emitting unique procedure + lock names, metadata header, and conditional
 * reload cleanup + validation + insertion stages per the spec.
 */

import {
  renderProcedureEnvelope,
  renderStage0,
  renderStage0bReload,
  renderStage1,
  renderStage2,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage9DBHAttributes,
  renderStage10
} from '../csv-to-sql-v2';
import type { MeasurementStagingRow, AttributeStagingRow } from '../csv-to-sql-shared';
import { buildProcedureName, buildLockName } from './identifier-safety';

const MEASUREMENTS_TABLE = 'staging_measurements';
const ATTRIBUTES_TABLE = 'staging_attributes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderArtifactInput {
  schema: string;
  appPlotId: number;
  destinationPlotId: number;
  appCensusId: number;
  plotCensusNumber: string;
  allowReload: boolean;
  reloadDryRun: boolean;
  generatedAt: Date;
  measurementRows: MeasurementStagingRow[];
  attributeRows: AttributeStagingRow[];
}

export interface RenderArtifactResult {
  sql: string;
  procedureName: string;
  lockName: string;
}

// ---------------------------------------------------------------------------
// Main composer
// ---------------------------------------------------------------------------

/**
 * Compose a complete CTFS SQL export artifact.
 *
 * Emits a header with generation metadata and options, then:
 *
 *   1. Stage 0: Census existence guard
 *   2. Stage 0b: Reload cleanup (optional, conditional on allowReload || reloadDryRun)
 *   3. [DRY-RUN MODE STOPS HERE — remaining stages NOT emitted]
 *   4. Stages 1-10: Full validation and insertion pipeline
 *
 * The returned SQL is wrapped in a procedure envelope (DROP/CREATE/CALL/DROP)
 * with GET_LOCK/RELEASE_LOCK for cross-session synchronization.
 */
export function renderArtifact(input: RenderArtifactInput): RenderArtifactResult {
  const effectiveAllowReload = input.allowReload || input.reloadDryRun;
  const procedureName = buildProcedureName({
    destinationPlotId: input.destinationPlotId,
    plotCensusNumber: input.plotCensusNumber
  });
  const lockName = buildLockName({
    destinationPlotId: input.destinationPlotId,
    plotCensusNumber: input.plotCensusNumber
  });

  // Header carries generation metadata between BEGIN HEADER and END HEADER markers
  const header = [
    '-- BEGIN HEADER',
    `-- Generated: ${input.generatedAt.toISOString()}`,
    `-- Source schema: ${input.schema}`,
    `-- Source app PlotID: ${input.appPlotId}`,
    `-- Destination CTFS PlotID: ${input.destinationPlotId}`,
    `-- App CensusID: ${input.appCensusId}`,
    `-- PlotCensusNumber: ${input.plotCensusNumber}`,
    `-- Measurement rows: ${input.measurementRows.length}`,
    `-- Attribute rows: ${input.attributeRows.length}`,
    `-- Options: allowReload=${input.allowReload} reloadDryRun=${input.reloadDryRun}`,
    '-- END HEADER',
    ''
  ].join('\n');

  const stages: string[] = [
    renderStage0({
      destinationPlotId: input.destinationPlotId,
      censusNumber: input.plotCensusNumber,
      allowReload: effectiveAllowReload
    })
  ];

  // Reload cleanup is included when allowReload or reloadDryRun is true
  if (effectiveAllowReload) {
    stages.push(renderStage0bReload({ mode: input.reloadDryRun ? 'dry-run' : 'real' }));
  }

  // Dry-run mode stops here: Stage 0b's SAVEPOINT/ROLLBACK has undone the cleanup,
  // and the envelope's COMMIT closes the (now empty) transaction.
  // Stages 1-10 are not emitted.
  if (!input.reloadDryRun) {
    stages.push(
      renderStage1({
        measurementsTable: MEASUREMENTS_TABLE,
        attributesTable: ATTRIBUTES_TABLE,
        measurementRows: input.measurementRows,
        attributeRows: input.attributeRows
      }),
      renderStage2({ measurementsTable: MEASUREMENTS_TABLE, attributesTable: ATTRIBUTES_TABLE }),
      renderStage5({ measurementsTable: MEASUREMENTS_TABLE, attributesTable: ATTRIBUTES_TABLE }),
      renderStage6NewTrees({ measurementsTable: MEASUREMENTS_TABLE }),
      renderStage7NewStems({ measurementsTable: MEASUREMENTS_TABLE }),
      renderStage8DBH({ measurementsTable: MEASUREMENTS_TABLE }),
      renderStage9DBHAttributes({
        measurementsTable: MEASUREMENTS_TABLE,
        attributesTable: ATTRIBUTES_TABLE
      }),
      renderStage10({ measurementsTable: MEASUREMENTS_TABLE, attributesTable: ATTRIBUTES_TABLE })
    );
  }

  const body = stages.join('\n\n');

  // Wrap all stages in the procedure envelope (GET_LOCK, START TRANSACTION, etc.)
  const sql =
    header +
    renderProcedureEnvelope({
      procedureName,
      lockName,
      cursorDeclarations: [],
      body
    });

  return { sql, procedureName, lockName };
}
