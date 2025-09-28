# Testing Authentication & Site/Plot Selection Flow

## Quick Start

To test the complete authentication and site/plot selection workflow, run:

```bash
npm run test:auth-flow
```

This single command will execute all tests for the core user action:
**Sign in → Select Site → Select Plot**

## What Gets Tested

### 🧪 **1. Unit & Integration Tests (Vitest)**

- Authentication logic and session management
- Site/plot selection state management
- User permission validation
- Data loading and error handling
- Business logic with realistic ForestGEO data

### 🎯 **2. Component Tests (Cypress)**

- Login/logout component functionality
- Site selection dropdown behavior
- Plot selection dropdown behavior
- User interface interactions
- Component state changes

### 🚀 **3. End-to-End Tests (Cypress)**

- Complete user workflows for different user types:
  - **Standard User**: Access to Luquillo + BCI
  - **Admin User**: Access to all ForestGEO sites
  - **Limited User**: Access to single site only
  - **New User**: No site access (pending approval)
- Full authentication flow
- Site and plot selection with realistic data
- Navigation to protected pages
- Error handling and edge cases

## Test Output

The command provides clear, color-coded output:

```
🧪 ForestGEO Authentication & Site/Plot Selection Flow Tests

📋 Test Plan:
  1. Vitest - Unit & Integration Tests (auth logic, site/plot selection)
  2. Cypress Component Tests (login component, site/plot dropdowns)
  3. Cypress E2E Tests (complete user workflows)

⏳ Running Vitest tests (auth logic & site/plot selection)...
✅ Running Vitest tests (auth logic & site/plot selection) - PASSED

⏳ Running Cypress component tests (login & selection components)...
✅ Running Cypress component tests (login & selection components) - PASSED

⏳ Running Cypress E2E tests (complete user workflows)...
✅ Running Cypress E2E tests (complete user workflows) - PASSED

📊 Test Results Summary:
───────────────────────────
✅ Unit & Integration Tests
✅ Component Tests
✅ End-to-End Tests

🎉 ALL TESTS PASSED!
✨ The authentication and site/plot selection workflow is working correctly.
Users can successfully:
  • Sign in to the application
  • Open and use the site selection dropdown
  • Select an assigned site
  • Open and use the plot selection dropdown
  • Select a plot and proceed with their work
```

## Individual Test Commands

If you need to run specific test types:

```bash
# Unit & Integration tests only
npm run test tests/auth-flow.test.tsx tests/site-plot-selection.test.tsx

# Component tests only
npm run com:headless -- --spec "cypress/components/auth-login.cy.tsx,cypress/components/site-plot-selection.cy.tsx"

# E2E tests only
npm run test:e2e:ci -- --spec "cypress/e2e/complete-auth-and-selection-flow.cy.ts"
```

## Test Data

All tests use **realistic ForestGEO data**:

- **Actual research sites**: Luquillo, BCI, Pasoh, Harvard Forest
- **Real plot dimensions**: 16-ha, 50-ha, 35-ha plots
- **Authentic user profiles**: Standard researcher, admin, limited access
- **Historical census data**: Multi-decade timelines

## When to Run This Test

Run `npm run test:auth-flow` whenever:

✅ **After structural changes** to authentication system
✅ **After modifying** site/plot selection logic
✅ **Before deploying** changes that affect user workflows
✅ **When adding new** ForestGEO sites or user types
✅ **As part of CI/CD** pipeline for core functionality

## Troubleshooting

### If tests fail:

1. Check the detailed output for specific error messages
2. Ensure dependencies are installed: `npm install`
3. Verify Node.js version compatibility
4. Run individual test suites to isolate issues

### Common issues:

- **Port conflicts**: Ensure port 3000 is available for E2E tests
- **Missing dependencies**: Run `npm install` to ensure all packages are present
- **Cypress binary**: May need `npx cypress install` if Cypress wasn't properly installed

---

**Result**: This comprehensive test suite ensures that the core user workflow remains functional after any code changes, using realistic ForestGEO data that works for any developer running the tests.
