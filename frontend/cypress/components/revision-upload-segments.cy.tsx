import React from 'react';
import UploadRevisionApply from '@/components/uploadsystem/segments/uploadrevisionapply';
import UploadRevisionMatch from '@/components/uploadsystem/segments/uploadrevisionmatch';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { useAppStore } from '@/config/store/appstore';
import { ValidationRunner } from '@/config/validation-runner';

const TEST_PLOT = { plotID: 1, plotName: 'Test Plot' } as never;
const TEST_CENSUS = { plotCensusNumber: 1, dateRanges: [{ censusID: 2 }] } as never;

describe('Revision Upload Segments', () => {
  beforeEach(() => {
    // cy.stub() on a webpack ES-module namespace silently no-ops -- it does not throw,
    // so the stubs that used to sit here looked correct while the component read the
    // real zustand store, got undefined plotID/censusID, and skipped startValidation.
    // Seed the store through its own actions instead (prior art: sidebar.test.tsx:398).
    // Use the actions, not raw setState: appstore.ts carries a persistence guard that
    // trips when an empty selection overwrites a persisted one.
    useAppStore.getState().clearSelections();
    useAppStore.getState().setPlot(TEST_PLOT);
    useAppStore.getState().setCensus(TEST_CENSUS);
  });

  afterEach(() => {
    useAppStore.getState().clearSelections();
  });

  it('seeds plot and census context into the store', () => {
    // Guards the exact failure mode being fixed: a context mechanism that no-ops in
    // silence. If this fails, every other assertion in this spec is untrustworthy.
    expect(useAppStore.getState().currentPlot).to.deep.equal(TEST_PLOT);
    expect(useAppStore.getState().currentCensus).to.deep.equal(TEST_CENSUS);
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

    // ValidationRunner is a plain object literal, so `start` is a writable property --
    // unlike an ES-module namespace binding. The hook delegates to it at call time, so
    // this observes the exact contract without launching the module-level singleton's
    // multi-request workflow inside a component test.
    cy.stub(ValidationRunner, 'start').as('startValidation');

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
        invalidRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        bulkPlanHash="cypress-plan-hash"
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
        onPlanConflict={cy.stub().as('onPlanConflict')}
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
