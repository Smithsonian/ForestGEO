/**
 * Admin: Site Provisioning Wizard E2E Test
 *
 * Walks the full provisioning wizard from /admin/provision through to the
 * run-status page, using cy.intercept to mock all backend API calls.
 * No real database is touched — the 95 integration tests cover that path.
 */

const RUN_ID = 999;
const POLL_INTERVAL_MS = 1000;

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

function buildSteps(status: 'pending' | 'running' | 'completed' | 'failed') {
  return STEP_KEYS.map((key, index) => ({
    stepId: index + 1,
    runId: RUN_ID,
    stepIndex: index,
    stepKey: key,
    status:
      status === 'failed' && index === 1
        ? ('failed' as const)
        : status === 'failed' && index < 1
          ? ('completed' as const)
          : status === 'failed'
            ? ('pending' as const)
            : status === 'running' && index === 0
              ? ('completed' as const)
              : status === 'running' && index === 1
                ? ('running' as const)
                : status === 'running'
                  ? ('pending' as const)
                  : status,
    errorMessage: status === 'failed' && index === 1 ? 'Synthetic failure' : null,
    errorStack: status === 'failed' && index === 1 ? 'Error: Synthetic failure' : null,
    startedAt: status !== 'pending' && (index === 0 || ((status === 'running' || status === 'failed') && index === 1)) ? new Date().toISOString() : null,
    finishedAt: status === 'completed' || (status === 'running' && index === 0) || (status === 'failed' && index <= 1) ? new Date().toISOString() : null
  }));
}

