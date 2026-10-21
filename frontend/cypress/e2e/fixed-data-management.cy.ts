/// <reference types="cypress" />

import { buildAttributeRow, buildQuadratRow, buildTaxonomyRow, mockIsolatedGridApi } from '../support/grid-api-helpers';
import { ATTRIBUTE_STATUS_UNSPECIFIED_HINT } from '@/lib/db/definitions/core';

function openStatusEditor() {
  // MUI Material's Select (SelectInput.js) opens the menu on mousedown and closes it in its
  // mouseup handler by checking paperRef.current.contains(target). A synthetic .click() fires
  // mousedown+mouseup back-to-back in the same tick, before React has mounted the listbox, so
  // paperRef.current is still null and the handler throws. Split the click into its two real
  // events with an explicit mount boundary in between: mousedown opens the menu, we wait for the
  // listbox to actually be in the DOM and visible, then mouseup (still on the combobox, matching
  // a real click) completes the gesture against an already-mounted paper.
  cy.get('.MuiDataGrid-row').first().find('[data-field="status"] [role="combobox"]').as('statusCombobox');
  cy.get('@statusCombobox').trigger('mousedown', 'center', { button: 0 });
  cy.get('[role="listbox"]:visible').should('be.visible');
  cy.get('@statusCombobox').trigger('mouseup', 'center', { button: 0, force: true });
  return cy.get('[role="listbox"]:visible');
}

const MANUAL_ATTRIBUTES_FORM = '[role="alertdialog"]';
const UNSPECIFIED_STATUS_OPTION = 'Unspecified (blank)';

/**
 * Opens the manual form's first-row Status cell editor (cell edit mode opens the select at once), picks an option and commits it
 * by moving focus to the Code cell. The select stays in edit mode until focus leaves it, and the commit is asynchronous: clicking
 * Save or re-opening the cell before it lands races the row update, which then re-marks the saved row as unsaved and keeps
 * Finalize Changes disabled.
 */
function chooseManualFormStatus(optionLabel: string) {
  const firstRowCell = (field: string) => cy.get(MANUAL_ATTRIBUTES_FORM).find('.MuiDataGrid-row').first().find(`[data-field="${field}"]`);
  firstRowCell('status').dblclick();
  cy.get('[role="listbox"]:visible').contains('[role="option"]', optionLabel).click();
  firstRowCell('code').click();
  firstRowCell('status').find('[role="combobox"]').should('not.exist');
}

function startManualStemCodeRow(code: string) {
  cy.contains('button', /^Add record$/).click();
  cy.contains(MANUAL_ATTRIBUTES_FORM, 'Manual Input Form - Attributes').should('be.visible');
  cy.get(MANUAL_ATTRIBUTES_FORM).within(() => {
    cy.contains('button', 'New Row').click();
    cy.get('[data-field="code"] input', { timeout: 4000 }).should('be.focused').type(`${code}{enter}`);
  });
}

function saveAndFinalizeManualForm() {
  cy.get(MANUAL_ATTRIBUTES_FORM).within(() => {
    cy.contains('button', 'Save').click();
    cy.contains('Rows saved and ready to finalize.').should('be.visible');
    cy.contains('button', 'Finalize Changes').should('not.be.disabled').click();
  });
}

function interceptFinalizedStatus(alias: string, expectedCode: string, expectedStatus: string | null) {
  cy.intercept('POST', '**/api/bulkcrud', req => {
    const fileRows = Object.values(req.body.fileRowSet as Record<string, { code?: string; status?: unknown }>);
    expect(fileRows, `submitted rows ${JSON.stringify(fileRows)}`).to.have.length(1);
    expect(fileRows[0].code).to.equal(expectedCode);
    expect(fileRows[0].status, `submitted status for ${expectedCode}`).to.equal(expectedStatus);
    req.reply({ statusCode: 200, body: { success: true } });
  }).as(alias);
}

