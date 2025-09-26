// cypress/e2e/responsive/modal-responsiveness.cy.ts
// Test suite for modal component responsiveness

import { DEVICE_VIEWPORTS, BREAKPOINT_TESTS } from '../../support/responsive-commands';

describe('Modal Responsiveness Tests', () => {
  beforeEach(() => {
    // Mock authentication and required contexts
    cy.window().then(win => {
      win.localStorage.setItem('auth-token', 'mock-token');
    });
  });

  describe('Failed Measurements Modal', () => {
    it('should be responsive across all device sizes', () => {
      cy.visit('/measurementshub/summary');

      // Assume we have a way to trigger the failed measurements modal
      // This would need to be adapted based on your actual trigger mechanism
      cy.get('[data-testid="failed-measurements-trigger"]').should('exist');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        cy.log(`Testing Failed Measurements Modal on ${device.name}`);

        // Trigger modal (adapt based on actual implementation)
        cy.get('[data-testid="failed-measurements-trigger"]').click({ force: true });

        // Check modal responsiveness
        cy.get('[role="alertdialog"]').should('be.visible');
        cy.checkModalResponsiveness('[role="alertdialog"]');

        // Test specific responsive behaviors
        if (device.width <= 600) {
          // Mobile: Modal should be full width
          cy.get('[role="alertdialog"]')
            .should('have.css', 'width')
            .and('match', /100%|100vw/);
        } else if (device.width <= 900) {
          // Tablet: Modal should have some margins
          cy.get('[role="alertdialog"]').then($modal => {
            const modalWidth = $modal.width() || 0;
            expect(modalWidth).to.be.lessThan(device.width * 0.98);
          });
        }

        // Check button responsiveness
        cy.get('[data-testid="clear-failed-button"]').should('be.visible');
        cy.get('[data-testid="clear-temp-button"]').should('be.visible');
        cy.get('[data-testid="reingest-button"]').should('be.visible');

        if (device.hasTouch) {
          cy.checkTouchAccessibility('[data-testid="clear-failed-button"]');
          cy.checkTouchAccessibility('[data-testid="reingest-button"]');
        }

        // Check confirmation panels responsiveness
        cy.get('[data-testid="clear-failed-button"]').click({ force: true });
        cy.get('[data-testid="confirmation-panel"]').should('be.visible');

        if (device.width <= 600) {
          // On mobile, confirmation should stack vertically
          cy.get('[data-testid="confirmation-buttons"]').should('have.css', 'flex-direction', 'column');
        }

        // Close modal
        cy.get('[data-testid="cancel-button"]').click({ force: true });
        cy.get('body').click(0, 0); // Click outside to close modal
      });
    });

    it('should handle content overflow correctly', () => {
      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.visit('/measurementshub/summary');
        cy.get('[data-testid="failed-measurements-trigger"]').click({ force: true });

        // Check that content doesn't cause horizontal scroll
        cy.window().its('document.documentElement.scrollWidth').should('equal', breakpoint.width);

        // Check vertical scrolling is available when needed
        cy.get('[data-testid="modal-content"]').then($content => {
          const contentHeight = $content[0].scrollHeight;
          const containerHeight = $content.height() || 0;

          if (contentHeight > containerHeight) {
            cy.wrap($content)
              .should('have.css', 'overflow-y')
              .and('match', /auto|scroll/);
          }
        });
      });
    });
  });

  describe('General Modal Patterns', () => {
    const modalTriggers = [
      { trigger: '[data-testid="github-feedback-trigger"]', modal: '[data-testid="github-feedback-modal"]' },
      { trigger: '[data-testid="validation-modal-trigger"]', modal: '[data-testid="validation-modal"]' }
      // Add more modal triggers as they exist in your app
    ];

    modalTriggers.forEach(({ trigger, modal }) => {
      it(`should test ${trigger} modal responsiveness`, () => {
        cy.visit('/measurementshub/summary');

        cy.testAcrossDevices(DEVICE_VIEWPORTS.slice(0, 5), device => {
          // Test subset for CI speed
          cy.get('body').then($body => {
            if ($body.find(trigger).length > 0) {
              cy.get(trigger).click({ force: true });
              cy.get(modal).should('be.visible');
              cy.checkModalResponsiveness(modal);

              // Close modal
              cy.get('body').type('{esc}');
              cy.wait(300);
            }
          });
        });
      });
    });
  });

  describe('Upload Modal Responsiveness', () => {
    it('should handle upload progress modals responsively', () => {
      // This would test the upload system modals
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS.slice(0, 6), device => {
        // Test upload trigger (adapt based on actual implementation)
        cy.get('[data-testid="upload-trigger"]').should('exist');

        if (device.width <= 600) {
          // On mobile, upload interface should stack vertically
          cy.get('[data-testid="upload-container"]').should('have.css', 'flex-direction', 'column');
        }
      });
    });
  });
});
