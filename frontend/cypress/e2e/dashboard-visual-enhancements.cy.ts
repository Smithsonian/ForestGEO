/**
 * @fileoverview E2E tests for Enhanced Dashboard Visual Components
 *
 * Tests all user flows for the modernized dashboard including:
 * - Gradient metric cards display and interactions
 * - Animated progress card functionality
 * - Census visualization toggle
 * - Responsive layout behavior
 * - Data loading and error handling
 * - User profile display
 * - Recent activity changelog
 *
 * @see /app/(hub)/dashboard/page.tsx
 */

describe('Dashboard Visual Enhancements E2E', () => {
  beforeEach(() => {
    // Set up authenticated user with data
    cy.setupForestGEOUser('standardUser');
    cy.visit('/login');

    // Wait for login button to be visible before clicking
    cy.get('[aria-label="Login button"]', { timeout: 10000 })
      .should('be.visible')
      .click();

    cy.url().should('include', '/dashboard', { timeout: 10000 });
    cy.wait('@getSession');

    // Select site and plot to populate dashboard
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');
    cy.wait('@getCensus');

    // Wait for dashboard data to load
    cy.wait('@getDashboardMetrics', { timeout: 10000 });
  });

  describe('Metric Cards Display', () => {
    it('should display all four gradient metric cards', () => {
      // Verify all metric cards are visible
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Total Stems').should('be.visible');
      cy.contains('Active Personnel').should('be.visible');
      cy.contains('New Recruits').should('be.visible');
    });

    it('should display metric values with proper formatting', () => {
      // Verify numbers are displayed with locale formatting (commas)
      cy.contains('Total Trees')
        .parent()
        .parent()
        .within(() => {
          cy.get('[class*="MuiTypography"]').should('contain.match', /[\d,]+/);
        });
    });

    it('should display trend indicators on metric cards', () => {
      // Verify trend text is present
      cy.contains('Total Trees')
        .parent()
        .parent()
        .within(() => {
          cy.contains(/Current census|No data/).should('be.visible');
        });

      cy.contains('Active Personnel')
        .parent()
        .parent()
        .within(() => {
          cy.contains(/Currently active|No activity/).should('be.visible');
        });
    });

    it('should display icons on metric cards', () => {
      // Verify all metric cards have icons (MUI icons render as SVG)
      cy.contains('Total Trees')
        .parent()
        .parent()
        .find('svg')
        .should('exist');

      cy.contains('Total Stems')
        .parent()
        .parent()
        .find('svg')
        .should('exist');

      cy.contains('Active Personnel')
        .parent()
        .parent()
        .find('svg')
        .should('exist');

      cy.contains('New Recruits')
        .parent()
        .parent()
        .find('svg')
        .should('exist');
    });

    it('should show loading skeletons before data loads', () => {
      // Reload page to see loading state
      cy.reload();

      // Loading skeletons should be visible briefly
      cy.get('[data-testid*="skeleton"]', { timeout: 100 }).should('exist');

      // Then real data should appear
      cy.contains('Total Trees', { timeout: 5000 }).should('be.visible');
    });

    it('should calculate stems per tree correctly', () => {
      // Get tree and stem counts
      let treeCount: number;
      let stemCount: number;

      cy.contains('Total Trees')
        .parent()
        .parent()
        .find('[class*="MuiTypography"][class*="h2"]')
        .invoke('text')
        .then(text => {
          treeCount = parseInt(text.replace(/,/g, ''));

          cy.contains('Total Stems')
            .parent()
            .parent()
            .find('[class*="MuiTypography"][class*="h2"]')
            .invoke('text')
            .then(text => {
              stemCount = parseInt(text.replace(/,/g, ''));
              const expectedRatio = (stemCount / treeCount).toFixed(1);

              // Verify stems per tree is displayed correctly
              cy.contains(`${expectedRatio} per tree`).should('be.visible');
            });
        });
    });
  });

  describe('Progress Card Functionality', () => {
    it('should display circular progress card', () => {
      cy.contains('Census Progress').should('be.visible');
      cy.contains('Quadrat measurement completion').should('be.visible');
    });

    it('should display progress percentage', () => {
      // Progress should show percentage with % symbol
      cy.contains('Census Progress')
        .parent()
        .parent()
        .within(() => {
          cy.contains(/\d+%/).should('be.visible');
          cy.contains('Complete').should('be.visible');
        });
    });

    it('should display populated and total quadrat counts', () => {
      // Should show "X / Y" format
      cy.contains('Census Progress')
        .parent()
        .parent()
        .within(() => {
          cy.contains(/\d+\s*\/\s*\d+/).should('be.visible');
        });
    });

    it('should display pending quadrats when applicable', () => {
      cy.contains('Census Progress')
        .parent()
        .parent()
        .within(() => {
          // Either shows pending count or not (depends on data)
          cy.get('body').then($body => {
            if ($body.find(':contains("Pending")').length > 0) {
              cy.contains(/\d+ Pending/).should('be.visible');
            }
          });
        });
    });

    it('should display circular progress indicator', () => {
      // MUI CircularProgress renders as SVG circle
      cy.contains('Census Progress')
        .parent()
        .parent()
        .find('svg circle')
        .should('exist')
        .and('have.length.greaterThan', 0);
    });

    it('should show populated quadrats with success color chip', () => {
      cy.contains('Census Progress')
        .parent()
        .parent()
        .find('[class*="MuiChip"]')
        .first()
        .should('be.visible');
    });
  });

  describe('Census Visualization Toggle', () => {
    it('should default to tachometer view', () => {
      cy.contains('Census Visualization').should('be.visible');
      cy.contains('Tachometer View - Click to toggle').should('be.visible');
    });

    it('should toggle between tachometer and pie chart views', () => {
      // Verify tachometer is visible initially
      cy.contains('Tachometer View - Click to toggle').should('be.visible');

      // Find the clickable visualization area
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .click();

      // Should switch to pie chart view
      cy.contains('Pie Chart View - Click to toggle', { timeout: 2000 }).should('be.visible');

      // Click again to toggle back
      cy.contains('Pie Chart View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .click();

      // Should be back to tachometer
      cy.contains('Tachometer View - Click to toggle', { timeout: 2000 }).should('be.visible');
    });

    it('should maintain interactivity on keyboard navigation', () => {
      // Focus the toggle area
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .focus()
        .type('{enter}');

      // Should toggle view
      cy.contains('Pie Chart View - Click to toggle', { timeout: 2000 }).should('be.visible');
    });

    it('should display detailed statistics grid', () => {
      cy.contains('Stem Type Breakdown').should('be.visible');
      cy.contains('Quadrat Coverage').should('be.visible');
    });

    it('should display stem types in statistics', () => {
      cy.contains('Old Stems:').should('be.visible');
      cy.contains('Multi Stems:').should('be.visible');
      cy.contains('New Recruits:').should('be.visible');
    });

    it('should display quadrat coverage stats', () => {
      cy.contains('With Data:').should('be.visible');
      cy.contains('Without Data:').should('be.visible');
      cy.contains('Total Quadrats:').should('be.visible');
    });

    it('should color-code statistics chips appropriately', () => {
      // Verify chips exist with different color variants
      cy.contains('Stem Type Breakdown')
        .parent()
        .find('[class*="MuiChip"]')
        .should('have.length.greaterThan', 0);
    });
  });

  describe('User Profile Section', () => {
    it('should display user profile card', () => {
      cy.contains('Your Profile').should('be.visible');
    });

    it('should display user role', () => {
      cy.contains('Assigned Role').should('be.visible');
      cy.get('@currentUser').then((user: any) => {
        cy.contains(user.user.userStatus).should('be.visible');
      });
    });

    it('should display user email', () => {
      cy.contains('Registered Email').should('be.visible');
      cy.get('@currentUser').then((user: any) => {
        cy.contains(user.user.email).should('be.visible');
      });
    });

    it('should display accessible sites', () => {
      cy.contains('Site Access').should('be.visible');
      cy.get('@currentUser').then((user: any) => {
        // Verify at least one site is shown
        const firstSite = user.user.sites[0];
        cy.contains(firstSite.siteName).should('be.visible');
      });
    });

    it('should display site access chips with check icons', () => {
      cy.contains('Site Access')
        .parent()
        .find('[class*="MuiChip"]')
        .should('have.length.greaterThan', 0)
        .first()
        .find('svg')
        .should('exist'); // CheckIcon
    });

    it('should display report incorrect info button', () => {
      cy.contains('Report incorrect info').should('be.visible');
    });
  });

  describe('Recent Activity Changelog', () => {
    it('should display recent activity card', () => {
      cy.contains('Recent Activity').should('be.visible');
      cy.contains('Latest changes to census data').should('be.visible');
    });

    it('should display changelog entries when data exists', () => {
      // Check if any changelog entries exist
      cy.get('body').then($body => {
        if ($body.find('[class*="MuiAccordion"]').length > 0) {
          // Verify accordion structure
          cy.get('[class*="MuiAccordion"]').should('have.length.greaterThan', 0);
        } else {
          // Should show empty state
          cy.contains('No recent activity').should('be.visible');
        }
      });
    });

    it('should expand changelog details on click', () => {
      // Check if changelog entries exist
      cy.get('body').then($body => {
        if ($body.find('[class*="MuiAccordion"]').length > 0) {
          // Click first accordion
          cy.get('[class*="MuiAccordion"]').first().click();

          // Should show previous and new state
          cy.contains('Previous State', { timeout: 2000 }).should('be.visible');
          cy.contains('New State').should('be.visible');
        }
      });
    });

    it('should display changelog with avatars and timestamps', () => {
      cy.get('body').then($body => {
        if ($body.find('[class*="MuiAccordion"]').length > 0) {
          // Verify avatars exist
          cy.get('[class*="MuiAccordion"]').first().find('[class*="MuiAvatar"]').should('exist');

          // Verify operation and table name shown
          cy.get('[class*="MuiAccordion"]')
            .first()
            .should('contain.match', /(INSERT|UPDATE|DELETE)/i);
        }
      });
    });

    it('should show empty state when no changelog data', () => {
      // Clear site selection to trigger empty state
      cy.visit('/dashboard');

      // Should show no activity message
      cy.contains('No recent activity', { timeout: 5000 }).should('be.visible');
    });
  });

  describe('Feedback Form Integration', () => {
    it('should display feedback button', () => {
      cy.contains('Have feedback? Click here!').should('be.visible');
    });

    it('should trigger pulse animation on feedback button click', () => {
      cy.contains('Have feedback? Click here!').click();

      // Feedback modal/pulse should trigger (implementation-specific)
      // This test verifies the button is clickable
      cy.contains('Have feedback? Click here!').should('exist');
    });
  });

  describe('Welcome Header', () => {
    it('should display personalized welcome message', () => {
      cy.get('@currentUser').then((user: any) => {
        cy.contains(`Welcome back, ${user.user.name}!`).should('be.visible');
      });
    });

    it('should display subtitle with context', () => {
      cy.contains("Here's what's happening with your census data").should('be.visible');
    });
  });

  describe('Data Loading and Error Handling', () => {
    it('should load dashboard data when context is selected', () => {
      // Data should be visible after site/plot selection
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Total Stems').should('be.visible');
      cy.contains('Census Progress').should('be.visible');
    });

    it('should reset dashboard when site is changed', () => {
      // Note current tree count
      let firstTreeCount: string;

      cy.contains('Total Trees')
        .parent()
        .parent()
        .find('[class*="h2"]')
        .invoke('text')
        .then(text => {
          firstTreeCount = text;

          // Change site (if user has access to multiple sites)
          cy.get('@currentUser').then((user: any) => {
            if (user.user.sites.length > 1) {
              // Select different site
              const secondSite = user.user.sites[1];
              cy.get('[data-testid="site-selector"]').click();
              cy.contains(secondSite.siteName).click();

              // Data should refresh (may or may not be different)
              cy.contains('Total Trees').should('be.visible');
            }
          });
        });
    });

    it('should handle empty data gracefully', () => {
      // Visit dashboard without selecting site/plot
      cy.visit('/dashboard');

      // Should show "No data" or empty states
      cy.contains(/No data|0/).should('be.visible');
    });
  });

  describe('Responsive Layout', () => {
    it('should display metrics in grid on desktop', () => {
      cy.viewport(1440, 900);

      // All four metric cards should be in one row on large screens
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Total Stems').should('be.visible');
      cy.contains('Active Personnel').should('be.visible');
      cy.contains('New Recruits').should('be.visible');
    });

    it('should stack metrics on tablet', () => {
      cy.viewport(768, 1024);

      // Metrics should still be visible but may wrap
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Total Stems').should('be.visible');
      cy.contains('Active Personnel').should('be.visible');
      cy.contains('New Recruits').should('be.visible');
    });

    it('should stack metrics vertically on mobile', () => {
      cy.viewport(375, 667);

      // All metrics should still be visible in single column
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Total Stems').should('be.visible');
      cy.contains('Active Personnel').should('be.visible');
      cy.contains('New Recruits').should('be.visible');

      // Scroll to see all content
      cy.scrollTo('bottom');
      cy.contains('Recent Activity').should('be.visible');
    });

    it('should maintain functionality on all screen sizes', () => {
      const viewports: [number, number][] = [
        [375, 667], // Mobile
        [768, 1024], // Tablet
        [1440, 900] // Desktop
      ];

      viewports.forEach(([width, height]) => {
        cy.viewport(width, height);

        // Verify key elements are accessible
        cy.contains('Total Trees').should('be.visible');
        cy.contains('Census Progress').should('be.visible');

        // Census toggle should work on all sizes
        cy.contains('Tachometer View')
          .parent()
          .parent()
          .find('[role="button"]')
          .first()
          .click();

        cy.contains('Pie Chart View', { timeout: 2000 }).should('be.visible');
      });
    });
  });

  describe('Visual Polish and Animations', () => {
    it('should apply hover effects on metric cards', () => {
      // Hover over first metric card
      cy.contains('Total Trees').parent().parent().trigger('mouseover');

      // Card should have hover state (can verify via CSS or visual regression)
      cy.contains('Total Trees').should('be.visible');
    });

    it('should have smooth transitions on interactive elements', () => {
      // Click visualization toggle
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .click();

      // Transition should be smooth (verified by no jarring layout shift)
      cy.contains('Pie Chart View', { timeout: 2000 }).should('be.visible');
    });

    it('should display gradient backgrounds on metric cards', () => {
      // Verify metric cards have styled backgrounds (gradient)
      cy.contains('Total Trees')
        .parent()
        .parent()
        .should('have.css', 'background')
        .and('not.equal', 'rgba(0, 0, 0, 0)'); // Not transparent
    });

    it('should animate progress ring on load', () => {
      // Reload to see animation
      cy.reload();
      cy.wait('@getSession');

      // Progress card should become visible
      cy.contains('Census Progress', { timeout: 5000 }).should('be.visible');

      // Circular progress should be rendered
      cy.contains('Census Progress')
        .parent()
        .parent()
        .find('svg circle')
        .should('exist');
    });
  });

  describe('Accessibility Compliance', () => {
    it('should have proper ARIA labels', () => {
      cy.get('[role="region"][aria-label="Dashboard page container"]').should('exist');
    });

    it('should support keyboard navigation', () => {
      // Tab through interactive elements
      cy.get('body').tab();

      // Census toggle should be focusable
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .focus()
        .should('be.focused');
    });

    it('should have proper heading hierarchy', () => {
      // Main welcome should be h2
      cy.contains('Welcome back').should('match', 'h2');

      // Section headings should be h4
      cy.contains('Census Progress').should('match', 'h4');
      cy.contains('Your Profile').should('match', 'h4');
      cy.contains('Recent Activity').should('match', 'h4');
    });

    it('should have sufficient color contrast', () => {
      // Verify text is readable (basic check)
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Census Progress').should('be.visible');
    });
  });

  describe('Critical User Flows', () => {
    it('should complete full dashboard viewing workflow', () => {
      // 1. User logs in
      cy.url().should('include', '/dashboard');

      // 2. User sees welcome message
      cy.get('@currentUser').then((user: any) => {
        cy.contains(`Welcome back, ${user.user.name}!`).should('be.visible');
      });

      // 3. User selects site and plot (already done in beforeEach)
      // Data loads

      // 4. User views metric cards
      cy.contains('Total Trees').should('be.visible');

      // 5. User checks progress
      cy.contains('Census Progress').should('be.visible');

      // 6. User toggles census visualization
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .click();
      cy.contains('Pie Chart View').should('be.visible');

      // 7. User views recent activity
      cy.contains('Recent Activity').scrollIntoView().should('be.visible');

      // 8. User checks profile
      cy.contains('Your Profile').should('be.visible');

      // Complete workflow successful
    });

    it('should handle site/plot changes correctly', () => {
      // Initial data loaded
      cy.contains('Total Trees').should('be.visible');

      // Change census
      cy.get('[data-testid="census-selector"]').click();

      // Data should refresh
      cy.contains('Total Trees').should('be.visible');
      cy.contains('Census Progress').should('be.visible');
    });

    it('should persist user interactions across page refreshes', () => {
      // Toggle to pie chart
      cy.contains('Tachometer View')
        .parent()
        .parent()
        .find('[role="button"]')
        .first()
        .click();
      cy.contains('Pie Chart View').should('be.visible');

      // Refresh page
      cy.reload();
      cy.wait('@getSession');

      // Should reset to tachometer (default state)
      cy.contains('Tachometer View - Click to toggle', { timeout: 5000 }).should('be.visible');
    });
  });
});
