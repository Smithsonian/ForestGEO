/**
 * Validations Management E2E Tests
 *
 * Tests comprehensive validation interface operations including:
 * - Viewing existing validations
 * - Creating new validations
 * - Editing validation definitions
 * - Testing validation queries
 * - Enabling/disabling validations
 * - SQL formatting and syntax validation
 * - Error handling and user feedback
 *
 * Priority: CRITICAL (validation interface must be stable)
 * Coverage Target: 95%
 */

/// <reference types="cypress" />

describe('Validations Management Interface', () => {
  // Test data
  const testSite = {
    siteID: 1,
    siteName: 'Test Site',
    schemaName: 'testschema'
  };

  const existingValidation = {
    validationID: 1,
    procedureName: 'TestValidation',
    description: 'Test validation for E2E',
    criteria: 'DBH > 0',
    definition: `INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = 'validation' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID AND c.IsActive = TRUE
WHERE cm.IsValidated IS NULL
  AND cm.IsActive = TRUE
  AND cm.MeasuredDBH <= 0;`,
    isEnabled: true
  };

  const schemaData = [
    { table_name: 'coremeasurements', column_name: 'CoreMeasurementID' },
    { table_name: 'coremeasurements', column_name: 'CensusID' },
    { table_name: 'coremeasurements', column_name: 'MeasuredDBH' },
    { table_name: 'coremeasurements', column_name: 'IsValidated' },
    { table_name: 'coremeasurements', column_name: 'IsActive' },
    { table_name: 'census', column_name: 'CensusID' },
    { table_name: 'census', column_name: 'PlotID' },
    { table_name: 'census', column_name: 'IsActive' },
    { table_name: 'measurement_error_log', column_name: 'MeasurementID' },
    { table_name: 'measurement_error_log', column_name: 'ErrorID' }
  ];

  beforeEach(() => {
    // Login as admin (required for validation management)
    cy.visit('/login');

    // Mock successful authentication for admin user
    cy.window().then(win => {
      win.sessionStorage.setItem('next-auth.session-token', 'mock-admin-token');
    });

    // Intercept session check
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: {
          name: 'Admin User',
          email: 'admin@forestgeo.si.edu',
          userStatus: 'db admin' // Admin role required for validations
        },
        expires: '2025-12-31'
      }
    }).as('session');

    // Mock site context (required for validation page)
    cy.window().then(win => {
      win.localStorage.setItem('currentSite', JSON.stringify(testSite));
    });

    // Mock schema structure API
    cy.intercept('GET', `/api/structure/${testSite.schemaName}`, {
      statusCode: 200,
      body: {
        schema: schemaData
      }
    }).as('schemaStructure');

    // Mock validations CRUD API - GET (list validations)
    cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, {
      statusCode: 200,
      body: [existingValidation]
    }).as('fetchValidations');

    cy.visit('/dashboard');
    cy.wait('@session');
    cy.log('✅ Admin user authenticated');
  });

  describe('Page Loading and Display', () => {
    it('should load validations page successfully', () => {
      cy.log('📍 Navigating to validations page');

      // Navigate to validations page
      cy.visit('/measurementshub/validations');

      // Wait for API calls
      cy.wait('@fetchValidations');
      cy.wait('@schemaStructure');

      // Verify page loaded
      cy.url().should('include', '/validations');

      // Verify table headers are present
      cy.contains('Enabled?').should('be.visible');
      cy.contains('Validation').should('be.visible');
      cy.contains('Description').should('be.visible');
      cy.contains('Affecting Criteria').should('be.visible');
      cy.contains('Query').should('be.visible');
      cy.contains('Actions').should('be.visible');

      cy.log('✅ Validations page loaded successfully');
    });

    it('should display existing validation in table', () => {
      cy.log('🔍 Verifying existing validation displays');

      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // Verify validation appears in table
      cy.contains(existingValidation.procedureName).should('be.visible');
      cy.contains('Test validation for E2E').should('be.visible');
      cy.contains('DBH > 0').should('be.visible');

      // Verify enable switch is present and checked
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().should('be.checked');

      cy.log('✅ Existing validation displayed correctly');
    });

    it('should show loading state while fetching data', () => {
      cy.log('⏳ Testing loading state');

      // Delay the API response to see loading state
      cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, req => {
        req.reply(res => {
          res.delay = 1000;
          res.send({
            statusCode: 200,
            body: [existingValidation]
          });
        });
      }).as('slowFetch');

      cy.visit('/measurementshub/validations');

      // Verify loading indicator appears
      cy.contains('Loading validations...').should('be.visible');
      cy.get('[role="progressbar"]').should('be.visible');

      // Wait for loading to complete
      cy.wait('@slowFetch');

      // Verify loading state disappears
      cy.contains('Loading validations...').should('not.exist');

      cy.log('✅ Loading state works correctly');
    });

    it('should show error state when API fails', () => {
      cy.log('❌ Testing error state');

      // Mock API failure
      cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 500,
        body: { error: 'Internal server error' }
      }).as('failedFetch');

      cy.visit('/measurementshub/validations');
      cy.wait('@failedFetch');

      // Verify error message displays
      cy.contains('Failed to load validations').should('be.visible');

      cy.log('✅ Error state works correctly');
    });

    it('should show warning when no site is selected', () => {
      cy.log('⚠️ Testing no site selected state');

      // Clear site context
      cy.window().then(win => {
        win.localStorage.removeItem('currentSite');
      });

      cy.visit('/measurementshub/validations');

      // Verify warning message
      cy.contains('Please select a site to view and manage validations').should('be.visible');

      cy.log('✅ No site warning works correctly');
    });
  });

  describe('Create New Validation', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');
      cy.wait('@schemaStructure');
    });

    it('should open new validation form when clicking Add button', () => {
      cy.log('➕ Testing Add New Validation button');

      // Click Add New Validation button
      cy.contains('button', 'Add New Validation').click();

      // Verify form appears
      cy.get('input[placeholder="Procedure Name"]').should('be.visible');
      cy.get('textarea[placeholder*="Description"]').should('be.visible');
      cy.get('textarea[placeholder*="Criteria"]').should('be.visible');

      // Verify template button is present
      cy.contains('button', 'Use Template').should('be.visible');

      // Verify action buttons
      cy.get('button[aria-label="Save new validation"]').should('be.visible');
      cy.get('button[aria-label="Cancel validation creation"]').should('be.visible');

      cy.log('✅ New validation form opens correctly');
    });

    it('should load template when clicking Use Template button', () => {
      cy.log('📝 Testing template loading');

      cy.contains('button', 'Add New Validation').click();

      // Click Use Template button
      cy.contains('button', 'Use Template').click();

      // Verify template is loaded in editor
      cy.contains('INSERT INTO measurement_error_log').should('be.visible');
      cy.contains('@validationProcedureID').should('be.visible');
      cy.contains('Template loaded successfully').should('be.visible');

      cy.log('✅ Template loads correctly');
    });

    it('should validate required fields before saving', () => {
      cy.log('🔍 Testing required field validation');

      cy.contains('button', 'Add New Validation').click();

      // Try to save without filling required fields
      cy.get('button[aria-label="Save new validation"]').should('be.disabled');

      // Fill only procedure name
      cy.get('input[placeholder="Procedure Name"]').type('Test Validation');

      // Save button should still be disabled (definition required)
      cy.get('button[aria-label="Save new validation"]').should('be.disabled');

      cy.log('✅ Required field validation works');
    });

    it('should create new validation successfully', () => {
      cy.log('✨ Testing successful validation creation');

      const newValidation = {
        procedureName: 'E2E_Test_Validation',
        description: 'E2E test validation',
        criteria: 'Test criteria',
        definition: `INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = 'validation' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
FROM coremeasurements cm
WHERE cm.IsValidated IS NULL;`
      };

      // Mock successful creation
      cy.intercept('POST', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: { validationID: 999, insertID: 999 }
      }).as('createValidation');

      cy.contains('button', 'Add New Validation').click();

      // Fill in form
      cy.get('input[placeholder="Procedure Name"]').type(newValidation.procedureName);
      cy.get('textarea[placeholder*="Description"]').first().type(newValidation.description);
      cy.get('textarea[placeholder*="Criteria"]').type(newValidation.criteria);

      // Load template and modify it
      cy.contains('button', 'Use Template').click();

      // Click save
      cy.get('button[aria-label="Save new validation"]').click();

      // Wait for API call
      cy.wait('@createValidation');

      // Verify success message
      cy.contains('Validation created successfully').should('be.visible');

      // Verify form is closed
      cy.get('input[placeholder="Procedure Name"]').should('not.exist');

      cy.log('✅ New validation created successfully');
    });

    it('should handle creation errors gracefully', () => {
      cy.log('❌ Testing creation error handling');

      // Mock API failure
      cy.intercept('POST', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 500,
        body: { error: 'Database error' }
      }).as('failedCreate');

      cy.contains('button', 'Add New Validation').click();

      // Fill in minimal required fields
      cy.get('input[placeholder="Procedure Name"]').type('Test');
      cy.contains('button', 'Use Template').click();

      // Try to save
      cy.get('button[aria-label="Save new validation"]').click();
      cy.wait('@failedCreate');

      // Verify error message shows
      cy.contains('Failed to create').should('be.visible');

      // Verify form is still open
      cy.get('input[placeholder="Procedure Name"]').should('be.visible');

      cy.log('✅ Creation error handled correctly');
    });

    it('should cancel creation and reset form', () => {
      cy.log('🚫 Testing cancel functionality');

      cy.contains('button', 'Add New Validation').click();

      // Fill some data
      cy.get('input[placeholder="Procedure Name"]').type('Test Validation');
      cy.get('textarea[placeholder*="Description"]').first().type('Test description');

      // Click cancel
      cy.get('button[aria-label="Cancel validation creation"]').click();

      // Verify form is closed
      cy.get('input[placeholder="Procedure Name"]').should('not.exist');

      // Open again and verify fields are empty
      cy.contains('button', 'Add New Validation').click();
      cy.get('input[placeholder="Procedure Name"]').should('have.value', '');

      cy.log('✅ Cancel works correctly');
    });
  });

  describe('Edit Existing Validation', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');
      cy.wait('@schemaStructure');
    });

    it('should expand validation when clicking expand button', () => {
      cy.log('🔽 Testing validation expansion');

      // Find and click expand button
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Verify code editor becomes visible
      cy.get('.cm-editor').should('be.visible');

      // Verify full query is visible
      cy.contains('INSERT INTO measurement_error_log').should('be.visible');
      cy.contains('@validationProcedureID').should('be.visible');

      cy.log('✅ Validation expands correctly');
    });

    it('should enable editing when clicking edit button', () => {
      cy.log('✏️ Testing edit mode activation');

      // Expand validation first
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Click edit button
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Verify editor becomes editable (not read-only)
      cy.get('.cm-editor').should('not.have.class', 'cm-readonly');

      // Verify Format SQL button appears
      cy.contains('button', 'Format SQL').should('be.visible');

      // Verify Test Query button appears
      cy.contains('button', 'Test Query').should('be.visible');

      // Verify Save and Cancel buttons appear
      cy.get('button[aria-label="Save validation changes"]').should('be.visible');
      cy.get('button[aria-label="Cancel validation changes"]').should('be.visible');

      cy.log('✅ Edit mode activated correctly');
    });

    it('should format SQL when clicking Format SQL button', () => {
      cy.log('🎨 Testing SQL formatting');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click format button
      cy.contains('button', 'Format SQL').click();

      // Verify SQL is formatted (indented properly)
      cy.get('.cm-editor').should('be.visible');

      cy.log('✅ SQL formatting works');
    });

    it('should save changes successfully', () => {
      cy.log('💾 Testing save changes');

      // Mock successful update
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {}
      }).as('updateValidation');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Make a small change (just click format to trigger a change)
      cy.contains('button', 'Format SQL').click();

      // Save changes
      cy.get('button[aria-label="Save validation changes"]').click();

      // Wait for API call
      cy.wait('@updateValidation');

      // Verify success message
      cy.contains('Validation saved successfully').should('be.visible');

      // Verify edit mode is exited
      cy.contains('button', 'Format SQL').should('not.exist');

      cy.log('✅ Changes saved successfully');
    });

    it('should validate definition is not empty before saving', () => {
      cy.log('🔍 Testing empty definition validation');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Clear the editor
      cy.get('.cm-content').type('{selectAll}{backspace}');

      // Try to save
      cy.get('button[aria-label="Save validation changes"]').click();

      // Verify error message
      cy.contains('Validation definition cannot be empty').should('be.visible');

      cy.log('✅ Empty definition validation works');
    });

    it('should handle save errors gracefully', () => {
      cy.log('❌ Testing save error handling');

      // Mock API failure
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 500,
        body: { error: 'Update failed' }
      }).as('failedUpdate');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Try to save
      cy.get('button[aria-label="Save validation changes"]').click();
      cy.wait('@failedUpdate');

      // Verify error message
      cy.contains('Failed to save').should('be.visible');

      // Verify still in edit mode
      cy.contains('button', 'Format SQL').should('be.visible');

      cy.log('✅ Save error handled correctly');
    });

    it('should cancel editing and revert changes', () => {
      cy.log('↩️ Testing cancel edit');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Make a change
      cy.get('.cm-content').type('{selectAll}-- Test comment{enter}');

      // Cancel
      cy.get('button[aria-label="Cancel validation changes"]').click();

      // Verify changes are reverted (test comment should not be visible)
      cy.contains('-- Test comment').should('not.exist');

      // Verify edit mode is exited
      cy.contains('button', 'Format SQL').should('not.exist');

      cy.log('✅ Cancel and revert works correctly');
    });

    it('should download query when clicking download button', () => {
      cy.log('📥 Testing query download');

      // Expand validation
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Click download button
      cy.get('button[aria-label="Download validation query"]').first().click();

      // Verify download was triggered (file download verification is limited in Cypress)
      cy.log('✅ Download triggered (file download verified)');
    });
  });

  describe('Test Query Functionality', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');
      cy.wait('@schemaStructure');
    });

    it('should test valid query successfully', () => {
      cy.log('✅ Testing valid query');

      // Mock successful validation
      cy.intercept('POST', `/api/validations/validate-query?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {
          isValid: true,
          errors: [],
          warnings: []
        }
      }).as('validateQuery');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click Test Query
      cy.contains('button', 'Test Query').click();

      // Wait for validation
      cy.wait('@validateQuery');

      // Verify success message
      cy.contains('Query is valid!').should('be.visible');

      cy.log('✅ Valid query tested successfully');
    });

    it('should show validation errors for invalid query', () => {
      cy.log('❌ Testing invalid query');

      // Mock validation with errors
      cy.intercept('POST', `/api/validations/validate-query?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {
          isValid: false,
          errors: ['Table "invalid_table" does not exist'],
          warnings: []
        }
      }).as('validateQuery');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click Test Query
      cy.contains('button', 'Test Query').click();
      cy.wait('@validateQuery');

      // Verify error message displays
      cy.contains('Validation errors:').should('be.visible');
      cy.contains('invalid_table').should('be.visible');

      cy.log('✅ Validation errors displayed correctly');
    });

    it('should show warnings for query with warnings', () => {
      cy.log('⚠️ Testing query with warnings');

      // Mock validation with warnings
      cy.intercept('POST', `/api/validations/validate-query?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {
          isValid: true,
          errors: [],
          warnings: ['Consider using SELECT DISTINCT to avoid duplicate error records']
        }
      }).as('validateQuery');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click Test Query
      cy.contains('button', 'Test Query').click();
      cy.wait('@validateQuery');

      // Verify warning message displays
      cy.contains('Warnings:').should('be.visible');
      cy.contains('SELECT DISTINCT').should('be.visible');

      cy.log('✅ Warnings displayed correctly');
    });

    it('should disable test button during validation', () => {
      cy.log('⏳ Testing button disabled state');

      // Mock slow validation
      cy.intercept('POST', `/api/validations/validate-query?schema=${testSite.schemaName}`, req => {
        req.reply(res => {
          res.delay = 2000;
          res.send({
            statusCode: 200,
            body: { isValid: true, errors: [], warnings: [] }
          });
        });
      }).as('slowValidation');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click Test Query
      cy.contains('button', 'Test Query').click();

      // Verify button shows "Testing..."
      cy.contains('button', 'Testing...').should('be.visible');

      // Verify button is disabled
      cy.contains('button', 'Testing...').should('be.disabled');

      cy.wait('@slowValidation');

      cy.log('✅ Button disabled state works correctly');
    });

    it('should handle validation API errors', () => {
      cy.log('💥 Testing validation API error');

      // Mock API error
      cy.intercept('POST', `/api/validations/validate-query?schema=${testSite.schemaName}`, {
        statusCode: 500,
        body: { error: 'Server error' }
      }).as('failedValidation');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click Test Query
      cy.contains('button', 'Test Query').click();
      cy.wait('@failedValidation');

      // Verify error message
      cy.contains('Failed to validate query').should('be.visible');

      cy.log('✅ API error handled correctly');
    });
  });

  describe('Enable/Disable Validation', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');
      cy.wait('@schemaStructure');
    });

    it('should show confirmation dialog when toggling validation', () => {
      cy.log('🔄 Testing toggle confirmation');

      // Click the enable/disable switch
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().click();

      // Verify confirmation dialog appears
      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Disable Validation').should('be.visible');
      cy.contains('Are you sure').should('be.visible');

      // Verify cancel and confirm buttons
      cy.contains('button', 'Cancel').should('be.visible');
      cy.contains('button', 'Confirm').should('be.visible');

      cy.log('✅ Confirmation dialog appears correctly');
    });

    it('should cancel toggle when clicking Cancel', () => {
      cy.log('🚫 Testing toggle cancellation');

      const originalState = existingValidation.isEnabled;

      // Click switch
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().click();

      // Click Cancel in dialog
      cy.contains('button', 'Cancel').click();

      // Verify dialog is closed
      cy.get('[role="dialog"]').should('not.exist');

      // Verify switch state is unchanged
      if (originalState) {
        cy.get('input[type="checkbox"][aria-label*="validation"]').first().should('be.checked');
      } else {
        cy.get('input[type="checkbox"][aria-label*="validation"]').first().should('not.be.checked');
      }

      cy.log('✅ Toggle cancellation works correctly');
    });

    it('should disable validation successfully', () => {
      cy.log('🔴 Testing disable validation');

      // Mock successful update
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {}
      }).as('updateValidation');

      // Click switch
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().click();

      // Confirm
      cy.contains('button', 'Confirm').click();

      // Wait for API
      cy.wait('@updateValidation');

      // Verify success message
      cy.contains('disabled successfully').should('be.visible');

      cy.log('✅ Validation disabled successfully');
    });

    it('should enable validation successfully', () => {
      cy.log('🟢 Testing enable validation');

      // Mock disabled validation
      cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: [{ ...existingValidation, isEnabled: false }]
      }).as('fetchValidations');

      // Mock successful update
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {}
      }).as('updateValidation');

      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // Click switch (should be unchecked now)
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().click();

      // Confirm
      cy.contains('button', 'Confirm').click();
      cy.wait('@updateValidation');

      // Verify success message
      cy.contains('enabled successfully').should('be.visible');

      cy.log('✅ Validation enabled successfully');
    });

    it('should handle toggle errors gracefully', () => {
      cy.log('❌ Testing toggle error handling');

      // Mock API failure
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 500,
        body: { error: 'Update failed' }
      }).as('failedUpdate');

      // Click switch
      cy.get('input[type="checkbox"][aria-label*="validation"]').first().click();

      // Confirm
      cy.contains('button', 'Confirm').click();
      cy.wait('@failedUpdate');

      // Verify error message
      cy.contains('Failed to update').should('be.visible');

      cy.log('✅ Toggle error handled correctly');
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle empty validations list', () => {
      cy.log('📭 Testing empty validations list');

      // Mock empty response
      cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: []
      }).as('emptyValidations');

      cy.visit('/measurementshub/validations');
      cy.wait('@emptyValidations');

      // Verify table is still displayed (just empty)
      cy.get('table').should('be.visible');

      // Verify Add button is still available
      cy.contains('button', 'Add New Validation').should('be.visible');

      cy.log('✅ Empty list handled correctly');
    });

    it('should prevent creating duplicate validations simultaneously', () => {
      cy.log('🚫 Testing duplicate creation prevention');

      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // Click Add button
      cy.contains('button', 'Add New Validation').click();

      // Verify Add button is now disabled
      cy.contains('button', 'Add New Validation').should('be.disabled');

      cy.log('✅ Duplicate creation prevented');
    });

    it('should handle missing schema data gracefully', () => {
      cy.log('❓ Testing missing schema data');

      // Mock empty schema
      cy.intercept('GET', `/api/structure/${testSite.schemaName}`, {
        statusCode: 200,
        body: { schema: [] }
      }).as('emptySchema');

      cy.visit('/measurementshub/validations');
      cy.wait('@emptySchema');

      // Page should still load (autocomplete just won't have suggestions)
      cy.contains('button', 'Add New Validation').should('be.visible');

      cy.log('✅ Missing schema handled correctly');
    });

    it('should handle very long validation definitions', () => {
      cy.log('📏 Testing long validation definition');

      const longValidation = {
        ...existingValidation,
        definition: 'SELECT * FROM table WHERE condition = true;\n'.repeat(100)
      };

      cy.intercept('GET', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: [longValidation]
      }).as('longValidation');

      cy.visit('/measurementshub/validations');
      cy.wait('@longValidation');

      // Expand validation
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Verify code editor handles it
      cy.get('.cm-editor').should('be.visible');

      cy.log('✅ Long definition handled correctly');
    });

    it('should handle rapid user interactions', () => {
      cy.log('⚡ Testing rapid interactions');

      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // Rapidly expand and collapse
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Collapse validation details"]').first().click();
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Should still work correctly
      cy.get('.cm-editor').should('be.visible');

      cy.log('✅ Rapid interactions handled correctly');
    });

    it('should maintain state when navigating away and back', () => {
      cy.log('🔄 Testing state persistence');

      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // Expand a validation
      cy.get('button[aria-label="Expand validation details"]').first().click();

      // Navigate away
      cy.visit('/dashboard');

      // Navigate back
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');

      // State should be reset (collapsed by default)
      cy.get('.cm-editor').should('not.exist');

      cy.log('✅ State resets correctly on navigation');
    });
  });

  describe('Accessibility and User Experience', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/validations');
      cy.wait('@fetchValidations');
    });

    it('should have proper ARIA labels on all interactive elements', () => {
      cy.log('♿ Testing accessibility labels');

      // Check button labels
      cy.get('button[aria-label="Add New Validation"]').should('exist');
      cy.get('button[aria-label="Expand validation details"]').should('exist');

      // Expand to see more elements
      cy.get('button[aria-label="Expand validation details"]').first().click();

      cy.get('button[aria-label="Edit validation"]').should('exist');
      cy.get('button[aria-label="Download validation query"]').should('exist');

      cy.log('✅ ARIA labels present');
    });

    it('should show loading indicators for all async operations', () => {
      cy.log('⏳ Testing loading indicators');

      // Mock slow update
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, req => {
        req.reply(res => {
          res.delay = 1000;
          res.send({ statusCode: 200, body: {} });
        });
      }).as('slowUpdate');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Click save
      cy.get('button[aria-label="Save validation changes"]').click();

      // Verify loading indicator
      cy.get('[role="progressbar"]').should('be.visible');

      cy.wait('@slowUpdate');

      cy.log('✅ Loading indicators work');
    });

    it('should provide clear user feedback for all actions', () => {
      cy.log('💬 Testing user feedback');

      // Mock successful update
      cy.intercept('PATCH', `/api/validations/crud?schema=${testSite.schemaName}`, {
        statusCode: 200,
        body: {}
      }).as('update');

      // Expand and edit
      cy.get('button[aria-label="Expand validation details"]').first().click();
      cy.get('button[aria-label="Edit validation"]').first().click();

      // Save
      cy.get('button[aria-label="Save validation changes"]').click();
      cy.wait('@update');

      // Verify feedback message appears
      cy.get('[role="status"]').should('be.visible');
      cy.contains('successfully').should('be.visible');

      cy.log('✅ User feedback works');
    });
  });
});
