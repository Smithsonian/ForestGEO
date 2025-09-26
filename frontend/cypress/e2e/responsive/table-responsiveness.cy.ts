// cypress/e2e/responsive/table-responsiveness.cy.ts
// Test suite for table and data grid responsiveness

import { DEVICE_VIEWPORTS, BREAKPOINT_TESTS } from '../../support/responsive-commands';

describe('Table Responsiveness Tests', () => {
  beforeEach(() => {
    // Mock authentication and required contexts
    cy.window().then(win => {
      win.localStorage.setItem('auth-token', 'mock-token');
    });
  });

  describe('Data Grid Responsiveness', () => {
    it('should handle measurements data grid across devices', () => {
      cy.visit('/measurementshub/viewfulltable');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        cy.log(`Testing data grid on ${device.name}`);

        // Wait for data grid to load
        cy.get('[role="grid"]').should('be.visible');
        cy.checkTableResponsiveness('[role="grid"]');

        // Check horizontal scrolling on mobile
        if (device.width <= 900) {
          cy.get('[role="grid"]')
            .parent()
            .should('have.css', 'overflow-x')
            .and('match', /auto|scroll/);
        }

        // Check column visibility controls
        cy.get('[data-testid="column-menu-button"]').should('be.visible');

        if (device.hasTouch) {
          cy.checkTouchAccessibility('[data-testid="column-menu-button"]');
        }

        // Test column resizing on larger screens
        if (device.width > 1200) {
          cy.get('[role="columnheader"]').first().should('be.visible');
          // Column headers should be resizable on desktop
          cy.get('[role="columnheader"]').first().should('have.css', 'cursor');
        }
      });
    });

    it('should test data grid pagination controls', () => {
      cy.visit('/measurementshub/viewfulltable');

      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        // Wait for pagination controls
        cy.get('[role="navigation"]').should('be.visible');

        if (breakpoint.width <= 600) {
          // On mobile, pagination should be compact
          cy.get('[data-testid="pagination-info"]').should('exist');
          cy.get('[data-testid="pagination-controls"]').within(() => {
            cy.get('button')
              .should('have.css', 'min-width')
              .and('match', /32px|2rem/);
          });
        }

        // Test page size selector
        cy.get('[data-testid="page-size-selector"]').should('be.visible');
        if (breakpoint.width <= 480) {
          // On very small screens, selector might be simplified
          cy.get('[data-testid="page-size-selector"]').should('not.have.class', 'expanded');
        }
      });
    });
  });

  describe('File Preview Tables', () => {
    it('should handle file preview table responsiveness', () => {
      // This would test the upload file preview tables
      cy.visit('/measurementshub/uploadedfiles');

      // Mock file upload or navigate to a state where preview is shown
      cy.get('[data-testid="file-input"]').should('exist');

      cy.testAcrossDevices(DEVICE_VIEWPORTS.slice(0, 6), device => {
        // Simulate having a file preview (this would need real implementation)
        cy.get('[data-testid="file-preview-table"]')
          .should('exist')
          .then($table => {
            if ($table.length > 0) {
              cy.checkTableResponsiveness('[data-testid="file-preview-table"]');

              // Check cell content wrapping
              cy.get('[data-testid="file-preview-table"] td').first().should('have.css', 'word-break');

              if (device.width <= 600) {
                // On mobile, some columns might be hidden or collapsed
                cy.get('[data-testid="file-preview-table"] th').should('have.length.lessThan', 10);
              }
            }
          });
      });
    });

    it('should handle table overflow and scrolling', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.get('[data-testid="file-preview-container"]')
          .should('exist')
          .then($container => {
            if ($container.length > 0) {
              const containerRect = $container[0].getBoundingClientRect();

              // Container should not exceed viewport
              expect(containerRect.width).to.be.at.most(breakpoint.width);

              // Should have horizontal scroll when content is wide
              if (containerRect.width === breakpoint.width) {
                cy.wrap($container)
                  .should('have.css', 'overflow-x')
                  .and('match', /auto|scroll/);
              }
            }
          });
      });
    });
  });

  describe('Failed Measurements Table', () => {
    it('should test failed measurements data grid responsiveness', () => {
      cy.visit('/measurementshub/summary');

      // Trigger failed measurements modal
      cy.get('[data-testid="failed-measurements-trigger"]').click({ force: true });

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        cy.get('[data-testid="failed-measurements-grid"]').should('be.visible');
        cy.checkTableResponsiveness('[data-testid="failed-measurements-grid"]');

        // Check edit functionality on different devices
        if (device.hasTouch) {
          // Touch devices should have larger touch targets
          cy.get('[data-testid="edit-cell-button"]').first().should('be.visible');
          cy.checkTouchAccessibility('[data-testid="edit-cell-button"]');
        }

        // Check column management
        cy.get('[data-testid="column-visibility-button"]').should('be.visible');
        if (device.width <= 768) {
          // On smaller screens, some columns should be hidden by default
          cy.get('[role="columnheader"]').should('have.length.lessThan', 8);
        }
      });
    });
  });

  describe('Summary Tables', () => {
    it('should test summary table responsiveness', () => {
      cy.visit('/measurementshub/summary');

      cy.testAcrossDevices(DEVICE_VIEWPORTS, device => {
        // Test different summary tables that might exist
        cy.get('[data-testid="summary-table"]')
          .should('exist')
          .then($tables => {
            $tables.each((index, table) => {
              cy.wrap(table).within(() => {
                cy.checkTableResponsiveness(table);

                if (device.width <= 600) {
                  // On mobile, tables might use card layout instead
                  cy.get('tr')
                    .should('have.css', 'display')
                    .and('match', /block|flex/);
                }
              });
            });
          });
      });
    });
  });

  describe('Accessibility and Touch Targets', () => {
    it('should ensure proper touch targets on mobile', () => {
      const touchDevices = DEVICE_VIEWPORTS.filter(d => d.hasTouch);

      touchDevices.forEach(device => {
        cy.setDeviceViewport(device);
        cy.visit('/measurementshub/viewfulltable');

        // Check all interactive elements have proper touch targets
        cy.get('button, a, [role="button"], [tabindex="0"]').each($el => {
          cy.wrap($el).should('be.visible');
          cy.checkTouchAccessibility($el[0]);
        });

        // Check table row selection areas
        cy.get('[role="row"]')
          .first()
          .should('be.visible')
          .then($row => {
            const height = $row.height() || 0;
            expect(height).to.be.at.least(44, 'Table rows should be at least 44px tall for touch');
          });
      });
    });

    it('should test keyboard navigation on different screen sizes', () => {
      cy.testBreakpoints(BREAKPOINT_TESTS, breakpoint => {
        cy.visit('/measurementshub/viewfulltable');

        // Test tab navigation
        cy.get('body').tab();
        cy.focused().should('be.visible');

        // Test arrow key navigation in grid
        cy.get('[role="grid"]').focus();
        cy.focused().type('{downarrow}');
        cy.focused().should('be.visible');

        // Ensure focused elements are always visible
        cy.focused().then($focused => {
          const rect = $focused[0].getBoundingClientRect();
          expect(rect.top).to.be.at.least(0);
          expect(rect.left).to.be.at.least(0);
          expect(rect.bottom).to.be.at.most(breakpoint.height);
          expect(rect.right).to.be.at.most(breakpoint.width);
        });
      });
    });
  });
});
