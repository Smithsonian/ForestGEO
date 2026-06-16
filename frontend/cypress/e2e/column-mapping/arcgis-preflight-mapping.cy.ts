/// <reference types="cypress" />

/**
 * ArcGIS two-sheet .xlsx pre-flight MAPPING JOURNEY (wiring-level e2e).
 *
 * Proves the seam between the parse-files step (UploadParseFiles), the ArcGIS
 * pre-flight (UploadArcgisPreflight) and the shared mapping dialog
 * (ColumnMappingDialog):
 *   - a workbook whose columns the server cannot auto-resolve forces the
 *     "mapping required" affordance; opening it shows trees/stems sheet-role
 *     selects; choosing roles + Apply RESUBMITS pre-flight carrying the mapping
 *     (sheetRoles ride along in the resubmitted `mapping` FormData field),
 *   - a mapping-required response that ALSO carries a server recovery `mapping`
 *     repopulates the dialog's sheet-role selects (proving the no-stale-loop path,
 *     where the component prefers the server's echoed mapping over its own).
 *
 * This spec asserts WIRING only. Fine-grained pre-flight reducer logic (phase
 * transitions, recoverable-error gating, abort handling) is owned by
 * components/uploadsystem/segments/uploadarcgispreflight.test.tsx and must NOT be
 * re-asserted here.
 *
 * The journey is driven through app/e2e-upload-harness?mode=arcgis (an E2E-only
 * route that mounts the real measurements UploadParentModal with sourceFormat =
 * arcgis_xlsx and a fixed site/plot/census), because the sole production entry
 * point is buried in the fully populated measurements summary grid.
 */

const HARNESS_ARCGIS_ROUTE = '/e2e-upload-harness?mode=arcgis';

const ARCGIS_FIXTURE = 'arcgis-two-sheet.xlsx';

// Sheet roles offered by the dialog come from the pre-flight `sheets` payload,
// which the mock controls. These names match the fixture workbook's sheets.
const TREES_SHEET_NAME = 'Trees';
const STEMS_SHEET_NAME = 'Stems';

// Columns the mock advertises per sheet. Trees carries every trees-scoped required
// ArcGIS field; Stems adds ParentGlobalID (stems-required) and DBH_CURRENT. With
// both roles assigned, the seeded mapping below validates clean (verified against
// lib/column-mapping seedMapping + validateMapping), so Apply enables.
const TREES_COLUMNS = ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured'];
const STEMS_COLUMNS = ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'lx', 'ly', 'Date_measured', 'ParentGlobalID', 'DBH_CURRENT'];

const PREFLIGHT_SHEETS = [
  { name: TREES_SHEET_NAME, columns: TREES_COLUMNS },
  { name: STEMS_SHEET_NAME, columns: STEMS_COLUMNS }
];

// The exact contract UploadArcgisPreflight consumes (see lib/arcgis/types.ts +
// the component): status === 'mapping_required' + an array `sheets` opens the
// mapping flow; the server's recovery mapping (when present) is read from the
// `mapping` field, NOT a `recoveredMapping` field. The resubmit is another POST
// to /api/arcgis/preflight whose FormData `mapping` field carries the applied
// mapping (sheetRoles included).
const PREFLIGHT_STATUS_MAPPING_REQUIRED = 'mapping_required';
const ARCGIS_FORMAT = 'arcgis_xlsx';
const PREFLIGHT_ERROR_MESSAGE = 'Workbook columns do not match the expected ArcGIS schema. Map them to continue.';

// A complete, scope-correct seed mapping for the advertised sheets. With both
// sheet roles set it passes validateMapping, which is the gate on the Apply button.
const SEEDED_MAPPING = {
  version: 1,
  format: ARCGIS_FORMAT,
  fields: [
    { canonicalField: 'GlobalID', sourceColumns: ['GlobalID'], scope: 'both' },
    { canonicalField: 'ParentGlobalID', sourceColumns: ['ParentGlobalID'], scope: 'stems' },
    { canonicalField: 'quadrat', sourceColumns: ['quadrat'], scope: 'both' },
    { canonicalField: 'tag', sourceColumns: ['tag'], scope: 'both' },
    { canonicalField: 'StemTag', sourceColumns: ['StemTag'], scope: 'both' },
    { canonicalField: 'spcode', sourceColumns: ['spcode'], scope: 'both' },
    { canonicalField: 'DBH_CURRENT', sourceColumns: ['DBH_CURRENT'], scope: 'both' },
    { canonicalField: 'HOM', sourceColumns: [], scope: 'both' },
    { canonicalField: 'lx', sourceColumns: ['lx'], scope: 'trees' },
    { canonicalField: 'ly', sourceColumns: ['ly'], scope: 'trees' },
    { canonicalField: 'Date_measured', sourceColumns: ['Date_measured'], scope: 'both' },
    { canonicalField: 'notes', sourceColumns: [], scope: 'both' }
  ],
  headerSignature: 'v3:cglobalid_ctag_cstemtag_cspcode_cquadrat_clx_cly_cdatemeasured_cparentglobalid_cdbhcurrent'
} as const;

