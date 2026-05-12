/**
 * Admin: Site Provisioning Wizard E2E Test
 *
 * Walks the full provisioning wizard from /admin/provision through to the
 * run-status page, using cy.intercept to mock all backend API calls.
 * No real database is touched — the 95 integration tests cover that path.
 */

const RUN_ID = 999;

const STEP_KEYS = [
  'validate_inputs',
  'create_schema',
  'init_tables',
  'deploy_procedures',
  'seed_validations',
  'insert_catalog_row',
  'insert_plot',
  'insert_census',
  'insert_quadrats',
  'verify'
] as const;

const SITE_NAME = 'Rabi';
const SCHEMA_NAME = 'forestgeo_rabi_e2e';
const PLOT_NAME = 'Main';

function buildSteps(status: 'pending' | 'running' | 'completed') {
  return STEP_KEYS.map((key, index) => ({
    stepId: index + 1,
    runId: RUN_ID,
    stepIndex: index,
    stepKey: key,
    status:
      status === 'running' && index === 0
        ? ('completed' as const)
        : status === 'running' && index === 1
          ? ('running' as const)
          : status === 'running'
            ? ('pending' as const)
            : status,
    errorMessage: null,
    errorStack: null,
    startedAt: status !== 'pending' && (index === 0 || (status === 'running' && index === 1)) ? new Date().toISOString() : null,
    finishedAt: status === 'completed' || (status === 'running' && index === 0) ? new Date().toISOString() : null
  }));
}

function buildRunRecord(status: 'running' | 'completed') {
  return {
    runId: RUN_ID,
    status,
    startedBy: 'admin@e2e.test',
    startedAt: new Date().toISOString(),
    finishedAt: status === 'completed' ? new Date().toISOString() : null,
    siteName: SITE_NAME,
    schemaName: SCHEMA_NAME,
    input: {}
  };
}

describe('Admin: site provisioning wizard', () => {
  beforeEach(() => {
    // Use the project-standard loginAsAdmin pattern: intercepts **/api/auth/session**
    // with a global-admin user so middleware auth bypass + page-level guard both pass.
    cy.loginAsAdmin();
  });

  it('completes a provisioning wizard end-to-end (with mocked API)', () => {
    cy.intercept('POST', '/api/admin/provision', {
      statusCode: 202,
      body: { runId: RUN_ID }
    }).as('startRun');

    let pollCount = 0;
    cy.intercept('GET', `/api/admin/provision/${RUN_ID}`, req => {
      pollCount++;
      if (pollCount === 1) {
        req.reply({
          run: buildRunRecord('running'),
          steps: buildSteps('running'),
          stuckStepIndex: null
        });
      } else {
        req.reply({
          run: buildRunRecord('completed'),
          steps: buildSteps('completed'),
          stuckStepIndex: null
        });
      }
    }).as('pollStatus');

    // ── Step 1: SiteForm ───────────────────────────────────────────────────
    cy.visit('/admin/provision');

    cy.get('[aria-label="Site Name"]').type(SITE_NAME);
    cy.get('[aria-label="Schema Name"]').type(SCHEMA_NAME);
    // sqDimX, sqDimY already default to 5
    // defaultUOMDBH already defaults to 'mm', defaultUOMHOM to 'm'
    cy.get('[aria-label="Location"]').type(SITE_NAME);
    cy.get('[aria-label="Country"]').type('Gabon');

    cy.contains('button', 'Next').click();

    // ── Step 2: PlotForm ───────────────────────────────────────────────────
    // Plot page: plotName required; dimensionX/dimensionY/area default to 100/100/10000
    cy.get('[aria-label="Plot Name"]').type(PLOT_NAME);
    // Default units (m, m, m2, mm, m) are already filled — no need to change them.

    cy.contains('button', 'Next').click();

    // ── Step 3: QuadratPlanner (grid mode, 20×20, sequential) ─────────────
    // Defaults: grid mode, quadratSizeX=20, quadratSizeY=20, naming=sequential
    // 100×100 plot / 20×20 quadrats = 5×5 = 25 quadrats
    cy.contains('Will create 25 quadrats').should('be.visible');

    cy.contains('button', 'Next').click();

    // ── Step 4: Review → Submit ────────────────────────────────────────────
    cy.contains('Review Provisioning Inputs').should('be.visible');
    cy.contains(SITE_NAME).should('be.visible');
    cy.contains(SCHEMA_NAME).should('be.visible');

    cy.contains('button', 'Provision Site').click();

    cy.wait('@startRun');

    // ── RunStatus page ─────────────────────────────────────────────────────
    cy.url().should('include', `/admin/provision/${RUN_ID}`);

    // First poll: running state renders the step list
    cy.wait('@pollStatus');
    cy.contains(SCHEMA_NAME).should('be.visible');

    // Second poll: completed state — "Go to site" button appears
    cy.wait('@pollStatus');
    cy.contains('button', 'Go to site', { timeout: 5000 }).should('be.visible');
  });
});
