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
  renderStage10,
  renderPostLoadViewFullTableCall
} from '../csv-to-sql-v2';
import type { MeasurementStagingRow, AttributeStagingRow } from '../csv-to-sql-shared';
import type { PreconditionFailure } from './precondition';
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
  /**
   * Precondition failures to surface as NON-BLOCKING warnings in a dry-run
   * artifact header (D6). Ignored for non-dry-run renders. Each line names the
   * kind, message, and the sampled CoreMeasurementIDs (capped upstream).
   */
  preconditionWarnings?: PreconditionFailure[];
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
  // Procedure name suffix hashes all input keys so concurrent exports from
  // different source schemas to the same destination produce distinct
  // procedure identifiers (spec line 413 open question).
  const procedureName = buildProcedureName({
    destinationPlotId: input.destinationPlotId,
    plotCensusNumber: input.plotCensusNumber,
    schema: input.schema,
    appPlotId: input.appPlotId,
    appCensusId: input.appCensusId
  });
  const lockName = buildLockName({
    destinationPlotId: input.destinationPlotId,
    plotCensusNumber: input.plotCensusNumber
  });

  // Header carries generation metadata between BEGIN HEADER and END HEADER markers
  const warningLines =
    input.reloadDryRun && input.preconditionWarnings && input.preconditionWarnings.length > 0
      ? [
          '-- DRY-RUN PRECONDITION WARNINGS (would block a real publish):',
          ...input.preconditionWarnings.map(w => `--   ${w.kind} - ${w.message} - listed CoreMeasurementIDs: ${w.coreMeasurementIds.join(', ')}`)
        ]
      : [];

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
    ...warningLines,
    '-- END HEADER',
    ''
  ].join('\n');

  const stages: string[] = [
    renderStage0({
      destinationPlotId: input.destinationPlotId,
      censusNumber: input.plotCensusNumber,
      allowReload: effectiveAllowReload,
      includeViewFullTableProbe: false
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

  // The publish artifact no longer rebuilds ViewFullTable (D5): the rebuild is a
  // separate operator-triggered step (renderRebuildViewFullTableArtifact). The
  // publish path therefore emits neither the CreateFullView install probe (see
  // includeViewFullTableProbe: false above) nor the post-load CALL.
  const envelope = renderProcedureEnvelope({
    procedureName,
    lockName,
    cursorDeclarations: [],
    body
  });

  const sql = header + envelope;

  return { sql, procedureName, lockName };
}

// ---------------------------------------------------------------------------
// Standalone ViewFullTable rebuild artifact (D5)
// ---------------------------------------------------------------------------

const REBUILD_PROBE_PROCEDURE = 'rebuild_viewfulltable_probe';

/**
 * Compose the standalone "Rebuild ViewFullTable" artifact.
 *
 * Decoupled from publish (D5): the publish artifact no longer rebuilds the
 * reporting view, so operators run this separately after confirming a load.
 *
 * The artifact is INPUT-INDEPENDENT — it carries no plot/census/destination
 * fields and no timestamp, so it is byte-identical for every caller (only the
 * endpoint's audit record varies). The rebuild targets DATABASE(), so it
 * rebuilds whichever destination DB the operator runs it against.
 *
 * The CreateFullView install probe SIGNALs (with the install hint) if the
 * helper is missing. SIGNAL and the declared scalar are only valid inside a
 * compound statement, so the probe is wrapped in a real one-shot procedure
 * (CREATE / CALL / DROP) rather than pasted at top level. The actual rebuild
 * CALL runs AFTER the probe procedure is dropped — CreateFullView does DDL
 * (DROP/CREATE TABLE) and must not run inside another procedure's transaction.
 */
export function renderRebuildViewFullTableArtifact(): string {
  const probe = `DROP PROCEDURE IF EXISTS ${REBUILD_PROBE_PROCEDURE};

DELIMITER //
CREATE PROCEDURE ${REBUILD_PROBE_PROCEDURE}()
BEGIN
  DECLARE _viewfulltable_installed INT DEFAULT 0;

  -- Fail fast if the destination has not installed the rebuild helper.
  SELECT COUNT(*) INTO _viewfulltable_installed
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = 'ctfsweb_webuser'
      AND ROUTINE_NAME = 'CreateFullView'
      AND ROUTINE_TYPE = 'PROCEDURE';
  IF _viewfulltable_installed = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ctfsweb_webuser.CreateFullView missing. Source creating_ViewFullTable.sql into the destination MySQL, then retry.';
  END IF;
END //
DELIMITER ;

CALL ${REBUILD_PROBE_PROCEDURE}();
DROP PROCEDURE ${REBUILD_PROBE_PROCEDURE};
`;

  // renderPostLoadViewFullTableCall() emits the CALL + status SELECT.
  return probe + '\n' + renderPostLoadViewFullTableCall();
}
