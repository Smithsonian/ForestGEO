/// <reference types="cypress" />

// Regression coverage for #304: manual "Run Validations" on the measurement
// hub now drives the shared, module-level ValidationRunner (and the sidebar
// ValidationStatusBadge) instead of the deprecated modal-owned ValidationCore.
//
// The discriminator between the two is structural, not cosmetic: the old
// ValidationCore called /api/validations/validationlist and
// /api/validations/procedures/* directly from inside a dialog and never
// persisted a run row. The new path additionally POSTs
// /api/validations/run to create a persisted run (surviving unmount/
// navigation) before running any procedure. Asserting that POST fires is
// what actually tells these two implementations apart — a passing grid and a
// "Run Validations" menu item prove nothing on their own, since both old and
// new code render the same toolbar.
//
// Two further things each case here is written to prove, not just exercise:
//   - "Still running" must be asserted while the procedure request is
//     demonstrably in flight (arrived, not yet responded to), not inferred
//     from a fixed delay — see mockHeldProcedure below.
//   - A rerun opened on the measurement hub (msvdatagrid/failedmeasurements
//     "More actions" menu) also reads /api/failedmeasurements/count for the
//     revalidatable-count badge; every case here stubs that read-only count
//     endpoint so an unrelated, unmocked 401 from it can never be mistaken
//     for a failure in the validation-run contract this spec exists to test.

import { buildMeasurementsSummaryRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';

const SCHEMA = 'luquillo';
const PLOT_ID = 1; // Luquillo Main Plot — cypress/fixtures/forestgeo-test-data.json
const CENSUS_ID = 5; // plotCensusNumber 5 for that plot in the same fixture
const PROCEDURE_NAME = 'ValidateQuadratName';
const EXISTING_RUN_ID = 8888;

// Safety net only: nothing in this suite is meant to ever wait this long on
// purpose. Kept under Cypress's defaultCommandTimeout (4000ms — see
// https://docs.cypress.io/api/commands/intercept) so that if this fallback
// is ever the thing that fires req.reply(), it still does so while the
// route-handler promise is demonstrably still active, rather than racing a
// command that already timed out. If a test fails before calling a held
// procedure's release(), this keeps that one held request — and the
// "running" state it drives — from stalling every later spec in the same
// Cypress run.
const HELD_PROCEDURE_FALLBACK_RELEASE_MS = 3000;

// Mirrors the non-exported DB_POLL_INTERVAL_MS in
// components/client/validationstatusbadge.tsx. That constant is the badge's
// own fallback-poll cadence when the module-level ValidationRunner in this
// tab is not the one driving the run (exactly the existing-run-conflict case
// below) — it isn't something this spec controls, so it's duplicated here
// under its own name rather than imported into a test-only export.
const BADGE_DB_POLL_INTERVAL_MS = 10_000;

function ndjsonBody(messages: Array<Record<string, unknown>>) {
  return messages.map(message => JSON.stringify(message)).join('\n') + '\n';
}

// A held procedure response's release() is awaited explicitly by each test
// after it has made its "still running" assertion. If a test fails before
// reaching that release(), this module-scope hook lets afterEach release it
// anyway so the held request can never leak into (and stall) another test.
let activeHeldProcedureRelease: (() => void) | null = null;

function mockFailedMeasurementsCount() {
  cy.intercept('GET', '**/api/failedmeasurements/count/**', {
    statusCode: 200,
    body: { recordCount: 0 }
  }).as('fetchFailedMeasurementsCount');
}

// Registers only the validation-run endpoints exercised by ValidationRunner
// (config/validation-runner.ts). mockMeasurementHubWorkflowApi intentionally
// does not stub these — they belong to this task's runner, not the shared
// grid/editing contract — and cy.mockCoreDataValidity() already owns the GET
// /api/validations/run?* resume check, so this only adds POST/PATCH and the
// procedure route. The procedure responds immediately; tests that need to
// assert a visible "still running" state replace this registration with
// mockHeldProcedure() afterward (most-recently-registered intercept wins).
function mockValidationRunApi({
  listStatusCode = 200,
  listBody = { coreValidations: { [PROCEDURE_NAME]: { id: 22, description: 'Quadrat name check', definition: '' } } },
  createRunBody = { runID: 9001, conflict: false }
}: {
  listStatusCode?: number;
  listBody?: unknown;
  createRunBody?: unknown;
} = {}) {
  cy.intercept('GET', `**/api/validations/validationlist?schema=${SCHEMA}`, {
    statusCode: listStatusCode,
    body: listBody
  }).as('fetchValidationList');

  cy.intercept('POST', '/api/validations/run', {
    statusCode: 200,
    body: createRunBody
  }).as('createValidationRun');

  cy.intercept('PATCH', '/api/validations/run', {
    statusCode: 200,
    body: {}
  }).as('patchValidationRun');

  cy.intercept('POST', `**/api/validations/procedures/${PROCEDURE_NAME}`, {
    statusCode: 200,
    headers: { 'content-type': 'application/x-ndjson' },
    body: ndjsonBody([{ type: 'heartbeat' }, { type: 'result', data: true }])
  }).as('runQuadratNameProcedure');

  cy.intercept('POST', '/api/validations/updatepassedvalidations', {
    statusCode: 200,
    body: { success: true }
  }).as('updatePassedValidations');
}

// Holds the procedure request open until release() is called, instead of a
// fixed delay. Cypress's HttpRequestInterceptor may return a Promise and the
// request stays unanswered until that promise resolves (cypress/types/
// net-stubbing.d.ts), which is exactly the primitive a deterministic
// "navigate away while still running" assertion needs: the request is
// provably in flight (hasArrived), and nothing about its timing is guessed.
function mockHeldProcedure() {
  let hasArrived = false;
  let releaseRequest: (() => void) | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  cy.intercept('POST', `**/api/validations/procedures/${PROCEDURE_NAME}`, req => {
    hasArrived = true;
    return new Promise<void>(resolve => {
      releaseRequest = () => {
        req.reply({
          statusCode: 200,
          headers: { 'content-type': 'application/x-ndjson' },
          body: ndjsonBody([{ type: 'heartbeat' }, { type: 'result', data: true }])
        });
        resolve();
        releaseRequest = null;
      };
      fallbackTimer = setTimeout(() => releaseRequest?.(), HELD_PROCEDURE_FALLBACK_RELEASE_MS);
    });
  }).as('runQuadratNameProcedure');

  const release = () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    releaseRequest?.();
  };

  activeHeldProcedureRelease = release;

  return {
    // Waits for the request to have arrived at the interceptor, WITHOUT
    // waiting for it to complete (cy.wait('@runQuadratNameProcedure') would
    // hang until release(), since Cypress's wait-on-alias waits for the full
    // request/response cycle by default).
    waitForArrival: () =>
      cy.wrap(null, { timeout: 10000 }).should(() => {
        expect(hasArrived, 'the held validation procedure request to have arrived').to.be.true;
      }),
    release: () => {
      release();
      activeHeldProcedureRelease = null;
    }
  };
}