/** Waits for the finalize request and logs the submitted rows (Cypress commands can't run inside an intercept handler). */
function waitForFinalizedRows(alias: string) {
  cy.wait(`@${alias}`).then(interception => {
    cy.task('log', `[manual stem code finalize ${alias}] rows=${JSON.stringify(interception.request.body.fileRowSet)}`);
  });
}

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function openFixedDataGrid(label: 'Stem Codes' | 'Quadrats' | 'Species List') {
  selectDefaultCensusContext();
  cy.openFixedDataLink(label);
  cy.get('[role="grid"]').should('be.visible');
}

describe('Fixed Data Management', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('loads the Stem Codes grid with the current toolbar and visible rows', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [
        buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Canopy emergent', status: 'alive' }),
        buildAttributeRow({ id: 2, code: 'ATTR002', description: 'Gap specialist', status: 'alive' }),
        buildAttributeRow({ id: 3, code: 'ATTR003', description: 'Liana damage', status: 'dead' })
      ]
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('[role="row"]', 'ATTR001').should('contain', 'Canopy emergent');
    cy.contains('[role="row"]', 'ATTR003').should('contain', 'dead');
    cy.get('input[placeholder="Search All Fields..."]').should('be.visible');
    cy.get('[aria-label="Export as CSV"]').should('exist');
    cy.contains('button', /^Add record$/).should('be.visible');
    cy.contains('button', /^Upload$/).should('be.visible');
  });

  it('enters and cancels Stem Code row edit mode through the current action buttons', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Original attribute', status: 'alive' })]
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('.MuiDataGrid-row', 'ATTR001').as('attributeRow');
    cy.get('@attributeRow').find('button').eq(0).click({ force: true });

    cy.get('.MuiDataGrid-row').first().find('button').should('have.length.at.least', 2);
    cy.get('.MuiDataGrid-row')
      .first()
      .find('[data-field="status"]')
      .within(() => {
        cy.get('input, button, [role="combobox"]').should('exist');
      });

    cy.get('.MuiDataGrid-row').first().find('button').eq(1).click({ force: true });
    cy.contains('.MuiDataGrid-row', 'ATTR001').should('contain', 'Original attribute');
  });

  it('clears a Stem Code status to Unspecified via the editor and saves SQL NULL (#425)', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Canopy emergent', status: 'alive' })]
    });

    openFixedDataGrid('Stem Codes');
    // Consume the page-load GET now, by itself, so the later post-reload cy.wait on this same
    // alias deterministically resolves to the reload's fresh request instead of this stale one.
    cy.wait('@fetchIsolatedGridRows');

    cy.contains('.MuiDataGrid-row', 'ATTR001').find('button').eq(0).click({ force: true });

    openStatusEditor().within(() => {
      cy.contains('[role="option"]', 'Unspecified (blank)').click();
    });

    cy.get('.MuiDataGrid-row').first().find('button').eq(0).click({ force: true });
    cy.contains('[role="dialog"]', 'Confirm Changes').should('be.visible');
    cy.contains('button', 'Save Changes').click();

    cy.wait('@saveIsolatedGridRow').then(interception => {
      expect(interception.request.body.newRow.status).to.equal(null);
    });

    // finishPersistedSave commits the saved row into local grid state before any background
    // refetch -- the view-mode cell (and its blank-status hint) already reflects the save here.
    cy.contains('.MuiDataGrid-row', 'ATTR001').within(() => {
      cy.contains('Unspecified').should('be.visible');
      cy.get(`[aria-label="${ATTRIBUTE_STATUS_UNSPECIFIED_HINT}"]`).should('exist');
    });

    // Prove the NULL actually persisted server-side, not just in optimistic local state: reload
    // (site/plot/census survive via the persisted zustand store, matching selection-persistence.cy.ts)
    // and re-read the row from a fresh GET against the mock's own mutated state -- mockIsolatedGridApi's
    // PATCH handler writes the accepted row into its own `state.rows`, which is exactly what this
    // reload's GET now serves back.
    cy.reload();
    cy.get('[role="grid"]').should('be.visible');
    cy.wait('@fetchIsolatedGridRows');
    cy.contains('.MuiDataGrid-row', 'ATTR001').within(() => {
      cy.contains('Unspecified').should('be.visible');
      cy.get(`[aria-label="${ATTRIBUTE_STATUS_UNSPECIFIED_HINT}"]`).should('exist');
    });
  });

  it('restores a Stem Code status from Unspecified back to an explicit value and saves it (#425)', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 2, code: 'ATTR002', description: 'Gap specialist', status: null })]
    });

    openFixedDataGrid('Stem Codes');
    // Consume the page-load GET now, by itself, so the later post-reload cy.wait on this same
    // alias deterministically resolves to the reload's fresh request instead of this stale one.
    cy.wait('@fetchIsolatedGridRows');

    cy.contains('.MuiDataGrid-row', 'ATTR002').within(() => {
      cy.contains('Unspecified').should('be.visible');
    });

    cy.contains('.MuiDataGrid-row', 'ATTR002').find('button').eq(0).click({ force: true });

    openStatusEditor().within(() => {
      cy.contains('[role="option"]', /^alive$/).click();
    });

    cy.get('.MuiDataGrid-row').first().find('button').eq(0).click({ force: true });
    cy.contains('[role="dialog"]', 'Confirm Changes').should('be.visible');
    cy.contains('button', 'Save Changes').click();

    cy.wait('@saveIsolatedGridRow').then(interception => {
      expect(interception.request.body.newRow.status).to.equal('alive');
    });

    cy.contains('.MuiDataGrid-row', 'ATTR002').within(() => {
      cy.contains('alive').should('be.visible');
      cy.get(`[aria-label="${ATTRIBUTE_STATUS_UNSPECIFIED_HINT}"]`).should('not.exist');
    });

    // Prove the explicit status actually persisted server-side (mockIsolatedGridApi's PATCH
    // handler writes the accepted row into its own `state.rows`): reload, re-read from a fresh
    // GET, and confirm the blank-status hint stays gone now that the row has a real status again.
    cy.reload();
    cy.get('[role="grid"]').should('be.visible');
    cy.wait('@fetchIsolatedGridRows');
    cy.contains('.MuiDataGrid-row', 'ATTR002').within(() => {
      cy.contains('alive').should('be.visible');
      cy.get(`[aria-label="${ATTRIBUTE_STATUS_UNSPECIFIED_HINT}"]`).should('not.exist');
    });
  });

  it('discards a Stem Code status edit when Cancel is clicked, sending no save request (#425)', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 3, code: 'ATTR003', description: 'Liana damage', status: 'dead' })]
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('.MuiDataGrid-row', 'ATTR003').find('button').eq(0).click({ force: true });

    openStatusEditor().within(() => {
      cy.contains('[role="option"]', 'Unspecified (blank)').click();
    });

    cy.get('.MuiDataGrid-row').first().find('button').eq(1).click({ force: true });

    cy.contains('.MuiDataGrid-row', 'ATTR003').should('contain', 'dead');
    cy.get('@saveIsolatedGridRow.all').should('have.length', 0);
  });

  it('keeps a failed Stem Code status save recoverable in edit mode with no success message (#425)', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 4, code: 'ATTR004', description: 'Buttress root', status: 'alive' })],
      onPatch: () => ({ statusCode: 500, body: { message: 'Row update failed' } })
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('.MuiDataGrid-row', 'ATTR004').find('button').eq(0).click({ force: true });

    openStatusEditor().within(() => {
      cy.contains('[role="option"]', 'Unspecified (blank)').click();
    });

    cy.get('.MuiDataGrid-row').first().find('button').eq(0).click({ force: true });
    cy.contains('[role="dialog"]', 'Confirm Changes').should('be.visible');
    cy.contains('button', 'Save Changes').click();
    cy.wait('@saveIsolatedGridRow');

    cy.contains('Error: Row update failed').should('be.visible');
    cy.contains('Row successfully updated').should('not.exist');

    // The row never left edit mode: the status editor is still showing, recoverable for retry.
    cy.get('.MuiDataGrid-row').first().find('[data-field="status"] [role="combobox"]').should('exist');
  });

  it('finalizes a blank-status manual Stem Code entry, sending SQL NULL (never the string "null") (#425)', () => {
    mockIsolatedGridApi({ gridType: 'attributes', rows: [] });

    cy.intercept('POST', '**/api/bulkcrud', req => {
      const fileRows = Object.values(req.body.fileRowSet as Record<string, { code?: string; status?: unknown }>);
      expect(fileRows).to.have.length(1);
      expect(fileRows[0].code).to.equal('ATTR100');
      // An untouched status can only serialise to SQL NULL (convertRowsToFileRowSet, isolatedmultilinedatagridcommons.tsx:224-225);
      // '' and the string 'null' are both wrong.
      expect(fileRows[0].status, 'an untouched status must be sent as SQL NULL').to.equal(null);
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('finalizeAttributeRows');

    openFixedDataGrid('Stem Codes');

    cy.contains('button', /^Add record$/).click();
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Attributes').should('be.visible');

    cy.get('[role="alertdialog"]').within(() => {
      cy.contains('button', 'New Row').click();
      cy.get('[data-field="code"] input', { timeout: 4000 }).should('be.focused').type('ATTR100{enter}');
      cy.contains('button', 'Save').click();
      cy.contains('Rows saved and ready to finalize.').should('be.visible');
      cy.contains('button', 'Finalize Changes').should('not.be.disabled').click();
    });

    cy.wait('@finalizeAttributeRows');
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Attributes').should('not.exist');
  });

  it('submits omitted when it is chosen in the manual form Status select (#524 item 9)', () => {
    mockIsolatedGridApi({ gridType: 'attributes', rows: [] });
    interceptFinalizedStatus('finalizeOmittedStatus', 'ATTR101', 'omitted');

    openFixedDataGrid('Stem Codes');
    startManualStemCodeRow('ATTR101');
    chooseManualFormStatus('omitted');
    saveAndFinalizeManualForm();

    waitForFinalizedRows('finalizeOmittedStatus');
  });

  it('submits SQL NULL when omitted is replaced by Unspecified (blank) (#524 item 9)', () => {
    mockIsolatedGridApi({ gridType: 'attributes', rows: [] });
    interceptFinalizedStatus('finalizeUnspecifiedStatus', 'ATTR102', null);

    openFixedDataGrid('Stem Codes');
    startManualStemCodeRow('ATTR102');
    chooseManualFormStatus('omitted');
    chooseManualFormStatus(UNSPECIFIED_STATUS_OPTION);
    saveAndFinalizeManualForm();

    waitForFinalizedRows('finalizeUnspecifiedStatus');
  });

  it('keeps a saved alive status when another cell of the row is edited and saved again (#524 item 9)', () => {
    mockIsolatedGridApi({ gridType: 'attributes', rows: [] });
    interceptFinalizedStatus('finalizeKeptStatus', 'ATTR103', 'alive');

    openFixedDataGrid('Stem Codes');
    startManualStemCodeRow('ATTR103');
    chooseManualFormStatus('alive');
    cy.get(MANUAL_ATTRIBUTES_FORM).within(() => {
      cy.contains('button', 'Save').click();
      cy.contains('Rows saved and ready to finalize.').should('be.visible');
      cy.get('.MuiDataGrid-row').first().find('[data-field="description"]').dblclick();
      cy.get('[data-field="description"] input').type('Edited after save{enter}');
    });
    saveAndFinalizeManualForm();

    waitForFinalizedRows('finalizeKeptStatus');
  });

  it('opens the Species List manual entry form and species-limits dialog from the current grid', () => {
    cy.viewport(1280, 800);
    cy.intercept('GET', '**/api/specieslimits/1/5**', {
      statusCode: 200,
      body: [
        {
          speciesLimitID: 1,
          speciesID: 201,
          plotID: 1,
          censusID: 5,
          limitType: 'DBH',
          lowerBound: 5,
          upperBound: 60
        }
      ]
    }).as('getSpeciesLimits');

    mockIsolatedGridApi({
      gridType: 'alltaxonomiesview',
      rows: [
        buildTaxonomyRow({ id: 201, speciesID: 201, speciesCode: 'RUBI04', speciesName: 'berteriana', genus: 'Psychotria' }),
        buildTaxonomyRow({ id: 202, speciesID: 202, speciesCode: 'ANOPKL', speciesName: 'klotzschiana', genus: 'Anopterus' })
      ]
    });

    openFixedDataGrid('Species List');
    cy.wait('@getSpeciesLimits');

    cy.contains('[role="row"]', 'RUBI04').should('contain', 'berteriana');

    cy.contains('button', /^Add record$/)
      .should('be.visible')
      .click();
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Species').should('be.visible');
    cy.get('[aria-label="close"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Species').should('not.exist');

    cy.contains('.MuiDataGrid-row', 'RUBI04').within(() => {
      cy.contains('button', 'Modify').click({ force: true });
    });

    cy.contains('[role="dialog"]', 'Species Limits for berteriana').should('be.visible');
    cy.contains('[role="dialog"]', 'Modify Species Limit').should('be.visible');
    // Item 4: the upper-limit Input must sit inside the dialog at a 1280px viewport (AccordionDetails clips overflow).
    cy.contains('[role="dialog"]', 'Species Limits for berteriana').then($dialog => {
      const dialogBox = $dialog[0].getBoundingClientRect();
      cy.get('#set-species-upper-limit')
        .closest('.MuiInput-root')
        .then($upperInput => {
          const upperBox = $upperInput[0].getBoundingClientRect();
          cy.task(
            'log',
            `[species limits layout] dialog left=${dialogBox.left} right=${dialogBox.right}; upper input left=${upperBox.left} right=${upperBox.right}`
          );
          expect(upperBox.left, 'upper-limit input left edge').to.be.at.least(dialogBox.left);
          expect(upperBox.right, 'upper-limit input right edge').to.be.at.most(dialogBox.right);
        });
    });
    cy.get('body').type('{esc}');
    cy.contains('[role="dialog"]', 'Species Limits for berteriana').should('not.exist');
  });

  it('opens quadrat row edit mode and deletes another row through the current action buttons', () => {
    mockIsolatedGridApi({
      gridType: 'quadrats',
      rows: [
        buildQuadratRow({ quadratID: 101, quadratName: 'Q0101', startX: 0, startY: 0 }),
        buildQuadratRow({ quadratID: 102, quadratName: 'Q0102', startX: 20, startY: 0 })
      ]
    });

    openFixedDataGrid('Quadrats');

    cy.contains('.MuiDataGrid-row', 'Q0101').as('editedQuadratRow');
    cy.get('@editedQuadratRow').find('button').eq(0).click({ force: true });

    cy.get('.MuiDataGrid-row').first().find('button').should('have.length.at.least', 2);
    cy.get('.MuiDataGrid-row').first().find('button').eq(1).click({ force: true });

    cy.contains('.MuiDataGrid-row', 'Q0102').find('button').eq(1).click({ force: true });
    cy.contains('[role="dialog"]', 'Confirm Deletion').should('be.visible');
    cy.contains('[role="dialog"]', 'Delete “Q0102”? This action cannot be undone.').should('be.visible');
    cy.contains('button', 'Confirm').click({ force: true });
    cy.wait('@deleteIsolatedGridRow');

    cy.contains('.MuiDataGrid-row:visible', 'Q0102').should('not.exist');
    cy.contains('.MuiDataGrid-row', 'Q0101').should('be.visible');
  });
});
