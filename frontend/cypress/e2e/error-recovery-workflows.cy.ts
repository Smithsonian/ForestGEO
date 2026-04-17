/// <reference types="cypress" />

import { buildAdminSite, buildAdminUser, mockAdminUsersApi } from '../support/admin-users-helpers';

function openAdminUsersPage() {
  cy.visitAuthenticatedPage('/admin/users');
}

describe('Error Recovery Workflows', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('adminUser');
  });

  it('shows a load error instead of leaving the admin users page stuck in loading state', () => {
    mockAdminUsersApi({
      users: [],
      sites: [buildAdminSite()],
      userResponses: [{ forceNetworkError: true }]
    });

    openAdminUsersPage();
    cy.wait('@fetchAdminUsers');

    cy.get('[role="alert"]').should('contain.text', 'Failed');
    cy.get('[role="progressbar"]').should('not.exist');
  });

  it('recovers after a transient load failure when the page is retried', () => {
    mockAdminUsersApi({
      users: [buildAdminUser({ userID: 7, firstName: 'Alicia', lastName: 'Rivera' })],
      sites: [buildAdminSite()],
      userResponses: [
        {
          statusCode: 500,
          body: []
        },
        {
          statusCode: 200,
          body: [buildAdminUser({ userID: 7, firstName: 'Alicia', lastName: 'Rivera' })]
        }
      ]
    });

    openAdminUsersPage();
    cy.wait('@fetchAdminUsers');
    cy.get('[role="alert"]').should('contain.text', 'Failed to load users');

    cy.reload();
    cy.wait('@fetchAdminUsers');
    cy.wait('@fetchAdminSites');

    cy.get('input[aria-label="first name value"]').first().should('have.value', 'Alicia');
    cy.contains('button', 'Save Changes').should('be.disabled');
    cy.contains('button', 'Discard Changes').should('be.disabled');
  });

  it('preserves unsaved edits when a save request fails', () => {
    mockAdminUsersApi({
      users: [buildAdminUser({ userID: 11, firstName: 'Original', lastName: 'Operator' })],
      sites: [buildAdminSite()],
      patchHandler: () => ({
        statusCode: 500,
        body: {
          message: 'Save failed'
        }
      })
    });

    openAdminUsersPage();
    cy.wait('@fetchAdminUsers');
    cy.wait('@fetchAdminSites');

    cy.get('input[aria-label="first name value"]').first().clear().type('Modified');
    cy.contains('button', 'Save Changes').should('not.be.disabled').click();

    cy.wait('@saveAdminUsers');
    cy.get('[role="alert"]').should('contain.text', 'Failed to save changes');
    cy.get('input[aria-label="first name value"]').first().should('have.value', 'Modified');
    cy.contains('button', 'Save Changes').should('not.be.disabled');
    cy.contains('button', 'Discard Changes').should('not.be.disabled');
  });

  it('lets the user discard local edits after a failed save', () => {
    mockAdminUsersApi({
      users: [buildAdminUser({ userID: 12, firstName: 'Original', lastName: 'Rollback' })],
      sites: [buildAdminSite()],
      patchHandler: () => ({
        statusCode: 500,
        body: {
          message: 'Save failed'
        }
      })
    });

    openAdminUsersPage();
    cy.wait('@fetchAdminUsers');
    cy.wait('@fetchAdminSites');

    cy.get('input[aria-label="first name value"]').first().clear().type('Modified');
    cy.contains('button', 'Save Changes').click();
    cy.wait('@saveAdminUsers');

    cy.contains('button', 'Discard Changes').click();

    cy.get('input[aria-label="first name value"]').first().should('have.value', 'Original');
    cy.contains('button', 'Save Changes').should('be.disabled');
    cy.contains('button', 'Discard Changes').should('be.disabled');
  });

  it('allows a second save attempt to succeed after a transient save error', () => {
    let saveAttempt = 0;

    mockAdminUsersApi({
      users: [buildAdminUser({ userID: 13, firstName: 'Retry', lastName: 'Target' })],
      sites: [buildAdminSite()],
      patchHandler: requestBody => {
        saveAttempt += 1;

        if (saveAttempt === 1) {
          return {
            statusCode: 500,
            body: {
              message: 'Transient failure'
            }
          };
        }

        return {
          statusCode: 200,
          users: [
            buildAdminUser({
              userID: 13,
              firstName: String(requestBody.newRow.firstName ?? 'Retry'),
              lastName: 'Target'
            })
          ]
        };
      }
    });

    openAdminUsersPage();
    cy.wait('@fetchAdminUsers');
    cy.wait('@fetchAdminSites');

    cy.get('input[aria-label="first name value"]').first().clear().type('Retried');
    cy.contains('button', 'Save Changes').click();
    cy.wait('@saveAdminUsers');
    cy.get('[role="alert"]').should('contain.text', 'Failed to save changes');

    cy.contains('button', 'Save Changes').click();
    cy.wait('@saveAdminUsers');

    cy.get('[role="alert"]').should('not.exist');
    cy.get('input[aria-label="first name value"]').first().should('have.value', 'Retried');
    cy.contains('button', 'Save Changes').should('be.disabled');
    cy.contains('button', 'Discard Changes').should('be.disabled');
  });
});
