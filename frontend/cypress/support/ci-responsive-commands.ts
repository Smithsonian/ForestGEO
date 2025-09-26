// cypress/support/ci-responsive-commands.ts
// CI-optimized responsive testing utilities (subset for faster CI runs)

// Import base responsive commands
import { DeviceViewport, MUI_BREAKPOINTS } from './responsive-commands';

// CI-optimized device subset (5 key devices for comprehensive coverage)
export const CI_DEVICE_VIEWPORTS: DeviceViewport[] = [
  // Mobile
  {
    name: 'Mobile-Small',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  },
  // Tablet Portrait
  {
    name: 'Tablet-Portrait',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true
  },
  // Tablet Landscape / Small Desktop
  {
    name: 'Small-Desktop',
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  // Standard Desktop
  {
    name: 'Desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  // Large Desktop
  {
    name: 'Large-Desktop',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  }
];

// CI-optimized breakpoint tests (critical boundaries only)
export const CI_BREAKPOINT_TESTS = [
  { name: 'mobile-boundary', width: 320, height: 568 }, // Minimum mobile
  { name: 'sm-boundary', width: 600, height: 800 }, // sm breakpoint
  { name: 'md-boundary', width: 900, height: 800 }, // md breakpoint
  { name: 'lg-boundary', width: 1200, height: 800 } // lg breakpoint
];

// CI-specific Cypress commands with faster execution
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Fast responsive test across CI device subset
       */
      testCIDevices(testFn: (device: DeviceViewport) => void): Chainable<void>;

      /**
       * Quick modal responsiveness check for CI
       */
      checkCIModalResponsiveness(modalSelector: string): Chainable<void>;

      /**
       * Fast table responsiveness check for CI
       */
      checkCITableResponsiveness(tableSelector: string): Chainable<void>;

      /**
       * CI-optimized screenshot capture
       */
      takeCIScreenshots(name: string): Chainable<void>;
    }
  }
}

// CI-optimized command implementations
Cypress.Commands.add('testCIDevices', (testFn: (device: DeviceViewport) => void) => {
  CI_DEVICE_VIEWPORTS.forEach(device => {
    cy.log(`CI Testing on ${device.name} (${device.width}x${device.height})`);
    cy.viewport(device.width, device.height);
    cy.wait(300); // Reduced wait time for CI
    testFn(device);
  });
});

Cypress.Commands.add('checkCIModalResponsiveness', (modalSelector: string) => {
  cy.get(modalSelector, { timeout: 8000 })
    .should('be.visible')
    .then($modal => {
      const modalRect = $modal[0].getBoundingClientRect();
      const viewportWidth = Cypress.config('viewportWidth');
      const viewportHeight = Cypress.config('viewportHeight');

      // Essential checks only for CI speed
      expect(modalRect.width).to.be.at.most(viewportWidth, 'Modal width should not exceed viewport');
      expect(modalRect.height).to.be.at.most(viewportHeight, 'Modal height should not exceed viewport');

      // Quick horizontal scroll check
      cy.window()
        .its('document.documentElement.scrollWidth')
        .then(scrollWidth => {
          expect(scrollWidth).to.equal(viewportWidth, 'Should not have horizontal scrollbar');
        });
    });
});

Cypress.Commands.add('checkCITableResponsiveness', (tableSelector: string) => {
  cy.get(tableSelector, { timeout: 8000 })
    .should('be.visible')
    .then($table => {
      const tableContainer = $table.closest('[role="region"], .table-container')[0] || $table.parent()[0];
      const containerRect = tableContainer.getBoundingClientRect();
      const viewportWidth = Cypress.config('viewportWidth');

      // Essential table checks for CI
      expect(containerRect.width).to.be.at.most(viewportWidth, 'Table should not exceed viewport width');

      // Quick overflow check
      if (containerRect.width === viewportWidth) {
        cy.wrap(tableContainer)
          .should('have.css', 'overflow-x')
          .and('match', /auto|scroll/);
      }
    });
});

Cypress.Commands.add('takeCIScreenshots', (name: string) => {
  // Take screenshots only for key devices in CI
  const ciDevices = CI_DEVICE_VIEWPORTS.slice(0, 3); // First 3 devices only

  ciDevices.forEach(device => {
    cy.viewport(device.width, device.height);
    cy.wait(500); // Allow for responsive transitions
    cy.screenshot(`ci-${name}-${device.name.toLowerCase()}`, {
      capture: 'viewport',
      clip: { x: 0, y: 0, width: device.width, height: device.height }
    });
  });
});
