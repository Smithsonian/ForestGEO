import React from 'react';
import UploadRevisionApply from '@/components/uploadsystem/segments/uploadrevisionapply';
import UploadRevisionMatch from '@/components/uploadsystem/segments/uploadrevisionmatch';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import * as compatHooks from '@/app/contexts/compat-hooks';
import * as backgroundValidationHooks from '@/app/hooks/usebackgroundvalidation';

describe('Revision Upload Segments', () => {
  beforeEach(() => {
    cy.stub(compatHooks, 'usePlotContext').returns({
      plotID: 1,
      plotName: 'Test Plot'
    } as any);
    cy.stub(compatHooks, 'useOrgCensusContext').returns({
      plotCensusNumber: 1,
      dateRanges: [{ censusID: 2 }]
    } as any);
  });

  afterEach(() => {
    Cypress.sinon.restore();
  });

  it('requires explicit confirmation before new rows can be applied', () => {
    const onApply = cy.stub().as('onApply');

    cy.mount(
      <UploadRevisionMatch
        matchedRows={[]}
        newRows={[
          {
            csvIndex: 0,
            csvRow: {
              tag: 'T200',
              stemtag: '1',
              spcode: 'ACACDR',
              quadrat: '0102',
              dbh: '9.4',
              date: '2024-02-05'
            }
          }
        ]}
        invalidRows={[]}
        counts={{
          matched: 0,
          matchedWithChanges: 0,
          new: 1,
          invalid: 0,
          total: 1
        }}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={cy.stub()}
        onApply={onApply}
        handleReturnToStart={async () => {}}
      />
    );

    cy.contains('Apply 0 Revisions').should('be.disabled');
    cy.contains('Confirm new row insertion').click();
    cy.contains('Apply 1 Revisions').should('not.be.disabled').click();
    cy.get('@onApply').should('have.been.calledOnceWith', true);
  });

  it('shows recovery actions on apply conflict and retries successfully', () => {
    const setReviewState = cy.stub().as('setReviewState');
    const setIsDataUnsaved = cy.stub().as('setIsDataUnsaved');
    const startValidation = cy.stub().as('startValidation');

    cy.stub(backgroundValidationHooks, 'useBackgroundValidation').returns({
      startValidation
    } as any);

    cy.clock();

    cy.window().then(win => {
      cy.stub(win, 'fetch')
        .onFirstCall()
        .resolves({
          ok: false,
          json: async () => ({ error: 'Revision apply blocked: upload session is active.' })
        } as Response)
        .onSecondCall()
        .resolves({
          ok: true,
          json: async () => ({
            updatedCount: 1,
            skippedCount: 0,
            insertedCount: 0,
            deletedDuplicateCount: 0,
            applyErrors: [],
            validationPending: true
          })
        } as Response)
        .as('applyFetch');
    });

    cy.mount(
      <UploadRevisionApply
        matchedRows={[
          {
            coreMeasurementID: 12345,
            csvRow: {
              stemid: '12345',
              dbh: '15.6'
            }
          }
        ]}
        newRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
      />
    );

    cy.contains('Failed to Apply Revisions').should('be.visible');
    cy.contains('Revision apply blocked: upload session is active.').should('be.visible');
    cy.contains('Back to Review').click();
    cy.get('@setReviewState').should('have.been.calledWith', ReviewStates.REVISION_MATCH);

    cy.contains('Retry Apply').click();
    cy.get('@applyFetch').should('have.been.calledTwice');
    cy.contains('Revisions Applied').should('be.visible');
    cy.get('@setIsDataUnsaved').should('have.been.calledWith', false);
    cy.get('@startValidation').should('have.been.calledWith', {
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2
    });

    cy.tick(2000);
    cy.get('@setReviewState').should('have.been.calledWith', ReviewStates.UPLOAD_AZURE);
  });
});
