import React from 'react';
import RunStatus from '@/components/provisioning/RunStatus';

const RUN_ID = 999;
const SCHEMA_NAME = 'forestgeo_rabi_component';

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

function buildRunRecord(status: 'completed' | 'failed' | 'aborted') {
  return {
    runId: RUN_ID,
    status,
    startedBy: 'admin@component.test',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    siteName: 'Rabi',
    schemaName: SCHEMA_NAME,
    input: {}
  };
}

function buildSteps(status: 'completed' | 'failed') {
  return STEP_KEYS.map((key, index) => ({
    stepId: index + 1,
    runId: RUN_ID,
    stepIndex: index,
    stepKey: key,
    status: status === 'failed' && index === 1 ? 'failed' : status === 'failed' && index > 1 ? 'pending' : 'completed',
    errorMessage: status === 'failed' && index === 1 ? 'Synthetic failure' : null,
    errorStack: status === 'failed' && index === 1 ? 'Error: Synthetic failure' : null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  }));
}

describe('RunStatus', () => {
  it('requires exact schema confirmation before deleting a completed provisioned site', () => {
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
      req.reply({ statusCode: 200, body: { ok: true } });
    }).as('teardown');

    cy.mount(<RunStatus runId={RUN_ID} />);
    cy.wait('@pollStatus');
    cy.contains('button', 'Go to site').should('be.visible');
    cy.contains('button', 'Delete provisioned site').click();

    cy.contains('button', 'Delete site').should('be.disabled');
    cy.get('[aria-label="Confirm schema name"]').type(`${SCHEMA_NAME}_wrong`);
    cy.contains('button', 'Delete site').should('be.disabled');
    cy.get('[aria-label="Confirm schema name"]').clear().type(SCHEMA_NAME);
    cy.contains('button', 'Delete site').should('not.be.disabled').click();

    cy.wait('@teardown');
    cy.wait('@pollStatus');
    cy.contains('aborted').should('be.visible');
  });

  it('keeps failed-run abort separate from completed-run teardown', () => {
    cy.intercept('GET', `/api/admin/provision/${RUN_ID}`, {
      run: buildRunRecord('failed'),
      steps: buildSteps('failed'),
      stuckStepIndex: null
    }).as('pollStatus');

    cy.mount(<RunStatus runId={RUN_ID} />);
    cy.wait('@pollStatus');

    cy.contains('button', 'Abort & drop schema').should('be.visible');
    cy.contains('button', 'Retry from failed step').should('be.visible');
    cy.contains('button', 'Delete provisioned site').should('not.exist');
  });
});
