// cypress/support/responsive-commands.ts
// Comprehensive responsive testing utilities

export interface DeviceViewport {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
}

// Standard device configurations for testing
export const DEVICE_VIEWPORTS: DeviceViewport[] = [
  // Mobile Devices
  {
    name: 'iPhone SE',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },
  {
    name: 'iPhone 12 Pro',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },
  {
    name: 'iPhone 12 Pro Max',
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },
  {
    name: 'Samsung Galaxy S21',
    width: 384,
    height: 854,
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36'
  },

  // Tablets
  {
    name: 'iPad',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },
  {
    name: 'iPad Pro 11"',
    width: 834,
    height: 1194,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },
  {
    name: 'iPad Pro 12.9"',
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  },

  // Desktop/Laptop Screens
  {
    name: 'Laptop Small',
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  {
    name: 'Desktop Standard',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  {
    name: 'Desktop Large',
    width: 2560,
    height: 1440,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  }
];

// MUI Breakpoints for reference
export const MUI_BREAKPOINTS = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536
};

// Critical breakpoint testing points
export const BREAKPOINT_TESTS = [
  { name: 'xs-boundary', width: 320, height: 568 }, // Minimum mobile
  { name: 'xs-max', width: 599, height: 800 }, // Just before sm
  { name: 'sm-min', width: 600, height: 800 }, // sm starts
  { name: 'sm-max', width: 899, height: 800 }, // Just before md
  { name: 'md-min', width: 900, height: 800 }, // md starts
  { name: 'md-max', width: 1199, height: 800 }, // Just before lg
  { name: 'lg-min', width: 1200, height: 800 }, // lg starts
  { name: 'lg-max', width: 1535, height: 800 }, // Just before xl
  { name: 'xl-min', width: 1536, height: 800 } // xl starts
];

// Cypress custom commands for responsive testing
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Set viewport to specific device configuration
       */
      setDeviceViewport(device: DeviceViewport): Chainable<void>;

      /**
       * Test component across multiple devices
       */
      testAcrossDevices(devices: DeviceViewport[], testFn: (device: DeviceViewport) => void): Chainable<void>;

      /**
       * Test responsive breakpoints
       */
      testBreakpoints(breakpoints: typeof BREAKPOINT_TESTS, testFn: (breakpoint: { name: string; width: number; height: number }) => void): Chainable<void>;

      /**
       * Check if element is visible and accessible on touch devices
       */
      checkTouchAccessibility(selector: string): Chainable<void>;

      /**
       * Verify modal responsiveness
       */
      checkModalResponsiveness(modalSelector: string): Chainable<void>;

      /**
       * Check table responsiveness and scrolling
       */
      checkTableResponsiveness(tableSelector: string): Chainable<void>;

      /**
       * Take responsive screenshots for visual regression
       */
      takeResponsiveScreenshots(name: string, devices?: DeviceViewport[]): Chainable<void>;
    }
  }
}

// Implementation of custom commands
Cypress.Commands.add('setDeviceViewport', (device: DeviceViewport) => {
  cy.viewport(device.width, device.height);

  if (device.userAgent) {
    cy.window().then(win => {
      // Override user agent if specified
      Object.defineProperty(win.navigator, 'userAgent', {
        writable: false,
        value: device.userAgent
      });
    });
  }
});

Cypress.Commands.add('testAcrossDevices', (devices: DeviceViewport[], testFn: (device: DeviceViewport) => void) => {
  devices.forEach(device => {
    cy.log(`Testing on ${device.name} (${device.width}x${device.height})`);
    cy.setDeviceViewport(device);
    cy.wait(500); // Allow for responsive transitions
    testFn(device);
  });
});

Cypress.Commands.add('testBreakpoints', (breakpoints: typeof BREAKPOINT_TESTS, testFn) => {
  breakpoints.forEach(breakpoint => {
    cy.log(`Testing breakpoint: ${breakpoint.name} (${breakpoint.width}px)`);
    cy.viewport(breakpoint.width, breakpoint.height);
    cy.wait(300); // Allow for responsive transitions
    testFn(breakpoint);
  });
});

Cypress.Commands.add('checkTouchAccessibility', (selector: string) => {
  cy.get(selector)
    .should('be.visible')
    .then($el => {
      const rect = $el[0].getBoundingClientRect();
      const minTouchTarget = 44; // 44px minimum for touch targets

      expect(rect.width).to.be.at.least(minTouchTarget, `Touch target width should be at least ${minTouchTarget}px`);
      expect(rect.height).to.be.at.least(minTouchTarget, `Touch target height should be at least ${minTouchTarget}px`);
    });
});

Cypress.Commands.add('checkModalResponsiveness', (modalSelector: string) => {
  cy.get(modalSelector)
    .should('be.visible')
    .then($modal => {
      const modalRect = $modal[0].getBoundingClientRect();
      const viewportWidth = Cypress.config('viewportWidth');
      const viewportHeight = Cypress.config('viewportHeight');

      // Modal should not exceed viewport
      expect(modalRect.width).to.be.at.most(viewportWidth, 'Modal width should not exceed viewport width');
      expect(modalRect.height).to.be.at.most(viewportHeight, 'Modal height should not exceed viewport height');

      // Modal should have reasonable margins on larger screens
      if (viewportWidth > 600) {
        expect(modalRect.width).to.be.lessThan(viewportWidth, 'Modal should have margins on larger screens');
      }

      // Check for horizontal scrollbar (should not exist)
      cy.window()
        .its('document.documentElement.scrollWidth')
        .then(scrollWidth => {
          expect(scrollWidth).to.equal(viewportWidth, 'Should not have horizontal scrollbar');
        });
    });
});

Cypress.Commands.add('checkTableResponsiveness', (tableSelector: string) => {
  cy.get(tableSelector)
    .should('be.visible')
    .then($table => {
      const tableContainer = $table.closest('[role="region"], .table-container, [data-testid="table-container"]')[0] || $table.parent()[0];
      const containerRect = tableContainer.getBoundingClientRect();
      const viewportWidth = Cypress.config('viewportWidth');

      // Table container should not exceed viewport
      expect(containerRect.width).to.be.at.most(viewportWidth, 'Table container should not exceed viewport width');

      // Check if table has horizontal scroll when needed
      if (containerRect.width === viewportWidth) {
        cy.wrap(tableContainer)
          .should('have.css', 'overflow-x')
          .and('match', /auto|scroll/);
      }
    });
});

Cypress.Commands.add('takeResponsiveScreenshots', (name: string, devices = DEVICE_VIEWPORTS) => {
  devices.forEach(device => {
    cy.setDeviceViewport(device);
    cy.wait(1000); // Allow for transitions and loading
    cy.screenshot(`${name}-${device.name.replace(/\s+/g, '-').toLowerCase()}`, {
      capture: 'viewport',
      clip: { x: 0, y: 0, width: device.width, height: device.height }
    });
  });
});
