/// <reference types="cypress" />

// Shared Cypress mock for the edit-plan save flow (`hooks/useEditPreviewFlow.ts`).
//
// Row edits in the measurements grids and the Errors Explorer no longer PATCH
// `/api/fixeddata/...`. They POST `/api/edits/preview` to build an EditPlan,
// then POST `/api/edits/apply` to commit it. An `info`-severity plan auto-applies;
// anything higher (a SpeciesCode change is `warn`) opens the PreviewDialog and
// applies only when the user clicks its Apply button
// (`[data-testid="edit-preview-apply"]`).

export interface EditPlanApplyContext {
  targetID: number;
  // The canonical-keyed diff the app sends, e.g. { SpeciesCode: 'ANOPKL' } on the
  // measurementssummary surface, { SpCode: 'ANOPKL' } on failedmeasurements.
  newRow: Record<string, unknown>;
  dataType: string;
}

export interface EditPlanApplyResponse {
  statusCode?: number;
  body?: Record<string, unknown>;
}

export interface MockEditPlanFlowOptions {
  // Called when the app POSTs /api/edits/apply. Use it to mutate test row state
  // and/or return a failure (e.g. { statusCode: 500, body: { message } }). A
  // void/undefined return yields a default success ApplyResult.
  onApply: (context: EditPlanApplyContext) => EditPlanApplyResponse | void;
  // Severity the preview reports. `warn` (default) opens the confirmation dialog;
  // `info` auto-applies with no dialog. A SpeciesCode edit is `warn` in the app.
  maxSeverity?: 'info' | 'warn' | 'destructive';
}

/**
 * Intercepts the edit-plan preview/apply endpoints. Aliases: `@previewEdit`,
 * `@applyEdit`. With the default `warn` severity, the caller's spec must click
 * the PreviewDialog's Apply button (`[data-testid="edit-preview-apply"]`) after
 * committing the grid edit to trigger `@applyEdit`.
 */
export function mockEditPlanFlow({ onApply, maxSeverity = 'warn' }: MockEditPlanFlowOptions) {
  cy.intercept('POST', '**/api/edits/preview', req => {
    const { targetID, newRow, dataType } = (req.body ?? {}) as { targetID: number; newRow: Record<string, unknown>; dataType?: string };
    const fieldChanges = Object.entries(newRow ?? {}).map(([field, to]) => ({ field, from: null, to }));
    req.reply({
      statusCode: 200,
      body: {
        dataType: dataType ?? 'measurementssummary',
        targetID,
        fieldChanges,
        effects: [
          {
            id: 'R1a',
            severity: maxSeverity,
            category: 'identity',
            title: 'Edit preview',
            detail: 'Test edit plan.',
            affectedTable: 'coremeasurements',
            affectedRowCount: 1
          }
        ],
        canApply: true,
        maxSeverity,
        planHash: 'test-plan-hash',
        generatedAt: '2026-01-01T00:00:00.000Z'
      }
    });
  }).as('previewEdit');

  cy.intercept('POST', '**/api/edits/apply', req => {
    const { targetID, newRow, dataType } = (req.body ?? {}) as { targetID: number; newRow: Record<string, unknown>; dataType?: string };
    const response = onApply({ targetID, newRow, dataType: dataType ?? 'measurementssummary' });
    req.reply({
      statusCode: response?.statusCode ?? 200,
      body: response?.body ?? {
        updatedIDs: { measurementssummary: targetID },
        applyErrors: [],
        editOperationID: 1,
        validationPending: false
      }
    });
  }).as('applyEdit');
}

// Maps a canonical edit-plan diff back onto camelCase grid-row fields so mock
// state can be updated. Only the taxonomic identity field needs remapping today;
// other canonical names already match the row keys.
const CANONICAL_TO_ROW_FIELD: Record<string, string> = {
  SpeciesCode: 'speciesCode',
  SpCode: 'speciesCode'
};

export function canonicalDiffToRowPatch(newRow: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(newRow ?? {})) {
    patch[CANONICAL_TO_ROW_FIELD[key] ?? key] = value;
  }
  return patch;
}