const VALID_VALIDATION = {
  valid: true,
  missingRequired: [],
  missingSourceColumns: [],
  duplicateSourceColumns: [],
  unknownFields: [],
  ignoredSourceColumns: [],
  missingSheetRoles: [],
  sheetRoleConflict: false
};

function mappingRequiredBody(serverMapping: object) {
  return {
    status: PREFLIGHT_STATUS_MAPPING_REQUIRED,
    error: PREFLIGHT_ERROR_MESSAGE,
    format: ARCGIS_FORMAT,
    sheets: PREFLIGHT_SHEETS,
    mapping: serverMapping,
    validation: VALID_VALIDATION
  };
}

const MAPPING_REQUIRED_STATUS_CODE = 200;

const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';
const MAPPING_REQUIRED_ALERT = '[data-testid="arcgis-mapping-required"]';
const OPEN_MAPPING_BUTTON = '[data-testid="arcgis-open-mapping"]';
const SHEET_ROLE_SELECT_TREES = '[data-testid="mapping-sheet-role-select-trees"]';
const SHEET_ROLE_SELECT_STEMS = '[data-testid="mapping-sheet-role-select-stems"]';
const APPLY_MAPPING_BUTTON = '[data-testid="mapping-apply"]';

// Real control labels harvested from the components, not guessed:
// - UploadParentModal ArcGIS confirm screen -> "Use Clean Re-Upload".
// - UploadParseFiles advance button reads "Continue to pre-flight" for arcgis_xlsx.
const CLEAN_REUPLOAD_BUTTON_LABEL = 'Use Clean Re-Upload';
const CONTINUE_TO_PREFLIGHT_LABEL = 'Continue to pre-flight';

/** Selects the ArcGIS workbook into the dropzone and advances into the pre-flight step. */
function uploadWorkbookAndEnterPreflight() {
  cy.visit(HARNESS_ARCGIS_ROUTE);
  cy.get('[data-testid="e2e-upload-harness"]').should('exist');

  // ArcGIS workbooks are imported as a clean re-upload (the only mode offered).
  cy.contains('button', CLEAN_REUPLOAD_BUTTON_LABEL).click();

  cy.uploadMeasurementFile(ARCGIS_FIXTURE, 'arcgis');
  cy.contains(ARCGIS_FIXTURE).should('be.visible');

  // Advancing fires the first pre-flight POST automatically (UploadArcgisPreflight
  // runs pre-flight on mount), which the @preflight intercept answers.
  cy.contains('button', CONTINUE_TO_PREFLIGHT_LABEL, { timeout: 15000 }).should('not.be.disabled').click();
}

/** Picks an option by exact text in the single visible Joy listbox (sheet-role selects). */
function selectSheetRole(selectTestid: string, sheetName: string) {
  cy.get(selectTestid).click();
  cy.get('[role="listbox"]')
    .filter(':visible')
    .first()
    .within(() => {
      cy.contains('[role="option"]', new RegExp(`^${sheetName}$`)).click();
    });
}

