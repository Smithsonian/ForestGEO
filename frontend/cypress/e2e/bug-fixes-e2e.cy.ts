/// <reference types="cypress" />

import { buildMeasurementsSummaryRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';

const RESET_SUCCESS_MESSAGE = 'Validation states reset. Rows are pending validation. Failed Measurements still need correction and reingestion.';
const RECHECK_SUCCESS_MESSAGE = 'Validation errors cleared. The row is pending validation.';
const RECHECK_FAILURE_MESSAGE = 'Validation recheck failed; refresh the census before retrying';
const RESET_BUSY_MESSAGE = 'edit scope is currently busy';

function openMeasurementsSummary() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Data');
  cy.wait('@fetchMeasurementHubSummaryRows');
  cy.wait('@fetchMeasurementHubValidationErrors');
  cy.get('[role="grid"]').should('be.visible');
}

function openValidationDetails(treeTag: string) {
  cy.contains('[role="row"]', treeTag).find('[data-field="isValidated"] button').click({ force: true });

  cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
}

// Guards against a regression back to the old raw-SQL /api/query writes this
// feature replaced — the reset/recheck mutations must flow through the
// structured /api/validations/reset and /api/validations/recheck routes only.
function isLegacyValidationMutationQuery(interception: Cypress.Interception): boolean {
  const rawBody = interception.request.body;
  const parsedBody =
    typeof rawBody === 'string'
      ? (() => {
          try {
            return JSON.parse(rawBody);
          } catch {
            return rawBody;
          }
        })()
      : rawBody;
  const query = typeof parsedBody?.query === 'string' ? parsedBody.query : '';

  return query.includes('measurement_error_log') || query.includes('DELETE mel') || query.includes('IsValidated = NULL');
}

describe('Measurement Hub Regression Contracts', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    // Reset/recheck are admin-only server routes — exercise them as the role
    // the server actually authorizes, per frontend/app/api/validations/*/route.ts.
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('does not reset validation state when the reset dialog is cancelled', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');

    cy.get('@resetValidations.all').should('have.length', 0);
    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.contains(RESET_SUCCESS_MESSAGE).should('not.exist');
    // The row's error affordance is untouched by the cancel path.
    cy.contains('[role="row"]', 'TREE101').find('[data-field="isValidated"] button').should('exist');
  });

  it('sends exactly one structured reset request, updates the row to pending, and skips a separate view refresh', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', censusID: 5, isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();
    cy.contains('button', 'Yes').click();

    cy.wait('@resetValidations').then(interception => {
      expect(interception.request.body).to.deep.equal({ schema: 'luquillo', plotID: 1, censusID: 5 });
      expect(interception.request.body).to.not.have.any.keys('query', 'params', 'format');
    });
    cy.get('@resetValidations.all').should('have.length', 1);

    cy.wait('@fetchMeasurementHubSummaryRows');
    cy.wait('@fetchMeasurementHubValidationErrors');

    cy.contains(RESET_SUCCESS_MESSAGE).should('be.visible');
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');

    // The atomic reset route already refreshed both measurement views — the
    // client must not trigger a separate whole-view rebuild afterward.
    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.get('@refreshMeasurementHubViewFullTable.all').should('have.length', 0);

    // Real state change: the row's error affordance is gone (validationErrors
    // no longer has an entry for it) and the error count badge reflects it.
    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').should('not.exist');
    cy.get('[data-testid="filter-errors"]').should('have.attr', 'aria-label', 'Hide invalid measurements (0)');

    // A stale IsValidated=false row with an emptied error map would also pass
    // the two assertions above — assert the row actually moved to pending
    // (HourglassEmptyIcon), not just that its error affordance disappeared.
    cy.contains('[role="row"]', 'TREE102').find('[data-testid="HourglassEmptyIcon"]').should('be.visible');
    cy.get('[data-testid="filter-pending"]').should('have.attr', 'aria-label', 'Hide pending measurements (1)');

    cy.get('@runMeasurementHubQuery.all').then(interceptions => {
      expect((interceptions as Cypress.Interception[]).some(isLegacyValidationMutationQuery)).to.equal(false);
    });
  });

  it('shows the busy-scope message and leaves the dialog open when reset is rejected as busy', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 105, treeTag: 'TREE105', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 105,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });
    cy.intercept('POST', '/api/validations/reset', { statusCode: 409, body: { error: RESET_BUSY_MESSAGE } }).as('resetValidationsBusy');

    openMeasurementsSummary();

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();
    cy.contains('button', 'Yes').click();

    cy.wait('@resetValidationsBusy');
    cy.contains(`Error: ${RESET_BUSY_MESSAGE}`).should('be.visible');
    cy.contains(RESET_SUCCESS_MESSAGE).should('not.exist');

    // Busy is recoverable: the dialog stays open and the row's error state is untouched.
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.contains('button', 'No').click();
    cy.contains('[role="row"]', 'TREE105').find('[data-field="isValidated"] button').should('exist');
  });

  it('keeps the validation details dialog open and the row selectable when recheck fails', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 103, treeTag: 'TREE103', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 103,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });
    cy.intercept('POST', '/api/validations/recheck', { statusCode: 500, body: { error: RECHECK_FAILURE_MESSAGE } }).as('recheckValidationFailure');

    openMeasurementsSummary();
    openValidationDetails('TREE103');

    cy.contains('button', 'Clear Errors').click();
    cy.wait('@recheckValidationFailure');

    cy.contains(`Failed to clear errors: ${RECHECK_FAILURE_MESSAGE}`).should('be.visible');
    cy.contains(RECHECK_SUCCESS_MESSAGE).should('not.exist');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.get('@recheckValidation.all').should('have.length', 0);
    cy.get('@recheckValidationFailure.all').should('have.length', 1);

    // Recoverable: closing and reopening the same row's details still works.
    cy.contains('button', 'Close').click();
    cy.contains('[role="row"]', 'TREE103').find('[data-field="isValidated"] button').should('exist');
  });

  it('sends exactly one structured recheck request, clears the row, and closes the dialog', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 104, treeTag: 'TREE104', censusID: 5, isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 104,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();
    openValidationDetails('TREE104');

    cy.contains('button', 'Clear Errors').click();

    cy.wait('@recheckValidation').then(interception => {
      expect(interception.request.body).to.deep.equal({ schema: 'luquillo', plotID: 1, censusID: 5, coreMeasurementID: 104 });
      expect(interception.request.body).to.not.have.any.keys('query', 'params', 'format');
    });
    cy.get('@recheckValidation.all').should('have.length', 1);

    cy.contains(RECHECK_SUCCESS_MESSAGE).should('be.visible');
    cy.wait('@fetchMeasurementHubValidationErrors');

    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.get('@refreshMeasurementHubViewFullTable.all').should('have.length', 0);

    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
    cy.contains('[role="row"]', 'TREE104').find('[data-field="isValidated"] button').should('not.exist');

    // A stale IsValidated=false row with an emptied error map would also pass
    // the assertion above — assert the row actually moved to pending
    // (HourglassEmptyIcon), not just that its error affordance disappeared.
    cy.contains('[role="row"]', 'TREE104').find('[data-testid="HourglassEmptyIcon"]').should('be.visible');
    cy.get('[data-testid="filter-pending"]').should('have.attr', 'aria-label', 'Hide pending measurements (1)');

    cy.get('@runMeasurementHubQuery.all').then(interceptions => {
      expect((interceptions as Cypress.Interception[]).some(isLegacyValidationMutationQuery)).to.equal(false);
    });
  });
});