function buildRunRecord(status: 'running' | 'completed' | 'failed' | 'aborted') {
  return {
    runId: RUN_ID,
    status,
    startedBy: 'admin@e2e.test',
    startedAt: new Date().toISOString(),
    finishedAt: status === 'running' ? null : new Date().toISOString(),
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

    // Install a frozen clock so we drive polling deterministically via cy.tick().
    // Keep fetch/queueMicrotask/Promise unaffected; we only need setInterval frozen.
    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']);

    cy.contains('button', 'Provision Site').click();

    cy.wait('@startRun');

    // ── RunStatus page ─────────────────────────────────────────────────────
    cy.url().should('include', `/admin/provision/${RUN_ID}`);

    // First poll: fired immediately on mount (no interval tick needed)
    cy.wait('@pollStatus');
    cy.contains(SCHEMA_NAME).should('be.visible');

    // Drive the interval forward to trigger the second poll
    cy.tick(POLL_INTERVAL_MS);
    cy.wait('@pollStatus');
    cy.contains('button', 'Go to site').should('be.visible');
    cy.contains('button', 'Delete provisioned site').should('be.visible');
  });

  it('blocks review when grid quadrat dimensions are invalid', () => {
    cy.visit('/admin/provision');

    cy.get('[aria-label="Site Name"]').type(SITE_NAME);
    cy.get('[aria-label="Schema Name"]').type(`${SCHEMA_NAME}_invalid_grid`);
    cy.get('[aria-label="Location"]').type(SITE_NAME);
    cy.get('[aria-label="Country"]').type('Gabon');
    cy.contains('button', 'Next').click();

    cy.get('[aria-label="Plot Name"]').type(PLOT_NAME);
    cy.contains('button', 'Next').click();

    cy.get('[aria-label="Quadrat Size X"]').focus().type('{selectall}30');
    cy.get('[aria-label="Quadrat Size Y"]').focus().type('{selectall}30');
    cy.get('[aria-label="Divisibility error"]').should('be.visible');

    cy.contains('button', 'Next').click();
    cy.contains('Review Provisioning Inputs').should('not.exist');
    cy.get('[aria-label="Divisibility error"]').should('be.visible');
  });

  it('refreshes the status page after retry from a failed terminal state', () => {
    let pollCount = 0;
    let retried = false;
    cy.intercept('GET', `/api/admin/provision/${RUN_ID}`, req => {
      pollCount++;
      if (!retried) {
        req.reply({
          run: buildRunRecord('failed'),
          steps: buildSteps('failed'),
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

    cy.intercept('POST', `/api/admin/provision/${RUN_ID}/retry`, req => {
      retried = true;
      req.reply({
        statusCode: 200,
        body: { ok: true }
      });
    }).as('retryRun');

    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']);
    cy.visit(`/admin/provision/${RUN_ID}`);
    cy.wait('@pollStatus');
    cy.contains('button', 'Retry from failed step').click();
    cy.wait('@retryRun');
    // Retry bumps pollGeneration which re-runs the effect; the new effect fires
    // an immediate safePoll() and a fresh interval. The immediate fetch happens
    // without a tick.
    cy.wait('@pollStatus');
    cy.contains('button', 'Go to site').should('be.visible');
    cy.then(() => expect(pollCount).to.be.greaterThan(1));
  });

  it('tears down a completed provisioned site after exact schema confirmation', () => {
    let tornDown = false;
    cy.intercept('GET', `/api/admin/provision/${RUN_ID}`, req => {
      req.reply({
        run: buildRunRecord(tornDown ? 'aborted' : 'completed'),
        steps: buildSteps('completed'),
        stuckStepIndex: null
      });
    }).as('pollStatus');

    cy.intercept('DELETE', `/api/admin/provision/${RUN_ID}/teardown`, req => {
      expect(req.body).to.deep.equal({ confirmSchemaName: SCHEMA_NAME });
      tornDown = true;
      req.reply({
        statusCode: 200,
        body: { ok: true }
      });
    }).as('teardownRun');

    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']);
    cy.visit(`/admin/provision/${RUN_ID}`);
    cy.wait('@pollStatus');
    cy.contains('button', 'Delete provisioned site').click();

    cy.contains('button', 'Delete site').should('be.disabled');
    cy.get('[aria-label="Confirm schema name"]').type(`${SCHEMA_NAME}_wrong`);
    cy.contains('button', 'Delete site').should('be.disabled');
    cy.get('[aria-label="Confirm schema name"]').clear().type(SCHEMA_NAME);
    cy.contains('button', 'Delete site').should('not.be.disabled').click();

    cy.wait('@teardownRun');
    cy.wait('@pollStatus');
    cy.contains('aborted').should('be.visible');
    cy.contains('button', 'Delete provisioned site').should('not.exist');
  });

  it('aborts a failed run after exact schema confirmation via the abort dialog', () => {
    let aborted = false;
    cy.intercept('GET', `/api/admin/provision/${RUN_ID}`, req => {
      req.reply({
        run: buildRunRecord(aborted ? 'aborted' : 'failed'),
        steps: buildSteps('failed'),
        stuckStepIndex: null
      });
    }).as('pollStatus');

    cy.intercept('POST', `/api/admin/provision/${RUN_ID}/abort`, req => {
      aborted = true;
      req.reply({ statusCode: 200, body: { ok: true } });
    }).as('abortRun');

    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']);
    cy.visit(`/admin/provision/${RUN_ID}`);
    cy.wait('@pollStatus');

    cy.contains('button', 'Abort & drop schema').click();

    // Within the alertdialog, the confirm button is also labelled "Abort & drop schema".
    // Scope assertions to the dialog so they don't match the underlying trigger button.
    cy.get('[role="alertdialog"]').within(() => {
      cy.contains('button', 'Abort & drop schema').should('be.disabled');
      cy.get('[aria-label="Confirm schema name"]').type(`${SCHEMA_NAME}_wrong`);
      cy.contains('button', 'Abort & drop schema').should('be.disabled');
      cy.get('[aria-label="Confirm schema name"]').clear().type(SCHEMA_NAME);
      cy.contains('button', 'Abort & drop schema').should('not.be.disabled').click();
    });

    cy.wait('@abortRun');
    cy.wait('@pollStatus');
    cy.contains('aborted').should('be.visible');
  });
});