function openMeasurementsSummary() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', CENSUS_ID);
  cy.openCensusHubLink('View Data');
  cy.get('[role="grid"]').should('be.visible');
}

function clickRunValidations() {
  cy.get('[aria-label="More actions"]').click();
  cy.contains('Run Validations').should('be.visible').click();
}

describe('Measurement hub manual validation rerun (#304)', () => {
  beforeEach(() => {
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
    mockFailedMeasurementsCount();
  });

  afterEach(() => {
    // Bounded fallback for any test that failed before calling release()
    // itself — never leaves a held request (and the "running" UI state it
    // drives) stalled into the next test.
    activeHeldProcedureRelease?.();
    activeHeldProcedureRelease = null;
  });

  it('starts the shared ValidationRunner for the active plot/census, survives navigating away from the grid mid-run, and reports completion in the sidebar badge', () => {
    mockMeasurementHubWorkflowApi({
      schema: SCHEMA,
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 201, treeTag: 'TREE201', censusID: CENSUS_ID, plotID: PLOT_ID, isValidated: null })]
    });
    mockValidationRunApi();
    const heldProcedure = mockHeldProcedure();

    openMeasurementsSummary();
    clickRunValidations();

    // The structured, persisted-run request is the discriminator from the
    // old modal-owned ValidationCore (see header comment) — it must carry
    // the selected plot/census, not the grid's row-level default.
    cy.wait('@createValidationRun').its('request.body').should('deep.equal', {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      totalSteps: 1
    });

    // Confirms the procedure request has actually left the browser before
    // asserting anything about "still running" below — a visible running
    // badge alone could just mean the request hasn't been sent yet.
    heldProcedure.waitForArrival();

    // MUI Joy's CircularProgress renders role="progressbar"; the badge only
    // shows it while validationStatus === 'running', so this — not a
    // transient toast — is the real "still running" signal.
    cy.get('[aria-label="Validation status"]').find('[role="progressbar"]').should('exist');

    // Navigate away from the grid via a normal client-side route change —
    // the module-level ValidationRunner (and the sidebar it reports into)
    // must keep running; this is not a hard refresh or tab close. Census
    // Overview (unlike View Errors/View All Historical Data) renders no
    // grid of its own, so there's no ambiguity about which grid survived.
    cy.openCensusHubLink('Census Overview');

    // Still visibly running, now on a different page — proves the runner
    // (and the held request it's awaiting) survived the route change rather
    // than being torn down along with the unmounted grid.
    cy.get('[aria-label="Validation status"]').find('[role="progressbar"]').should('exist');

    // release() calls req.reply() on the held request directly — it must
    // run once Cypress has actually processed the commands above (i.e. the
    // request has genuinely arrived), not when this test function's body
    // is merely enqueuing those commands.
    cy.then(() => heldProcedure.release());
    cy.wait('@updatePassedValidations');

    cy.get('[aria-label="Validation status"]', { timeout: 10000 }).click();
    cy.contains('All 1 validations passed').should('be.visible');
  });

  it('rejects a second Run Validations click while a run is active instead of cancelling it', () => {
    mockMeasurementHubWorkflowApi({
      schema: SCHEMA,
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 202, treeTag: 'TREE202', censusID: CENSUS_ID, plotID: PLOT_ID, isValidated: null })]
    });
    mockValidationRunApi();
    const heldProcedure = mockHeldProcedure();

    openMeasurementsSummary();
    clickRunValidations();
    cy.wait('@createValidationRun');
    heldProcedure.waitForArrival();

    // ValidationRunner.start() aborts whatever it was already running, so a
    // second click that reaches start() here would cancel the in-flight
    // run. The UI guard must intercept this before it gets there — prove
    // the run is genuinely still active (not already finished) before
    // attempting the duplicate click.
    cy.get('[aria-label="Validation status"]').find('[role="progressbar"]').should('exist');

    clickRunValidations();
    cy.contains('A validation run is already in progress').should('be.visible');

    // Exactly one run was ever created — the duplicate click never reached
    // ValidationRunner.start() a second time.
    cy.get('@createValidationRun.all').should('have.length', 1);

    // See the matching comment on the first test: must run once the held
    // request has actually arrived, not while commands are still enqueuing.
    cy.then(() => heldProcedure.release());
    cy.wait('@updatePassedValidations');

    cy.get('[aria-label="Validation status"]', { timeout: 10000 }).click();
    cy.contains('All 1 validations passed').should('be.visible');
  });

  it('enables Run Validations for failed-only rows via the existing revalidatable count and reruns through the shared runner', () => {
    mockMeasurementHubWorkflowApi({
      schema: SCHEMA,
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 203, treeTag: 'TREE203', censusID: CENSUS_ID, plotID: PLOT_ID, isValidated: false })],
      validationFailures: [{ coreMeasurementID: 203, descriptions: ['Invalid species reference'], criteria: ['speciesCode'] }],
      // measurementscommons reads CountRevalidatable from this raw-SQL counts
      // query (config/measurementstatefilters.ts); the shared workflow mock's
      // default buildCounts doesn't compute that column, so a failed-only
      // (CountPending = 0) fixture needs it supplied explicitly or the menu
      // item stays disabled regardless of what this task changed.
      queryHandler: (requestBody, state) => {
        if (typeof requestBody !== 'string' || !requestBody.includes('CountRevalidatable')) return undefined;
        return {
          body: [
            {
              CountValid: 0,
              CountUnresolvedLogged: state.validationFailures.length,
              CountFailedNoLog: 0,
              CountPending: 0,
              CountOverridable: 1,
              CountRevalidatable: 1,
              CountOldTrees: 0,
              CountNewRecruits: 0,
              CountMultiStems: 0
            }
          ]
        };
      }
    });
    mockValidationRunApi();

    openMeasurementsSummary();

    cy.get('[aria-label="More actions"]').click();
    // revalidatableCount > 0 with pendingCount === 0 is exactly the
    // failed-only case ValidationActionsMenu's disabled predicate exists to
    // keep actionable (pendingCount === 0 && revalidatableCount === 0).
    cy.contains('Re-check 1 failed row(s)').should('be.visible');
    cy.contains('Run Validations').should('be.visible').click();

    cy.wait('@createValidationRun').its('request.body').should('deep.equal', {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      totalSteps: 1
    });
    cy.wait('@runQuadratNameProcedure');
    cy.wait('@updatePassedValidations');

    cy.get('[aria-label="Validation status"]', { timeout: 10000 }).click();
    cy.contains('All 1 validations passed').should('be.visible');
  });

  it('surfaces a recoverable failure status when the validation-list request fails, without a false completion', () => {
    mockMeasurementHubWorkflowApi({
      schema: SCHEMA,
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 204, treeTag: 'TREE204', censusID: CENSUS_ID, plotID: PLOT_ID, isValidated: null })]
    });
    // This is the exact gap fixed in config/validation-runner.ts: before this
    // task, executeRun never checked validationlist's response.ok, so this
    // HTTP 500 with an error JSON body was silently treated as "zero
    // validations defined" and reported as a successful empty run.
    mockValidationRunApi({ listStatusCode: 500, listBody: { error: 'DB connection lost' } });

    openMeasurementsSummary();
    clickRunValidations();

    cy.wait('@fetchValidationList');

    // No run row, no procedure call, no finalization for a request that
    // never produced data.
    cy.get('@createValidationRun.all').should('have.length', 0);
    cy.get('@runQuadratNameProcedure.all').should('have.length', 0);

    cy.get('[aria-label="Validation status"]', { timeout: 10000 }).click();
    cy.contains('1 validation failed').should('be.visible');
    cy.contains('DB connection lost').should('be.visible');
  });

  it('follows another persisted run to completion via the badge DB status poll, without executing any procedure locally, when run creation reports an existing-run conflict', () => {
    mockMeasurementHubWorkflowApi({
      schema: SCHEMA,
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 205, treeTag: 'TREE205', censusID: CENSUS_ID, plotID: PLOT_ID, isValidated: null })]
    });
    mockValidationRunApi({ createRunBody: { conflict: true, existingRunID: EXISTING_RUN_ID } });

    // Overrides cy.mockCoreDataValidity()'s static {run:null} stub for this
    // test only (most-recently-registered intercept wins). This GET is the
    // ONLY mechanism that can ever surface the other run's outcome in this
    // tab: on an existing-run conflict, executeRun() (config/validation-
    // runner.ts) returns immediately without running any procedure itself,
    // so completion has to come from ValidationStatusBadge's fallback DB
    // poll — this is the discriminating regression for a suspected polling
    // race where that poll's "is the local runner active" check can read
    // stale after executeRun's own .finally() already cleared it.
    const existingRunCompletedPayload = {
      run: {
        RunID: EXISTING_RUN_ID,
        Status: 'completed',
        TotalSteps: 1,
        CompletedSteps: 1,
        ErrorMessages: [],
        Notices: []
      }
    };

    let otherRunCompleted = false;
    cy.intercept('GET', '**/api/validations/run?*', req => {
      // Dynamically aliases only the specific request that actually
      // carries the completed payload (per-request req.alias, see
      // https://docs.cypress.io/api/commands/intercept), independent of
      // how many earlier {run:null} resume-check GETs (mount, plot/census
      // selection, etc.) also match this same route — those never receive
      // this alias, so cy.wait('@pollValidationRunCompleted') below can
      // never resolve against a stale response no matter how many of
      // them occurred first.
      if (otherRunCompleted) {
        req.alias = 'pollValidationRunCompleted';
      }
      req.reply({
        statusCode: 200,
        body: otherRunCompleted ? existingRunCompletedPayload : { run: null }
      });
    }).as('pollValidationRun');

    openMeasurementsSummary();

    // Stubs setInterval/setTimeout in the app under test only — fetch/XHR,
    // and Cypress's own command-retry loop (which lives outside this frame),
    // are unaffected. Installed before the click below so it deterministically
    // governs the badge's BADGE_DB_POLL_INTERVAL_MS poll timer via cy.tick(),
    // instead of this test actually waiting that long in real time.
    cy.clock();

    clickRunValidations();

    cy.wait('@createValidationRun').its('request.body').should('deep.equal', {
      schema: SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      totalSteps: 1
    });

    // Visibly running — following the other run, not idle or failed.
    cy.get('[aria-label="Validation status"]').find('[role="progressbar"]').should('exist');

    // Flips the stubbed response's payload once Cypress has actually
    // reached this point in the command queue (not when this test
    // function's body is merely enqueuing commands below), then advances
    // the faked clock so the badge's fallback-poll setInterval fires its
    // next tick against the now-completed payload.
    cy.then(() => {
      otherRunCompleted = true;
    });
    cy.tick(BADGE_DB_POLL_INTERVAL_MS);

    // Proves the poll that actually drove completion carried the other
    // run's completed payload — not just that the UI eventually looks
    // right regardless of why. The dynamic per-request alias (set above,
    // only once otherRunCompleted is true) means this targets exactly
    // that request regardless of how many earlier {run:null} GETs ran.
    cy.wait('@pollValidationRunCompleted').its('response.body').should('deep.equal', existingRunCompletedPayload);

    cy.get('[aria-label="Validation status"]', { timeout: 10000 }).click();
    cy.contains('All 1 validations passed').should('be.visible');

    // The whole point of following an existing run is to not redo its work —
    // this tab must never have executed the procedure or finalization itself.
    cy.get('@runQuadratNameProcedure.all').should('have.length', 0);
    cy.get('@updatePassedValidations.all').should('have.length', 0);
  });
});
