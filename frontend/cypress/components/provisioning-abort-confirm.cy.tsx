import React from 'react';
import AbortConfirmDialog from '../../components/provisioning/AbortConfirmDialog';

const SCHEMA_NAME = 'forestgeo_test';

describe('AbortConfirmDialog', () => {
  it('disables the destructive button until the schema name is typed exactly', () => {
    const onConfirm = cy.stub().as('confirm');
    const onCancel = cy.stub().as('cancel');

    cy.mount(
      <AbortConfirmDialog
        open
        schemaName={SCHEMA_NAME}
        inFlight={false}
        title="Abort run"
        warning="This drops the schema."
        confirmLabel="Abort"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    cy.contains('button', 'Abort').should('be.disabled');

    cy.get('[aria-label="Confirm schema name"]').type(`${SCHEMA_NAME}_wrong`);
    cy.contains('button', 'Abort').should('be.disabled');

    cy.get('[aria-label="Confirm schema name"]').clear().type(SCHEMA_NAME);
    cy.contains('button', 'Abort').should('not.be.disabled').click();
    cy.get('@confirm').should('have.been.called');
  });

  it('disables Cancel while inFlight', () => {
    const onConfirm = cy.stub().as('confirm');
    const onCancel = cy.stub().as('cancel');

    cy.mount(
      <AbortConfirmDialog
        open
        schemaName={SCHEMA_NAME}
        inFlight
        title="Abort run"
        warning="This drops the schema."
        confirmLabel="Abort"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    cy.contains('button', 'Cancel').should('be.disabled');
    cy.get('[aria-label="Confirm schema name"]').should('be.disabled');
  });

  it('invokes onCancel when Cancel is clicked while not in flight', () => {
    const onConfirm = cy.stub().as('confirm');
    const onCancel = cy.stub().as('cancel');

    cy.mount(
      <AbortConfirmDialog
        open
        schemaName={SCHEMA_NAME}
        inFlight={false}
        title="Abort run"
        warning="This drops the schema."
        confirmLabel="Abort"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    cy.get('[aria-label="Confirm schema name"]').type('partial');
    cy.contains('button', 'Cancel').click();
    cy.get('@cancel').should('have.been.called');
    cy.get('@confirm').should('not.have.been.called');
  });
});
