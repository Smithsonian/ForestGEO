/// <reference types="cypress" />

import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { buildMeasurementsSummaryRow, buildViewFullTableRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';
// The leaf module, not measurementscommonsutils: that one reaches config/macros.ts, which imports CSS the e2e bundler can't load.
import { ROW_UPDATED_MESSAGE } from '@/components/datagrids/rowmutationmessages';

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function buildSharedRows() {
  const summaryRow = buildMeasurementsSummaryRow({
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    isValidated: false,
    description: 'Invalid species reference',
    userDefinedFields: 'old tree'
  });

  const fullRow = buildViewFullTableRow({
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    isValidated: false,
    description: 'Invalid species reference',
    userDefinedFields: 'old tree'
  });

  const errorRow = buildErrorsExplorerRow({
    id: 1,
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    primaryErrorMessage: 'Invalid species reference',
    errorMessages: ['Invalid species reference'],
    errorSources: ['validation'],
    errorFields: ['speciesCode'],
    errorCodes: ['INVALID_SPECIES'],
    description: 'Invalid species reference'
  });

  return { summaryRow, fullRow, errorRow };
}

// Shared forward-save sequence reused by the undo (#427) cases below: builds
// the same 3-stem TREE900 tree as the sibling-count case above, drives the
// real species correction through the UI (non-freeSolo autocomplete option
// selection, the grid's Confirm Changes dialog, then the preview Apply), and
// leaves the just-applied UndoToast on screen. `appliedEditOperationID` lets
// each undo case assert against a known, non-hardcoded applied operation ID.
function performTreeWideSpeciesCorrectionAndApply(appliedEditOperationID: number) {
  const TREE_TAG = 'TREE900';
  const OLD_SPECIES_CODE = 'ACERRU';
  const NEW_SPECIES_CODE = 'QUERCO';
  const TARGET_TREE_ID = 7700;
  const SIBLING_COUNT = 3;
  const FORWARD_PLAN_HASH = 'a1'.repeat(32);

  const siblingStemOne = buildMeasurementsSummaryRow({
    coreMeasurementID: 901,
    treeTag: TREE_TAG,
    stemTag: 'S1',
    speciesCode: OLD_SPECIES_CODE,
    quadratName: 'Q0101'
  });
  const siblingStemTwo = buildMeasurementsSummaryRow({
    coreMeasurementID: 902,
    treeTag: TREE_TAG,
    stemTag: 'S2',
    speciesCode: OLD_SPECIES_CODE,
    quadratName: 'Q0101'
  });
  const siblingStemThree = buildMeasurementsSummaryRow({
    coreMeasurementID: 903,
    treeTag: TREE_TAG,
    stemTag: 'S3',
    speciesCode: OLD_SPECIES_CODE,
    quadratName: 'Q0101'
  });

  const state = mockMeasurementHubWorkflowApi({
    summaryRows: [siblingStemOne, siblingStemTwo, siblingStemThree]
  });

  // Same rationale as the #427 case above: the speciesCode editor is a
  // non-freeSolo Autocomplete, so NEW_SPECIES_CODE must be a selectable option.
  cy.intercept('GET', '**/api/fetchall/species/**', {
    statusCode: 200,
    body: [{ SpeciesCode: OLD_SPECIES_CODE }, { SpeciesCode: NEW_SPECIES_CODE }]
  }).as('fetchSpeciesLookup');

  const FORWARD_EFFECT_DETAIL =
    `Tree T#${TARGET_TREE_ID} (TreeTag "${TREE_TAG}") species "${OLD_SPECIES_CODE}" -> "${NEW_SPECIES_CODE}". ` +
    `${SIBLING_COUNT} stem(s) (${SIBLING_COUNT} active, 0 inactive) and ${SIBLING_COUNT} measurement(s) (${SIBLING_COUNT} active, 0 inactive) will show the corrected species.`;

  cy.intercept('POST', '**/api/edits/preview', req => {
    const { targetID, newRow, dataType } = (req.body ?? {}) as { targetID: number; newRow: Record<string, unknown>; dataType?: string };
    req.reply({
      statusCode: 200,
      body: {
        dataType: dataType ?? 'measurementssummary',
        targetID,
        fieldChanges: [{ field: 'SpeciesCode', from: OLD_SPECIES_CODE, to: newRow.SpeciesCode }],
        effects: [
          {
            id: 'R1a',
            severity: 'warn',
            category: 'identity',
            title: 'Tree species will be corrected',
            detail: FORWARD_EFFECT_DETAIL,
            affectedTable: 'trees',
            affectedRowCount: 1
          }
        ],
        canApply: true,
        maxSeverity: 'warn',
        planHash: FORWARD_PLAN_HASH,
        generatedAt: '2026-01-01T00:00:00.000Z'
      }
    });
  }).as('previewEdit');

  // Filled in by the apply intercept below once the real request lands, so
  // later undo-revert assertions can compare against actual selected-context
  // values instead of a hardcoded plotID/censusID.
  const applyRequestScope: { plotID: number | null; censusID: number | null } = { plotID: null, censusID: null };

  cy.intercept('POST', '**/api/edits/apply', req => {
    const { targetID, newRow, plotID, censusID } = (req.body ?? {}) as {
      targetID: number;
      newRow: Record<string, unknown>;
      plotID: number;
      censusID: number;
    };
    applyRequestScope.plotID = plotID;
    applyRequestScope.censusID = censusID;
    state.summaryRows = state.summaryRows.map(row => (row.treeTag === TREE_TAG ? { ...row, speciesCode: newRow.SpeciesCode as string } : row));
    req.reply({
      statusCode: 200,
      body: {
        updatedIDs: { CoreMeasurementID: targetID },
        applyErrors: [],
        editOperationID: appliedEditOperationID,
        validationPending: false
      }
    });
  }).as('applyEdit');

  selectDefaultCensusContext();
  cy.openCensusHubLink('View Data');

  cy.wait('@fetchMeasurementHubSummaryRows');
  cy.wait('@fetchSpeciesLookup');

  const EDITED_ROW_SELECTOR = '[role="row"][data-id="901"]';
  cy.get(EDITED_ROW_SELECTOR).find('button[aria-label="Edit this row"]').click({ force: true });
  cy.get(EDITED_ROW_SELECTOR).find('[data-field="speciesCode"] input').clear({ force: true }).type(NEW_SPECIES_CODE, { force: true });
  cy.get('[role="option"]').contains(NEW_SPECIES_CODE).click();
  cy.get(EDITED_ROW_SELECTOR).find('button[aria-label="Save your changes"]').click({ force: true });
  cy.get('[role="dialog"]').contains('button', 'Save Changes').click();

  cy.wait('@previewEdit');
  cy.get('[data-testid="edit-effect-R1a"]').should('contain', FORWARD_EFFECT_DETAIL);

  cy.get('[data-testid="edit-preview-apply"]').click();
  cy.wait('@applyEdit').its('request.body.newRow.SpeciesCode').should('eq', NEW_SPECIES_CODE);

  cy.wait('@fetchMeasurementHubSummaryRows');

  cy.get(`[data-testid="undo-toast-${appliedEditOperationID}"]`).should('be.visible');

  return { state, applyRequestScope, TREE_TAG, OLD_SPECIES_CODE, NEW_SPECIES_CODE, TARGET_TREE_ID, SIBLING_COUNT };
}

describe('Cross-Feature Integration', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    // One test edits a species code (a taxonomic-identity change), which the app
    // restricts to global / db-admin roles. Use a global admin so that edit path
    // is exercisable.
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('preserves the active census context across View Data, View Errors, and View All Historical Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();

    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.wait('@fetchErrorFacets');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'TREE101');

    cy.openCensusHubLink('View All Historical Data');
    cy.gridRowShouldContain('TREE101', 'RUBI04');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
  });

  it('propagates an Errors Explorer edit into View Data and View All Historical Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');

    cy.contains('.MuiDataGrid-row', 'Invalid species reference').as('errorRow');
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });

    cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Save"]').click();
    });

    // The SpeciesCode edit is `warn` severity → confirm the PreviewDialog to apply.
    cy.wait('@previewEdit');
    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.wait('@applyEdit').its('request.body.newRow.SpeciesCode').should('eq', 'ANOPKL');
    cy.wait('@refreshMeasurementHubSummary');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View All Historical Data');
    cy.gridRowShouldContain('TREE101', 'ANOPKL');
  });

  it('removes a cleared validation error from View Errors after clearing it in View Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Data');

    cy.contains('[role="row"]', 'TREE101').find('[data-field="isValidated"] button').click({ force: true });

    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.contains('button', 'Clear Errors').click();

    cy.contains('Validation errors cleared successfully').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
    cy.contains('[role="row"]', 'TREE101').should('be.visible');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('not.exist');
  });

  // Issue #427 — editing the species code on one stem of a multi-stem tree is a
  // tree-wide species correction, not a single-row re-link: every sibling
  // measurement sharing the tree shows the corrected species, and the preview
  // reports the expanded sibling counts (see editplan/rules/species.ts R1a).
  // mockMeasurementHubWorkflowApi's generic edit-plan mock (a single hardcoded
  // 'Test edit plan.' effect that patches only the edited row) cannot represent
  // this, so this spec overrides `@previewEdit`/`@applyEdit` after calling it to
  // reply with the real R1a sibling-count sentence and to patch every row that
  // shares the edited tree, mirroring the intended writer/preview contract.
  it('previews expanded sibling counts and refreshes every sibling row when correcting a tree-wide species (#427)', () => {
    const TREE_TAG = 'TREE900';
    const OLD_SPECIES_CODE = 'ACERRU';
    const NEW_SPECIES_CODE = 'QUERCO';
    const TARGET_TREE_ID = 7700;
    const SIBLING_COUNT = 3;

    const siblingStemOne = buildMeasurementsSummaryRow({
      coreMeasurementID: 901,
      treeTag: TREE_TAG,
      stemTag: 'S1',
      speciesCode: OLD_SPECIES_CODE,
      quadratName: 'Q0101'
    });
    const siblingStemTwo = buildMeasurementsSummaryRow({
      coreMeasurementID: 902,
      treeTag: TREE_TAG,
      stemTag: 'S2',
      speciesCode: OLD_SPECIES_CODE,
      quadratName: 'Q0101'
    });
    const siblingStemThree = buildMeasurementsSummaryRow({
      coreMeasurementID: 903,
      treeTag: TREE_TAG,
      stemTag: 'S3',
      speciesCode: OLD_SPECIES_CODE,
      quadratName: 'Q0101'
    });

    const state = mockMeasurementHubWorkflowApi({
      summaryRows: [siblingStemOne, siblingStemTwo, siblingStemThree]
    });

    // Overrides the helper's species lookup (seeded solely from summaryRows,
    // all OLD_SPECIES_CODE) so the non-freeSolo speciesCode Autocomplete has NEW_SPECIES_CODE as a selectable option.
    cy.intercept('GET', '**/api/fetchall/species/**', {
      statusCode: 200,
      body: [{ SpeciesCode: OLD_SPECIES_CODE }, { SpeciesCode: NEW_SPECIES_CODE }]
    }).as('fetchSpeciesLookup');

    // Real tree-wide-correction sentence from editplan/rules/species.ts's R1a
    // effect (`planSpeciesCorrection`'s activeStemCount/inactiveStemCount etc.),
    // not the generic helper's hardcoded 'Test edit plan.' detail.
    const SIBLING_EFFECT_DETAIL =
      `Tree T#${TARGET_TREE_ID} (TreeTag "${TREE_TAG}") species "${OLD_SPECIES_CODE}" -> "${NEW_SPECIES_CODE}". ` +
      `${SIBLING_COUNT} stem(s) (${SIBLING_COUNT} active, 0 inactive) and ${SIBLING_COUNT} measurement(s) (${SIBLING_COUNT} active, 0 inactive) will show the corrected species.`;

    // Registered after mockMeasurementHubWorkflowApi: Cypress applies the
    // most-recently-registered matching intercept first, so this overrides its
    // internal mockEditPlanFlow for both endpoints without mutating that shared
    // helper.
    cy.intercept('POST', '**/api/edits/preview', req => {
      const { targetID, newRow, dataType } = (req.body ?? {}) as { targetID: number; newRow: Record<string, unknown>; dataType?: string };
      req.reply({
        statusCode: 200,
        body: {
          dataType: dataType ?? 'measurementssummary',
          targetID,
          fieldChanges: [{ field: 'SpeciesCode', from: OLD_SPECIES_CODE, to: newRow.SpeciesCode }],
          effects: [
            {
              id: 'R1a',
              severity: 'warn',
              category: 'identity',
              title: 'Tree species will be corrected',
              detail: SIBLING_EFFECT_DETAIL,
              affectedTable: 'trees',
              affectedRowCount: 1
            }
          ],
          canApply: true,
          maxSeverity: 'warn',
          planHash: 'test-plan-hash-427-tree-wide',
          generatedAt: '2026-01-01T00:00:00.000Z'
        }
      });
    }).as('previewEdit');

    cy.intercept('POST', '**/api/edits/apply', req => {
      const { targetID, newRow } = (req.body ?? {}) as { targetID: number; newRow: Record<string, unknown> };
      const correctedCode = newRow.SpeciesCode as string;
      // Intended writer behavior (#427): every sibling sharing the tree is
      // corrected, not only the edited CoreMeasurementID.
      state.summaryRows = state.summaryRows.map(row => (row.treeTag === TREE_TAG ? { ...row, speciesCode: correctedCode } : row));
      req.reply({
        statusCode: 200,
        body: {
          updatedIDs: { CoreMeasurementID: targetID },
          applyErrors: [],
          editOperationID: 1,
          validationPending: false
        }
      });
    }).as('applyEdit');

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Data');

    // Consume the grid's initial load BEFORE editing, so the later wait on
    // this same alias (after Save) can only be satisfied by a genuinely new
    // refetch triggered by the apply, not by re-matching this first request.
    cy.wait('@fetchMeasurementHubSummaryRows');
    // The speciesCode editor's option list must be populated before edit mode opens.
    cy.wait('@fetchSpeciesLookup');

    // Edited row is CoreMeasurementID 901 (stemTag 'S1' above); the grid sets
    // each row's `id` to CoreMeasurementID (buildMeasurementsSummaryRow), so
    // `data-id="901"` is the exact row, not a text-content guess. Action
    // buttons are MUI GridActionsCellItem wrapped in a Joy Tooltip whose
    // `title` supplies the accessible name — "Edit this row" / "Save your
    // changes" (measurementscommons.tsx's getEnhancedCellAction), proven
    // reachable the same way in admin-workflows.cy.ts.
    const EDITED_ROW_SELECTOR = '[role="row"][data-id="901"]';
    cy.get(EDITED_ROW_SELECTOR).find('button[aria-label="Edit this row"]').click({ force: true });
    cy.get(EDITED_ROW_SELECTOR).find('[data-field="speciesCode"] input').clear({ force: true }).type(NEW_SPECIES_CODE, { force: true });
    cy.get('[role="option"]').contains(NEW_SPECIES_CODE).click();
    cy.get(EDITED_ROW_SELECTOR).find('button[aria-label="Save your changes"]').click({ force: true });
    // The grid's Confirm Changes dialog must be accepted before any preview request is made.
    cy.get('[role="dialog"]').contains('button', 'Save Changes').click();

    cy.wait('@previewEdit');
    cy.get('[data-testid="edit-effect-R1a"]').should('contain', SIBLING_EFFECT_DETAIL);

    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.wait('@applyEdit').its('request.body.newRow.SpeciesCode').should('eq', NEW_SPECIES_CODE);
    // #524 item 8: the measurements grids use the same success wording as the isolated grids.
    cy.contains(ROW_UPDATED_MESSAGE).should('be.visible');

    // The View Data grid refetches via SWR cache invalidation
    // (`invalidateAfter('save-edit-plan', ...)`), which POSTs back to
    // fixeddatafilter/measurementssummary — the same alias the grid's initial
    // load used above. Having consumed that first call already, this wait
    // can only resolve against the post-apply refetch.
    cy.wait('@fetchMeasurementHubSummaryRows');

    cy.get('[role="row"]')
      .filter((_index, element) => element.textContent?.includes(TREE_TAG) ?? false)
      .should('have.length', SIBLING_COUNT)
      .each($row => {
        cy.wrap($row).should('contain', NEW_SPECIES_CODE).and('not.contain', OLD_SPECIES_CODE);
      });
  });

  // Issue #427 — undoing a tree-wide species correction can race a drift in
  // the underlying edit plan, so the revert endpoint can return 409 with a
  // freshly recomputed plan instead of applying blind. UndoToast must route
  // that into the same PreviewDialog forward edits use, and only resend the
  // revert (now carrying confirmedPlanHash) once the user confirms it.
  it('requires PreviewDialog confirmation when undoing a tree-wide species correction drifts, then reverts every sibling on confirm', () => {
    const APPLIED_EDIT_OPERATION_ID = 501;
    const REVERT_EDIT_OPERATION_ID = 777;
    const FRESH_REVERT_PLAN_HASH = 'b1'.repeat(32);
    const REVERTED_TARGET_ID = 901;
    const EDIT_REVERTED_SNACKBAR_MESSAGE = 'Edit reverted';

    const { state, applyRequestScope, TREE_TAG, OLD_SPECIES_CODE, NEW_SPECIES_CODE, TARGET_TREE_ID, SIBLING_COUNT } =
      performTreeWideSpeciesCorrectionAndApply(APPLIED_EDIT_OPERATION_ID);

    const REVERT_EFFECT_DETAIL =
      `Tree T#${TARGET_TREE_ID} (TreeTag "${TREE_TAG}") species "${NEW_SPECIES_CODE}" -> "${OLD_SPECIES_CODE}". ` +
      `${SIBLING_COUNT} stem(s) (${SIBLING_COUNT} active, 0 inactive) and ${SIBLING_COUNT} measurement(s) (${SIBLING_COUNT} active, 0 inactive) will show the corrected species.`;

    let revertRequestCount = 0;
    const firstRevertRequestBody: { plotID?: number; censusID?: number; editOperationID?: number } = {};

    cy.intercept('POST', '**/api/edits/revert', req => {
      revertRequestCount += 1;
      const body = (req.body ?? {}) as { plotID?: number; censusID?: number; editOperationID?: number; confirmedPlanHash?: string };

      if (revertRequestCount === 1) {
        firstRevertRequestBody.plotID = body.plotID;
        firstRevertRequestBody.censusID = body.censusID;
        firstRevertRequestBody.editOperationID = body.editOperationID;
        // Drift: requestrevert.ts's isUsableFreshPlan requires this exact
        // renderable shape before UndoToast will show it as a confirmation.
        req.reply({
          statusCode: 409,
          body: {
            error: 'revert drift',
            freshPlan: {
              dataType: 'measurementssummary',
              targetID: REVERTED_TARGET_ID,
              fieldChanges: [{ field: 'SpeciesCode', from: NEW_SPECIES_CODE, to: OLD_SPECIES_CODE }],
              effects: [
                {
                  id: 'R1b',
                  severity: 'warn',
                  category: 'identity',
                  title: 'Tree species will be reverted',
                  detail: REVERT_EFFECT_DETAIL,
                  affectedTable: 'trees',
                  affectedRowCount: 1
                }
              ],
              canApply: true,
              maxSeverity: 'warn',
              planHash: FRESH_REVERT_PLAN_HASH,
              generatedAt: '2026-01-01T00:05:00.000Z'
            }
          }
        });
        return;
      }

      // Second call is confirmed with the fresh plan's hash: actually revert.
      // updatedIDs must be Record<string, number> (isValidUpdatedIDs), matching
      // the real writer's single-ID shape, not an array of every sibling touched.
      state.summaryRows = state.summaryRows.map(row => (row.treeTag === TREE_TAG ? { ...row, speciesCode: OLD_SPECIES_CODE } : row));
      req.reply({
        statusCode: 200,
        body: {
          updatedIDs: { CoreMeasurementID: REVERTED_TARGET_ID },
          applyErrors: [],
          editOperationID: REVERT_EDIT_OPERATION_ID,
          validationPending: true
        }
      });
    }).as('revertEdit');

    cy.get('[data-testid="undo-toast-undo"]').click();
    cy.wait('@revertEdit');

    // Drift confirmation is visible, but nothing has reverted yet.
    cy.get('[data-testid="edit-effect-R1b"]').should('contain', REVERT_EFFECT_DETAIL);
    cy.contains(EDIT_REVERTED_SNACKBAR_MESSAGE).should('not.exist');
    cy.get('[role="row"]')
      .filter((_index, element) => element.textContent?.includes(TREE_TAG) ?? false)
      .should('have.length', SIBLING_COUNT)
      .each($row => {
        cy.wrap($row).should('contain', NEW_SPECIES_CODE).and('not.contain', OLD_SPECIES_CODE);
      });

    cy.get('[data-testid="edit-preview-apply"]').click();

    cy.wait('@revertEdit').then(interception => {
      const confirmedBody = (interception.request.body ?? {}) as {
        plotID?: number;
        censusID?: number;
        editOperationID?: number;
        confirmedPlanHash?: string;
      };
      expect(confirmedBody.plotID).to.eq(applyRequestScope.plotID);
      expect(confirmedBody.censusID).to.eq(applyRequestScope.censusID);
      expect(confirmedBody.plotID).to.eq(firstRevertRequestBody.plotID);
      expect(confirmedBody.censusID).to.eq(firstRevertRequestBody.censusID);
      expect(confirmedBody.editOperationID).to.eq(firstRevertRequestBody.editOperationID);
      expect(confirmedBody.editOperationID).to.eq(APPLIED_EDIT_OPERATION_ID);
      expect(confirmedBody.confirmedPlanHash).to.eq(FRESH_REVERT_PLAN_HASH);
    });

    cy.wait('@fetchMeasurementHubSummaryRows');

    // Re-checked after the post-revert refresh settles, so a retry loop
    // firing a third revert call here would still be caught.
    cy.then(() => {
      expect(revertRequestCount).to.eq(2);
    });

    cy.get(`[data-testid="undo-toast-${APPLIED_EDIT_OPERATION_ID}"]`).should('not.exist');
    cy.get('[role="row"]')
      .filter((_index, element) => element.textContent?.includes(TREE_TAG) ?? false)
      .should('have.length', SIBLING_COUNT)
      .each($row => {
        cy.wrap($row).should('contain', OLD_SPECIES_CODE).and('not.contain', NEW_SPECIES_CODE);
      });
  });

  // Issue #427 — a successful revert must still surface clearly when the
  // mandatory post-revert grid refresh itself fails. Before the pending
  // strict-refetch fix, SWR swallowed this failure silently, leaving the
  // grid on stale data while reporting nothing wrong.
  it('surfaces the refresh-failed warning when the post-undo paginated grid fetch fails after a successful revert', () => {
    const APPLIED_EDIT_OPERATION_ID = 601;
    const REVERT_EDIT_OPERATION_ID = 888;
    const REVERTED_TARGET_ID = 901;
    // Not exported by measurement-hub-workflow-helpers.ts; mirrors its DEFAULT_SCHEMA.
    const GRID_SCHEMA = 'luquillo';
    const PAGINATED_SUMMARY_URL_PATTERN = `**/api/fixeddatafilter/measurementssummary/${GRID_SCHEMA}/**`;
    const EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE = 'Edit reverted, but the view could not be refreshed. Reload the page to see current data.';
    const UNCONFIRMED_OUTCOME_MESSAGE = 'Could not confirm whether the revert completed. Refresh before retrying.';
    const UNDO_FAILED_PREFIX = 'Undo failed';

    const { state, TREE_TAG, OLD_SPECIES_CODE } = performTreeWideSpeciesCorrectionAndApply(APPLIED_EDIT_OPERATION_ID);

    let revertRequestCount = 0;
    cy.intercept('POST', '**/api/edits/revert', req => {
      revertRequestCount += 1;
      state.summaryRows = state.summaryRows.map(row => (row.treeTag === TREE_TAG ? { ...row, speciesCode: OLD_SPECIES_CODE } : row));
      req.reply({
        statusCode: 200,
        body: {
          updatedIDs: { CoreMeasurementID: REVERTED_TARGET_ID },
          applyErrors: [],
          editOperationID: REVERT_EDIT_OPERATION_ID,
          validationPending: true
        }
      });
    }).as('revertEdit');

    // Overrides the save helper's 200 reply for this same real grid endpoint —
    // already consumed twice above (initial load, post-apply) — so only the
    // refresh fired after this revert succeeds hits a server error, isolating
    // the failure to the paginated fetch; counts/validation endpoints are untouched.
    cy.intercept('POST', PAGINATED_SUMMARY_URL_PATTERN, {
      statusCode: 500,
      body: { error: 'Internal Server Error' }
    }).as('fetchMeasurementHubSummaryRowsFailed');

    cy.get('[data-testid="undo-toast-undo"]').click();
    cy.wait('@revertEdit');
    cy.wait('@fetchMeasurementHubSummaryRowsFailed');

    cy.contains(EDIT_REVERTED_REFRESH_FAILED_SNACKBAR_MESSAGE).should('be.visible');
    cy.get(`[data-testid="undo-toast-${APPLIED_EDIT_OPERATION_ID}"]`).should('not.exist');
    cy.contains(UNDO_FAILED_PREFIX).should('not.exist');
    cy.contains(UNCONFIRMED_OUTCOME_MESSAGE).should('not.exist');

    cy.then(() => {
      expect(revertRequestCount).to.eq(1);
    });
  });
});