describe('ArcGIS pre-flight mapping journey', () => {
  beforeEach(() => {
    cy.stubMappingSession();
  });

  it('forces mapping, then resubmits pre-flight carrying the chosen sheet roles', () => {
    // First pre-flight: mapping required, server echoes a seed mapping WITHOUT roles
    // (the user must choose them). A route handler counts each pre-flight POST; using a
    // handler counter (not @alias.all) sidesteps the fact that the client aborts the prior
    // request before each call, which can perturb Cypress's per-alias request bookkeeping.
    // A route handler counts each pre-flight POST. We assert the count GROWS after Apply
    // rather than pinning exact totals, because the mount-time auto-preflight may fire more
    // than once under React's dev double-invoke; the wiring under test is that Apply issues
    // a NEW pre-flight, not the absolute call total.
    const preflightCalls = { count: 0 };
    cy.intercept('POST', '/api/arcgis/preflight', req => {
      preflightCalls.count += 1;
      req.reply({ statusCode: MAPPING_REQUIRED_STATUS_CODE, body: mappingRequiredBody(SEEDED_MAPPING) });
    }).as('preflight');

    uploadWorkbookAndEnterPreflight();

    // The first pre-flight fires automatically on mount.
    cy.wait('@preflight');

    // Entering the mapping-required phase renders the alert AND auto-opens the mapping
    // dialog (reducer MAPPING_REQUIRED -> dialogOpen: true). The "Map columns" button is
    // the re-open affordance after a cancel; here the dialog is already open. We assert
    // the affordance exists, then drive the open dialog directly.
    cy.get(MAPPING_REQUIRED_ALERT, { timeout: 15000 }).should('be.visible');
    cy.get(OPEN_MAPPING_BUTTON).should('exist');

    cy.get(MAPPING_DIALOG).should('be.visible');
    cy.get(SHEET_ROLE_SELECT_TREES).should('be.visible');
    cy.get(SHEET_ROLE_SELECT_STEMS).should('be.visible');

    // Choose the sheet roles; the selects must reflect the chosen sheets, which is the
    // mapping content the resubmission will carry.
    selectSheetRole(SHEET_ROLE_SELECT_TREES, TREES_SHEET_NAME);
    selectSheetRole(SHEET_ROLE_SELECT_STEMS, STEMS_SHEET_NAME);
    cy.get(SHEET_ROLE_SELECT_TREES).should('contain.text', TREES_SHEET_NAME);
    cy.get(SHEET_ROLE_SELECT_STEMS).should('contain.text', STEMS_SHEET_NAME);

    // Snapshot the pre-flight count, then Apply.
    cy.then(() => {
      cy.wrap(preflightCalls.count).as('countBeforeApply');
    });
    cy.get(APPLY_MAPPING_BUTTON).should('not.be.disabled').click();

    // Apply wires through onApply -> runPreflight(appliedMapping), which is the ONLY path
    // that issues a NEW pre-flight POST after the dialog is satisfied and the ONLY caller
    // that appends the mapping to the request (the mount-time call passes no mapping). The
    // count growing after Apply therefore proves the resubmission carried the user's mapping.
    //
    // The mapping's FIELD content is not asserted from the request body: the client sends
    // the workbook + mapping as multipart/form-data, which Cypress's intercept surfaces as
    // an opaque `{}` (it does not parse multipart bodies). The mapping content is instead
    // pinned by the dialog-state assertions above (the trees/stems selects show the chosen
    // sheets) plus the unit test, which owns the FormData payload shape directly.
    cy.get<number>('@countBeforeApply').then(countBeforeApply => {
      cy.wrap(preflightCalls, { timeout: 15000 }).should(calls => {
        expect((calls as { count: number }).count, 'a resubmit pre-flight fired after Apply').to.be.greaterThan(countBeforeApply);
      });
    });
  });

  it('repopulates the dialog from a server recovery mapping (no stale loop)', () => {
    // Mapping required, but the server returns a RECOVERY mapping whose sheetRoles are
    // already filled in (the no-stale-loop path: the component prefers this over reusing
    // its own submitted mapping).
    const recoveryMapping = {
      ...SEEDED_MAPPING,
      sheetRoles: { treesSheetName: TREES_SHEET_NAME, stemsSheetName: STEMS_SHEET_NAME }
    };
    cy.interceptMappingPreflight({ statusCode: MAPPING_REQUIRED_STATUS_CODE, body: mappingRequiredBody(recoveryMapping) });

    uploadWorkbookAndEnterPreflight();

    // The dialog auto-opens on the mapping-required phase (see test above); assert the
    // re-open affordance exists, then read the already-open dialog.
    cy.get(MAPPING_REQUIRED_ALERT, { timeout: 15000 }).should('be.visible');
    cy.get(OPEN_MAPPING_BUTTON).should('exist');

    cy.get(MAPPING_DIALOG).should('be.visible');

    // Sheet-role selects render the recovered assignments, not empty placeholders.
    cy.get(SHEET_ROLE_SELECT_TREES).should('contain.text', TREES_SHEET_NAME);
    cy.get(SHEET_ROLE_SELECT_STEMS).should('contain.text', STEMS_SHEET_NAME);

    // Because the recovery mapping already satisfies validation, Apply is enabled with
    // no further interaction — proving repopulation, not a reset-to-blank loop.
    cy.get(APPLY_MAPPING_BUTTON).should('not.be.disabled');
  });
});

export {};
