// cypress/e2e/responsive/upload-system-responsiveness.cy.ts
// Test suite for upload system responsiveness

import { DEVICE_VIEWPORTS, BREAKPOINT_TESTS } from '../../support/responsive-commands';

describe('Upload System Responsiveness Tests', () => {
  beforeEach(() => {
    // Mock authentication and required contexts
    cy.window().then(win => {
      win.localStorage.setItem('auth-token', 'mock-token');
    });
  });

  describe('Upload Interface Layout', () => {
    it('should adapt layout for different screen sizes', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        cy.log(`Testing upload interface on ${device.name}`);

        // Main upload container should be responsive
        cy.get('[data-testid="upload-container"]').should('be.visible');

        if (device.width <= 768) {
          // Mobile: Stack vertically
          cy.get('[data-testid="upload-container"]').should('have.css', 'flex-direction', 'column');
        } else {
          // Desktop: Side by side layout
          cy.get('[data-testid="upload-container"]').should('have.css', 'flex-direction', 'row');
        }

        // File drop zone should be responsive
        cy.get('[data-testid="file-dropzone"]')
          .should('be.visible')
          .then($dropzone => {
            const dropzoneRect = $dropzone[0].getBoundingClientRect();

            // Should not exceed viewport width
            expect(dropzoneRect.width).to.be.at.most(device.width);

            // Should have minimum height for usability
            expect(dropzoneRect.height).to.be.at.least(100);
          });
      });
    });

    it('should test file list responsiveness', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        // Mock having files in the list
        cy.get('[data-testid="file-list"]')
          .should('exist')
          .then($fileList => {
            if ($fileList.length > 0) {
              // File items should stack on mobile
              if (breakpoint.width <= 600) {
                cy.get('[data-testid="file-item"]').should('have.css', 'width', '100%');
              }

              // File actions should be accessible
              cy.get('[data-testid="file-remove-button"]').should('be.visible');
              if (breakpoint.width <= 480) {
                // On very small screens, actions might be in a menu
                cy.get('[data-testid="file-actions-menu"]').should('exist');
              }
            }
          });
      });
    });
  });

  describe('Upload Progress Display', () => {
    it('should test upload progress responsiveness', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        // Mock upload progress state
        cy.window().then(win => {
          // This would trigger the upload progress display
          // Adapt based on your actual implementation
        });

        cy.get('[data-testid="upload-progress-container"]')
          .should('exist')
          .then($container => {
            if ($container.length > 0) {
              // Progress bars should be full width
              cy.get('[data-testid="progress-bar"]').should('have.css', 'width', '100%');

              // Progress text should be readable
              cy.get('[data-testid="progress-text"]').should('be.visible');

              if (device.width <= 600) {
                // On mobile, progress info might stack vertically
                cy.get('[data-testid="progress-info"]').should('have.css', 'flex-direction', 'column');
              }
            }
          });
      });
    });

    it('should handle multiple progress bars responsively', () => {
      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.visit('/measurementshub/uploadedfiles');

        // Test the multiple progress bars from your implementation
        const progressTypes = ['file-progress', 'data-processing', 'batch-processing'];

        progressTypes.forEach(progressType => {
          cy.get(`[data-testid="${progressType}-container"]`)
            .should('exist')
            .then($progress => {
              if ($progress.length > 0) {
                // Progress container should not exceed viewport
                const rect = $progress[0].getBoundingClientRect();
                expect(rect.width).to.be.at.most(breakpoint.width);

                // Progress bar should be visible and accessible
                cy.get(`[data-testid="${progressType}-bar"]`).should('be.visible');

                if (breakpoint.width <= 600) {
                  // On mobile, ensure text doesn't overflow
                  cy.get(`[data-testid="${progressType}-text"]`).should('have.css', 'overflow', 'hidden').or('have.css', 'text-overflow', 'ellipsis');
                }
              }
            });
        });
      });
    });
  });

  describe('File Preview Responsiveness', () => {
    it('should test file preview table across devices', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        // Mock file preview state
        cy.get('[data-testid="file-preview-table"]')
          .should('exist')
          .then($table => {
            if ($table.length > 0) {
              cy.checkTableResponsiveness('[data-testid="file-preview-table"]');

              // Check column management on different devices
              if (device.width <= 768) {
                // On smaller screens, some columns should be hidden
                cy.get('th[data-testid="preview-column"]').should('have.length.lessThan', 8);
              }

              // Check cell content handling
              cy.get('td[data-testid="preview-cell"]')
                .first()
                .then($cell => {
                  const cellRect = $cell[0].getBoundingClientRect();
                  // Cell should not exceed reasonable width
                  expect(cellRect.width).to.be.at.most(200);
                });
            }
          });
      });
    });

    it('should test compact file preview', () => {
      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.visit('/measurementshub/uploadedfiles');

        if (breakpoint.width <= 600) {
          // On mobile, should use compact preview
          cy.get('[data-testid="file-preview-compact"]').should('be.visible');

          // Compact preview should handle overflow
          cy.get('[data-testid="preview-scroll-container"]').should('have.css', 'overflow-x', 'auto');
        }
      });
    });
  });

  describe('Upload Validation Display', () => {
    it('should test validation messages responsiveness', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        // Mock validation errors
        cy.get('[data-testid="validation-messages"]')
          .should('exist')
          .then($messages => {
            if ($messages.length > 0) {
              // Validation messages should be readable
              cy.get('[data-testid="validation-error"]').should('be.visible');

              if (device.width <= 600) {
                // On mobile, validation messages should stack
                cy.get('[data-testid="validation-error"]').should('have.css', 'margin-bottom');
              }

              // Error icons should be visible
              cy.get('[data-testid="error-icon"]').should('be.visible');

              if (device.hasTouch) {
                // Touch targets for dismissing errors
                cy.get('[data-testid="dismiss-error"]').should('be.visible');
                cy.checkTouchAccessibility('[data-testid="dismiss-error"]');
              }
            }
          });
      });
    });
  });

  describe('Upload Complete Screen', () => {
    it('should test upload complete responsiveness', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        // Mock upload complete state
        cy.get('[data-testid="upload-complete-container"]')
          .should('exist')
          .then($container => {
            if ($container.length > 0) {
              // Success message should be prominent
              cy.get('[data-testid="success-message"]').should('be.visible');

              // Reset buttons should be accessible
              cy.get('[data-testid="clear-failed-button"]').should('be.visible');
              cy.get('[data-testid="clear-temp-button"]').should('be.visible');

              if (device.hasTouch) {
                cy.checkTouchAccessibility('[data-testid="clear-failed-button"]');
                cy.checkTouchAccessibility('[data-testid="clear-temp-button"]');
              }

              if (device.width <= 600) {
                // On mobile, buttons should stack vertically
                cy.get('[data-testid="reset-controls"]').should('have.css', 'flex-direction', 'column');
              } else {
                // On desktop, buttons can be horizontal
                cy.get('[data-testid="reset-controls"]').should('have.css', 'flex-direction', 'row');
              }

              // Confirmation dialogs should be responsive
              cy.get('[data-testid="clear-failed-button"]').click({ force: true });
              cy.get('[data-testid="confirmation-panel"]').should('be.visible');

              // Confirmation panel should not exceed viewport
              cy.get('[data-testid="confirmation-panel"]').then($panel => {
                const panelRect = $panel[0].getBoundingClientRect();
                expect(panelRect.width).to.be.at.most(device.width);
              });
            }
          });
      });
    });
  });

  describe('Upload Error Handling', () => {
    it('should test error display responsiveness', () => {
      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.visit('/measurementshub/uploadedfiles');

        // Mock error state
        cy.get('[data-testid="upload-error-display"]')
          .should('exist')
          .then($errorDisplay => {
            if ($errorDisplay.length > 0) {
              // Error messages should be contained
              const errorRect = $errorDisplay[0].getBoundingClientRect();
              expect(errorRect.width).to.be.at.most(breakpoint.width);

              // Error details should be scrollable if long
              cy.get('[data-testid="error-details"]').should('have.css', 'max-height').and('have.css', 'overflow-y', 'auto');

              // Retry button should be accessible
              cy.get('[data-testid="retry-button"]').should('be.visible');

              if (breakpoint.width <= 480) {
                // On very small screens, retry button should be full width
                cy.get('[data-testid="retry-button"]').should('have.css', 'width', '100%');
              }
            }
          });
      });
    });
  });
});
