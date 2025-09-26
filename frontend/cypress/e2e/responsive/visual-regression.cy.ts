// cypress/e2e/responsive/visual-regression.cy.ts
// Visual regression testing for responsive design

import { DEVICE_VIEWPORTS } from '../../support/responsive-commands';

describe('Visual Regression Tests', () => {
  beforeEach(() => {
    // Mock authentication and required contexts
    cy.window().then(win => {
      win.localStorage.setItem('auth-token', 'mock-token');
    });
  });

  describe('Page Layout Screenshots', () => {
    const pages = [
      { path: '/measurementshub/summary', name: 'summary' },
      { path: '/measurementshub/viewfulltable', name: 'full-table' },
      { path: '/measurementshub/uploadedfiles', name: 'upload-files' },
      { path: '/measurementshub/validations', name: 'validations' }
    ];

    pages.forEach(page => {
      it(`should capture ${page.name} page across devices`, () => {
        cy.visit(page.path);

        // Wait for page to fully load
        cy.get('[data-testid="main-content"]').should('be.visible');
        cy.wait(2000); // Allow for any animations or async loading

        // Take screenshots across all devices
        cy.takeResponsiveScreenshots(`page-${page.name}`);
      });
    });
  });

  describe('Component Screenshots', () => {
    it('should capture modal components across devices', () => {
      cy.visit('/measurementshub/summary');

      // Test Failed Measurements Modal
      cy.get('[data-testid="failed-measurements-trigger"]').click({ force: true });
      cy.get('[role="alertdialog"]').should('be.visible');
      cy.wait(1000);

      cy.takeResponsiveScreenshots('modal-failed-measurements');

      // Test confirmation panel
      cy.get('[data-testid="clear-failed-button"]').click({ force: true });
      cy.get('[data-testid="confirmation-panel"]').should('be.visible');
      cy.wait(500);

      cy.takeResponsiveScreenshots('modal-confirmation-panel');
    });

    it('should capture data grid components', () => {
      cy.visit('/measurementshub/viewfulltable');

      cy.get('[role="grid"]').should('be.visible');
      cy.wait(2000); // Allow data to load

      cy.takeResponsiveScreenshots('data-grid-main');

      // Test column menu
      cy.get('[data-testid="column-menu-button"]').click({ force: true });
      cy.get('[role="menu"]').should('be.visible');
      cy.wait(500);

      cy.takeResponsiveScreenshots('data-grid-column-menu');
    });

    it('should capture upload interface components', () => {
      cy.visit('/measurementshub/uploadedfiles');

      cy.get('[data-testid="upload-container"]').should('be.visible');
      cy.wait(1000);

      cy.takeResponsiveScreenshots('upload-interface');

      // Test file preview if available
      cy.get('body').then($body => {
        if ($body.find('[data-testid="file-preview-table"]').length > 0) {
          cy.takeResponsiveScreenshots('upload-file-preview');
        }
      });
    });
  });

  describe('State-based Screenshots', () => {
    it('should capture loading states', () => {
      cy.visit('/measurementshub/viewfulltable');

      // Capture loading state (might need to simulate slow network)
      cy.intercept('GET', '/api/**', { delay: 2000 }).as('slowApi');

      cy.reload();
      cy.get('[data-testid="loading-indicator"]').should('be.visible');

      cy.takeResponsiveScreenshots('state-loading');

      cy.wait('@slowApi');
    });

    it('should capture error states', () => {
      // Mock error state
      cy.intercept('GET', '/api/**', { statusCode: 500 }).as('errorApi');

      cy.visit('/measurementshub/summary');
      cy.wait('@errorApi');

      cy.get('[data-testid="error-message"]').should('exist');
      cy.takeResponsiveScreenshots('state-error');
    });

    it('should capture empty states', () => {
      // Mock empty data
      cy.intercept('GET', '/api/**', { body: [] }).as('emptyApi');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait('@emptyApi');

      cy.get('[data-testid="empty-state"]').should('exist');
      cy.takeResponsiveScreenshots('state-empty');
    });
  });

  describe('Responsive Behavior Screenshots', () => {
    it('should capture responsive layout transitions', () => {
      cy.visit('/measurementshub/summary');

      // Test specific responsive breakpoints
      const transitionBreakpoints = [
        { width: 599, name: 'just-before-sm' },
        { width: 600, name: 'sm-breakpoint' },
        { width: 899, name: 'just-before-md' },
        { width: 900, name: 'md-breakpoint' },
        { width: 1199, name: 'just-before-lg' },
        { width: 1200, name: 'lg-breakpoint' }
      ];

      transitionBreakpoints.forEach(bp => {
        cy.viewport(bp.width, 800);
        cy.wait(500); // Allow layout to settle

        cy.screenshot(`responsive-transition-${bp.name}`, {
          capture: 'viewport',
          clip: { x: 0, y: 0, width: bp.width, height: 800 }
        });
      });
    });

    it('should capture touch vs desktop interactions', () => {
      const touchDevice = DEVICE_VIEWPORTS.find(d => d.hasTouch && d.width <= 768);
      const desktopDevice = DEVICE_VIEWPORTS.find(d => !d.hasTouch && d.width >= 1200);

      if (touchDevice && desktopDevice) {
        cy.visit('/measurementshub/viewfulltable');

        // Touch device interaction
        cy.setDeviceViewport(touchDevice);
        cy.wait(500);
        cy.screenshot(`touch-interaction-${touchDevice.name.replace(/\s+/g, '-').toLowerCase()}`);

        // Desktop device interaction
        cy.setDeviceViewport(desktopDevice);
        cy.wait(500);
        cy.screenshot(`desktop-interaction-${desktopDevice.name.replace(/\s+/g, '-').toLowerCase()}`);
      }
    });
  });

  describe('Accessibility Screenshots', () => {
    it('should capture high contrast mode', () => {
      cy.visit('/measurementshub/summary');

      // Simulate high contrast mode
      cy.get('body').invoke('addClass', 'high-contrast-mode');
      cy.wait(500);

      cy.takeResponsiveScreenshots('accessibility-high-contrast');
    });

    it('should capture focus states', () => {
      cy.visit('/measurementshub/viewfulltable');

      // Navigate with keyboard to show focus states
      cy.get('body').tab();
      cy.wait(200);
      cy.takeResponsiveScreenshots('accessibility-focus-states');
    });

    it('should capture reduced motion states', () => {
      cy.visit('/measurementshub/summary');

      // Simulate reduced motion preference
      cy.window().then(win => {
        Object.defineProperty(win, 'matchMedia', {
          writable: true,
          value: query => ({
            matches: query.includes('prefers-reduced-motion'),
            addEventListener: () => {},
            removeEventListener: () => {}
          })
        });
      });

      cy.reload();
      cy.wait(1000);

      cy.takeResponsiveScreenshots('accessibility-reduced-motion');
    });
  });

  describe('Performance-based Screenshots', () => {
    it('should capture slow rendering states', () => {
      // Simulate slower device
      cy.visit('/measurementshub/viewfulltable', {
        onBeforeLoad: win => {
          // Simulate slower rendering
          Object.defineProperty(win.navigator, 'hardwareConcurrency', {
            writable: false,
            value: 2 // Lower CPU cores
          });
        }
      });

      cy.wait(3000); // Allow for slower rendering
      cy.takeResponsiveScreenshots('performance-slow-device');
    });
  });
});
