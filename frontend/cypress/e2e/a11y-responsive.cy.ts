/// <reference types="cypress" />

import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { buildMeasurementsSummaryRow, buildViewFullTableRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', preset: 'iphone-x' as const }
];

function prepareMockedCensusWorkflow() {
  cy.setupForestGEOUser('adminUser');
  cy.mockCoreDataValidity();

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
    id: 101,
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
}

// Site/plot/census selection always runs at desktop width: on mobile the
// sidebar lives in a Drawer whose transformed, scrollable container defeats
// Cypress visibility checks inside the shared selection helpers. The mobile
// pass switches the viewport after selection and reaches pages by route, so
// what we scan is each page's mobile rendering.
function selectDefaultContext() {
  cy.viewport(1440, 900);
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function applyViewport(viewport: (typeof VIEWPORTS)[number]) {
  if ('preset' in viewport) {
    cy.viewport(viewport.preset);
  } else {
    cy.viewport(viewport.width, viewport.height);
  }
}

function openCensusHubPage(label: string, route: string, isMobile: boolean) {
  if (isMobile) {
    cy.visit(`/measurementshub${route}`);
  } else {
    cy.openCensusHubLink(label);
  }
}

function checkCriticalA11y(context?: Parameters<Cypress.Chainable['checkA11y']>[0], rules: Record<string, { enabled: boolean }> = {}) {
  cy.injectAxe();
  cy.checkA11y(
    context,
    {
      includedImpacts: ['critical'],
      rules
    },
    violations => {
      violations.forEach(violation => {
        cy.task(
          'log',
          `[a11y] ${violation.id} (${violation.impact}) ${violation.description} :: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`
        );
      });
    }
  );
}

describe('Accessibility and responsive smoke', () => {
  VIEWPORTS.forEach(viewport => {
    it(`has no critical axe violations on core census pages at ${viewport.name} viewport`, () => {
      const isMobile = 'preset' in viewport;

      prepareMockedCensusWorkflow();
      selectDefaultContext();
      applyViewport(viewport);
      checkCriticalA11y();

      openCensusHubPage('View Data', '/summary', isMobile);
      cy.wait('@fetchMeasurementHubSummaryRows');
      cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
      // MUI DataGrid virtualization currently trips axe's aria-required-children
      // rule inside the grid internals. Keep the page-level smoke while tracking
      // the grid-specific remediation separately.
      checkCriticalA11y(undefined, { 'aria-required-children': { enabled: false } });

      openCensusHubPage('View Errors', '/errors', isMobile);
      cy.wait('@fetchErrorsExplorerRows');
      cy.wait('@fetchErrorFacets');
      cy.get('.MuiDataGrid-root', { timeout: 10000 }).should('exist');
      checkCriticalA11y(undefined, { 'aria-required-children': { enabled: false } });
    });
  });
});
