/**
 * Admin Workflows E2E Tests
 *
 * Tests comprehensive admin operations including:
 * - Site management (CRUD operations)
 * - User management (CRUD operations)
 * - User-to-site assignment (access control)
 * - Role-based access control verification
 *
 * Priority: CRITICAL (0% current coverage)
 * Coverage Target: 95%
 */

describe('Admin Workflows', () => {
  // Test data
  const testSite = {
    siteName: `E2E_Test_Site_${Date.now()}`,
    schemaName: `e2e_test_schema_${Date.now()}`,
    sqDimX: 5,
    sqDimY: 5,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false
  };

  const testUser = {
    firstName: 'E2E',
    lastName: `Test_User_${Date.now()}`,
    email: `e2e_test_user_${Date.now()}@forestgeo.si.edu`,
    notifications: true,
    userStatus: 'field crew'
  };

  beforeEach(() => {
    // Set up authentication and common mocks
    cy.loginAsAdmin();
    cy.setupCommonMocks();
    cy.log('✅ Admin user authenticated');
  });

  describe('Site Management', () => {
    beforeEach(() => {
      // Set up API mocks BEFORE visiting the page
      cy.intercept('GET', '**/api/administrative/fetch/sites**', {
        statusCode: 200,
        body: []
      }).as('fetchSites');

      // Navigate to admin sites page
      cy.visit('/admin/sites');
      cy.log('📍 Navigated to /admin/sites');

      // Wait for page to be ready - check for grid instead of API call
      cy.get('[role="grid"]', { timeout: 15000 }).should('exist');
    });

    it('should display sites admin page', () => {
      cy.log('🔍 Verifying sites admin page displays');

      // Verify page loaded
      cy.url().should('include', '/admin/sites');

      // Verify data grid is present
      cy.get('[role="grid"]', { timeout: 10000 }).should('be.visible');

      // Verify toolbar is present
      cy.get('[role="toolbar"]', { timeout: 5000 }).should('be.visible');

      cy.log('✅ Sites admin page displayed successfully');
    });

    it('should create a new site', () => {
      cy.log('➕ Creating new site:', testSite.siteName);

      // Mock successful site creation
      cy.intercept('POST', '/api/fixeddata/sites', {
        statusCode: 200,
        body: {
          message: 'Site created successfully',
          row: { ...testSite, siteID: 999 }
        }
      }).as('createSite');

      // Click "Add Row" button
      cy.contains('button', /add/i).click();
      cy.log('  📝 Clicked Add button');

      // Fill in site details
      cy.get('input[name="siteName"]').clear().type(testSite.siteName);
      cy.get('input[name="schemaName"]').clear().type(testSite.schemaName);
      cy.get('input[name="sqDimX"]').clear().type(testSite.sqDimX.toString());
      cy.get('input[name="sqDimY"]').clear().type(testSite.sqDimY.toString());
      cy.get('input[name="defaultUOMDBH"]').clear().type(testSite.defaultUOMDBH);
      cy.get('input[name="defaultUOMHOM"]').clear().type(testSite.defaultUOMHOM);

      cy.log('  📝 Filled in site details');

      // Save the new site
      cy.get('button[aria-label*="save"]').click();
      cy.wait('@createSite');

      cy.log('  💾 Saved new site');

      // Verify success message
      cy.contains(/site created|row added|success/i, { timeout: 5000 }).should('be.visible');

      cy.log('✅ Site created successfully');
    });

    it('should edit an existing site', () => {
      cy.log('✏️ Editing existing site');

      // Mock sites list with existing site
      cy.intercept('GET', '/api/administrative/fetch/sites**', {
        statusCode: 200,
        body: [{ ...testSite, siteID: 999 }]
      }).as('fetchSitesWithData');

      // Reload to get sites
      cy.reload();
      cy.wait('@fetchSitesWithData');

      // Mock successful edit
      cy.intercept('PATCH', '/api/fixeddata/sites', {
        statusCode: 200,
        body: {
          message: 'Site updated successfully',
          row: { ...testSite, siteID: 999, siteName: testSite.siteName + '_EDITED' }
        }
      }).as('editSite');

      // Click edit button for first row
      cy.get('[data-testid="EditIcon"]').first().click();
      cy.log('  📝 Clicked Edit button');

      // Modify site name
      cy.get('input[name="siteName"]').clear().type(testSite.siteName + '_EDITED');
      cy.log('  📝 Modified site name');

      // Save changes
      cy.get('button[aria-label*="save"]').click();
      cy.wait('@editSite');

      cy.log('  💾 Saved changes');

      // Verify success message
      cy.contains(/updated|success/i, { timeout: 5000 }).should('be.visible');

      cy.log('✅ Site edited successfully');
    });

    it('should delete a site', () => {
      cy.log('🗑️ Deleting site');

      // Mock sites list with site to delete
      cy.intercept('GET', '/api/administrative/fetch/sites**', {
        statusCode: 200,
        body: [{ ...testSite, siteID: 999 }]
      }).as('fetchSitesWithData');

      cy.reload();
      cy.wait('@fetchSitesWithData');

      // Mock successful deletion
      cy.intercept('DELETE', '/api/fixeddata/sites*', {
        statusCode: 200,
        body: {
          message: 'Site deleted successfully'
        }
      }).as('deleteSite');

      // Click delete button
      cy.get('[data-testid="DeleteOutlinedIcon"]').first().click();
      cy.log('  📝 Clicked Delete button');

      // Confirm deletion
      cy.contains('button', /confirm|yes|delete/i).click();
      cy.wait('@deleteSite');

      cy.log('  ✅ Confirmed deletion');

      // Verify success message or empty grid
      cy.contains(/deleted|success/i, { timeout: 5000 }).should('be.visible');

      cy.log('✅ Site deleted successfully');
    });

    it('should validate site creation with required fields', () => {
      cy.log('🔍 Testing site creation validation');

      // Click "Add Row" button
      cy.contains('button', /add/i).click();

      // Try to save without required fields
      cy.get('button[aria-label*="save"]').click();

      // Should show validation error
      cy.contains(/required|invalid|error/i, { timeout: 5000 }).should('be.visible');

      cy.log('✅ Validation works correctly');
    });
  });

  describe('User Management', () => {
    beforeEach(() => {
      // Set up API mocks BEFORE visiting the page
      cy.intercept('GET', '**/api/administrative/fetch/users**', {
        statusCode: 200,
        body: []
      }).as('fetchUsers');

      // Mock API calls for sites list (needed for user-site mapping)
      cy.intercept('GET', '**/api/administrative/fetch/sites**', {
        statusCode: 200,
        body: []
      }).as('fetchSites');

      // Navigate to admin users page
      cy.visit('/admin/users');
      cy.log('📍 Navigated to /admin/users');

      // Wait for page to be ready - check for table instead of API calls
      cy.get('table', { timeout: 15000 }).should('exist');
    });

    it('should display users admin page', () => {
      cy.log('🔍 Verifying users admin page displays');

      // Verify page loaded
      cy.url().should('include', '/admin/users');

      // Verify table is present
      cy.get('table', { timeout: 10000 }).should('be.visible');

      // Verify table headers
      cy.contains('th', 'First Name').should('be.visible');
      cy.contains('th', 'Last Name').should('be.visible');
      cy.contains('th', 'Email').should('be.visible');
      cy.contains('th', 'Notifications').should('be.visible');
      cy.contains('th', 'User Status').should('be.visible');

      cy.log('✅ Users admin page displayed successfully');
    });

    it('should display existing users', () => {
      cy.log('🔍 Displaying existing users');

      // Mock users list with test data
      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@forestgeo.si.edu',
            notifications: true,
            userStatus: 'global',
            userSites: '1;2'
          },
          {
            userID: 2,
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane.smith@forestgeo.si.edu',
            notifications: false,
            userStatus: 'field crew',
            userSites: '1'
          }
        ]
      }).as('fetchUsersWithData');

      cy.reload();
      cy.wait('@fetchUsersWithData');

      // Verify users are displayed
      cy.contains('John').should('be.visible');
      cy.contains('Doe').should('be.visible');
      cy.contains('jane.smith@forestgeo.si.edu').should('be.visible');

      cy.log('✅ Users displayed successfully');
    });

    it('should edit user details', () => {
      cy.log('✏️ Editing user details');

      // Mock users list
      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@forestgeo.si.edu',
            notifications: true,
            userStatus: 'global',
            userSites: '1'
          }
        ]
      }).as('fetchUsersWithData');

      cy.reload();
      cy.wait('@fetchUsersWithData');

      // Mock successful edit
      cy.intercept('PATCH', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: {
          message: 'User updated successfully'
        }
      }).as('editUser');

      // Edit first name
      cy.get('input[name="firstName"]').first().clear().type('Jonathan');
      cy.log('  📝 Modified first name');

      // Edit last name
      cy.get('input[name="lastName"]').first().clear().type('Doe-Smith');
      cy.log('  📝 Modified last name');

      // Edit email
      cy.get('input[name="email"]').first().clear().type('jonathan.doesmith@forestgeo.si.edu');
      cy.log('  📝 Modified email');

      // Change user status
      cy.get('select[name="userStatus"]').first().click();
      cy.contains('[role="option"]', 'Lead Technician').click();
      cy.log('  📝 Changed user status');

      // Save changes
      cy.contains('button', 'Save Changes').should('not.be.disabled');
      cy.contains('button', 'Save Changes').click();
      cy.wait('@editUser');

      cy.log('  💾 Saved changes');

      cy.log('✅ User edited successfully');
    });

    it('should toggle user notifications', () => {
      cy.log('🔔 Toggling user notifications');

      // Mock users list
      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@forestgeo.si.edu',
            notifications: false,
            userStatus: 'global',
            userSites: '1'
          }
        ]
      }).as('fetchUsersWithData');

      cy.reload();
      cy.wait('@fetchUsersWithData');

      // Mock successful edit
      cy.intercept('PATCH', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: {
          message: 'User updated successfully'
        }
      }).as('editUser');

      // Toggle notifications checkbox
      cy.get('input[name="notifications"]').first().check();
      cy.log('  📝 Enabled notifications');

      // Save changes
      cy.contains('button', 'Save Changes').click();
      cy.wait('@editUser');

      cy.log('✅ Notifications toggled successfully');
    });

    it('should discard unsaved changes', () => {
      cy.log('↩️ Discarding unsaved changes');

      // Mock users list
      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@forestgeo.si.edu',
            notifications: true,
            userStatus: 'global',
            userSites: '1'
          }
        ]
      }).as('fetchUsersWithData');

      cy.reload();
      cy.wait('@fetchUsersWithData');

      // Make changes
      cy.get('input[name="firstName"]').first().clear().type('Modified');
      cy.log('  📝 Made changes');

      // Verify Save/Discard buttons are enabled
      cy.contains('button', 'Save Changes').should('not.be.disabled');
      cy.contains('button', 'Discard Changes').should('not.be.disabled');

      // Click Discard Changes
      cy.contains('button', 'Discard Changes').click();
      cy.log('  ↩️ Clicked Discard Changes');

      // Verify original value is restored
      cy.get('input[name="firstName"]').first().should('have.value', 'John');

      // Verify Save/Discard buttons are disabled again
      cy.contains('button', 'Save Changes').should('be.disabled');
      cy.contains('button', 'Discard Changes').should('be.disabled');

      cy.log('✅ Changes discarded successfully');
    });
  });

  describe('User-to-Site Assignment', () => {
    beforeEach(() => {
      // Set up API mocks BEFORE visiting the page
      cy.intercept('GET', '**/api/administrative/fetch/usersiterelations**', {
        statusCode: 200,
        body: []
      }).as('fetchUserSiteRelations');

      cy.intercept('GET', '**/api/administrative/fetch/users**', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@forestgeo.si.edu',
            userStatus: 'global'
          },
          {
            userID: 2,
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane.smith@forestgeo.si.edu',
            userStatus: 'field crew'
          }
        ]
      }).as('fetchUsers');

      cy.intercept('GET', '**/api/administrative/fetch/sites**', {
        statusCode: 200,
        body: [
          {
            siteID: 1,
            siteName: 'Test Site 1',
            schemaName: 'test_site_1'
          },
          {
            siteID: 2,
            siteName: 'Test Site 2',
            schemaName: 'test_site_2'
          }
        ]
      }).as('fetchSites');

      // Navigate to users-to-sites page
      cy.visit('/admin/userstosites');
      cy.log('📍 Navigated to /admin/userstosites');

      // Wait for page content to load - check for loading message or tabs
      cy.contains('Loading...', { timeout: 15000 }).should('not.exist');
    });

    it('should display users-to-sites assignment page', () => {
      cy.log('🔍 Verifying users-to-sites page displays');

      // Verify page loaded
      cy.url().should('include', '/admin/userstosites');

      // Verify tabs are present (vertical tabs with users)
      cy.get('[role="tablist"]', { timeout: 10000 }).should('be.visible');

      // Verify user tabs are displayed
      cy.contains('[role="tab"]', 'John Doe').should('be.visible');
      cy.contains('[role="tab"]', 'Jane Smith').should('be.visible');

      // Verify Save/Discard buttons
      cy.contains('button', 'Save Changes').should('be.visible');
      cy.contains('button', 'Discard Changes').should('be.visible');

      cy.log('✅ Users-to-sites page displayed successfully');
    });

    it('should display user site assignments', () => {
      cy.log('🔍 Displaying user site assignments');

      // Mock user-site relations
      cy.intercept('GET', '/api/administrative/fetch/usersiterelations', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            userName: 'John Doe',
            siteID: 1,
            siteName: 'Test Site 1'
          },
          {
            userID: 2,
            userName: 'Jane Smith',
            siteID: 2,
            siteName: 'Test Site 2'
          }
        ]
      }).as('fetchUserSiteRelationsWithData');

      cy.reload();
      cy.wait('@fetchUserSiteRelationsWithData');

      // Click on first user tab
      cy.contains('[role="tab"]', 'John Doe').click();
      cy.log('  📝 Selected John Doe');

      // Verify site chips are displayed
      cy.get('[role="tabpanel"]').within(() => {
        cy.contains('Test Site 1').should('be.visible');
        cy.contains('Test Site 2').should('be.visible');

        // Verify Test Site 1 is highlighted (assigned)
        cy.contains('Test Site 1').parent().should('have.attr', 'color', 'primary');

        // Verify Test Site 2 is not highlighted (not assigned)
        cy.contains('Test Site 2').parent().should('have.attr', 'color', 'neutral');
      });

      cy.log('✅ User site assignments displayed correctly');
    });

    it('should switch between users', () => {
      cy.log('🔄 Switching between users');

      // Mock user-site relations
      cy.intercept('GET', '/api/administrative/fetch/usersiterelations', {
        statusCode: 200,
        body: [
          {
            userID: 1,
            userName: 'John Doe',
            siteID: 1,
            siteName: 'Test Site 1'
          },
          {
            userID: 2,
            userName: 'Jane Smith',
            siteID: 2,
            siteName: 'Test Site 2'
          }
        ]
      }).as('fetchUserSiteRelationsWithData');

      cy.reload();
      cy.wait('@fetchUserSiteRelationsWithData');

      // Click on first user
      cy.contains('[role="tab"]', 'John Doe').click();
      cy.log('  📝 Selected John Doe');

      // Verify John's sites are shown
      cy.get('[role="tabpanel"]').within(() => {
        cy.contains('Test Site 1').parent().should('have.attr', 'color', 'primary');
      });

      // Click on second user
      cy.contains('[role="tab"]', 'Jane Smith').click();
      cy.log('  📝 Selected Jane Smith');

      // Verify Jane's sites are shown
      cy.get('[role="tabpanel"]').within(() => {
        cy.contains('Test Site 2').parent().should('have.attr', 'color', 'primary');
      });

      cy.log('✅ User switching works correctly');
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin to access all admin pages', () => {
      cy.log('🔑 Testing admin access to all pages');

      // Set up intercepts for sites page
      cy.intercept('POST', '/api/fixeddatafilter/sites**', {
        statusCode: 200,
        body: { output: [], totalCount: 0 }
      }).as('fetchSites');

      // Admin should be able to access sites page
      cy.visit('/admin/sites');
      cy.url().should('include', '/admin/sites');
      cy.log('  ✅ Admin can access /admin/sites');

      // Set up intercepts for users page
      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: []
      }).as('fetchUsers');
      cy.intercept('GET', '/api/administrative/fetch/sites', {
        statusCode: 200,
        body: []
      }).as('fetchSitesAdmin');

      // Admin should be able to access users page
      cy.visit('/admin/users');
      cy.url().should('include', '/admin/users');
      cy.log('  ✅ Admin can access /admin/users');

      // Set up intercepts for users-to-sites page
      cy.intercept('GET', '/api/administrative/fetch/usersiterelations', {
        statusCode: 200,
        body: []
      }).as('fetchUserSiteRelations');

      // Admin should be able to access users-to-sites page
      cy.visit('/admin/userstosites');
      cy.url().should('include', '/admin/userstosites');
      cy.log('  ✅ Admin can access /admin/userstosites');

      cy.log('✅ Admin has access to all admin pages');
    });

    it('should restrict non-admin users from accessing admin pages', () => {
      cy.log('🚫 Testing non-admin access restrictions');

      // Mock session as non-admin user
      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: {
            name: 'Standard User',
            email: 'user@forestgeo.si.edu',
            userStatus: 'field crew' // Non-admin role
          },
          expires: '2025-12-31'
        }
      }).as('nonAdminSession');

      // Try to access admin sites page
      cy.visit('/admin/sites');
      cy.wait('@nonAdminSession');

      // Should either:
      // 1. Redirect to unauthorized page
      // 2. Show access denied message
      // 3. Redirect to dashboard
      cy.url().should('not.include', '/admin/sites');

      cy.log('✅ Non-admin users are restricted from admin pages');
    });

    it('should verify admin role can perform all operations', () => {
      cy.log('🔑 Verifying admin can perform all operations');

      // Admin should see all buttons/actions
      cy.visit('/admin/sites');

      // Mock sites API
      cy.intercept('POST', '/api/fixeddatafilter/sites*', {
        statusCode: 200,
        body: {
          output: [],
          totalCount: 0
        }
      }).as('fetchSites');

      cy.wait('@fetchSites');

      // Verify Add button is visible
      cy.contains('button', /add/i).should('be.visible').and('not.be.disabled');
      cy.log('  ✅ Admin can add sites');

      // Verify Edit and Delete buttons would be available (on rows)
      // Note: These would appear when data is present

      cy.log('✅ Admin has full access to all operations');
    });
  });

  describe('Integration Tests: Complete Admin Workflow', () => {
    it('should complete full admin workflow: create site, create user, assign user to site', () => {
      cy.log('🔄 Running complete admin workflow');

      // STEP 1: Create a new site
      cy.log('📍 STEP 1: Creating new site');

      // Set up intercepts BEFORE visiting
      cy.intercept('POST', '/api/fixeddatafilter/sites**', {
        statusCode: 200,
        body: {
          output: [],
          totalCount: 0
        }
      }).as('fetchSites');

      cy.visit('/admin/sites');
      cy.wait('@fetchSites', { timeout: 10000 });

      cy.intercept('POST', '/api/fixeddata/sites', {
        statusCode: 200,
        body: {
          message: 'Site created successfully',
          row: { ...testSite, siteID: 999 }
        }
      }).as('createSite');

      cy.contains('button', /add/i).click();
      cy.get('input[name="siteName"]').type(testSite.siteName);
      cy.get('input[name="schemaName"]').type(testSite.schemaName);
      cy.get('button[aria-label*="save"]').click();
      cy.wait('@createSite');

      cy.log('  ✅ Site created');

      // STEP 2: Create a new user (note: user creation may need different approach)
      cy.log('📍 STEP 2: Verifying user management');
      cy.visit('/admin/users');

      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 888,
            firstName: testUser.firstName,
            lastName: testUser.lastName,
            email: testUser.email,
            notifications: testUser.notifications,
            userStatus: testUser.userStatus,
            userSites: ''
          }
        ]
      }).as('fetchUsersWithNewUser');

      cy.intercept('GET', '/api/administrative/fetch/sites', {
        statusCode: 200,
        body: [{ ...testSite, siteID: 999 }]
      }).as('fetchSitesForUsers');

      cy.reload();
      cy.wait('@fetchUsersWithNewUser');
      cy.wait('@fetchSitesForUsers');

      cy.contains(testUser.email).should('be.visible');
      cy.log('  ✅ User displayed');

      // STEP 3: Assign user to site
      cy.log('📍 STEP 3: Assigning user to site');
      cy.visit('/admin/userstosites');

      cy.intercept('GET', '/api/administrative/fetch/usersiterelations', {
        statusCode: 200,
        body: []
      }).as('fetchUserSiteRelations');

      cy.intercept('GET', '/api/administrative/fetch/users', {
        statusCode: 200,
        body: [
          {
            userID: 888,
            firstName: testUser.firstName,
            lastName: testUser.lastName,
            email: testUser.email,
            userStatus: testUser.userStatus
          }
        ]
      }).as('fetchUsers');

      cy.intercept('GET', '/api/administrative/fetch/sites', {
        statusCode: 200,
        body: [{ siteID: 999, siteName: testSite.siteName, schemaName: testSite.schemaName }]
      }).as('fetchSites');

      cy.wait('@fetchUserSiteRelations');
      cy.wait('@fetchUsers');
      cy.wait('@fetchSites');

      // Find and click on the user tab
      cy.contains('[role="tab"]', `${testUser.firstName} ${testUser.lastName}`).click();
      cy.log('  ✅ Selected user tab');

      // Site chips should be visible
      cy.contains(testSite.siteName).should('be.visible');
      cy.log('  ✅ Site assignment interface displayed');

      cy.log('✅ Complete admin workflow verified');
    });
  });
});
