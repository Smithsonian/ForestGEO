# Responsive Design Testing Framework

This document describes the comprehensive responsive design testing framework implemented for the ForestGEO application.

## Overview

The responsive testing framework provides automated testing across multiple devices, screen sizes, and browsers to ensure a consistent user experience on all platforms.

## Framework Components

### 1. Device Configurations (`cypress/support/responsive-commands.ts`)

#### Standard Test Devices

- **Mobile**: iPhone SE, iPhone 12 Pro/Max, Samsung Galaxy S21
- **Tablets**: iPad, iPad Pro 11", iPad Pro 12.9"
- **Desktop**: Laptop (1366x768), Standard (1920x1080), Large (2560x1440)

#### MUI Breakpoint Testing

- `xs`: 0-599px (mobile)
- `sm`: 600-899px (tablet portrait)
- `md`: 900-1199px (tablet landscape/small desktop)
- `lg`: 1200-1535px (desktop)
- `xl`: 1536px+ (large desktop)

### 2. Custom Cypress Commands

```typescript
// Set specific device viewport
cy.setDeviceViewport(device);

// Test across multiple devices
cy.testAcrossDevices(devices, testFunction);

// Test responsive breakpoints
cy.testBreakpoints(breakpoints, testFunction);

// Check touch accessibility (44px minimum)
cy.checkTouchAccessibility(selector);

// Verify modal responsiveness
cy.checkModalResponsiveness(modalSelector);

// Check table responsiveness and scrolling
cy.checkTableResponsiveness(tableSelector);

// Take screenshots across all devices
cy.takeResponsiveScreenshots(name, devices);
```

### 3. Test Suites

#### Modal Responsiveness Tests

- **File**: `cypress/e2e/responsive/modal-responsiveness.cy.ts`
- **Coverage**: Failed Measurements Modal, Upload Modals, General Modal Patterns
- **Tests**:
  - Modal sizing across devices
  - Touch accessibility
  - Content overflow handling
  - Button layout responsiveness

#### Table Responsiveness Tests

- **File**: `cypress/e2e/responsive/table-responsiveness.cy.ts`
- **Coverage**: Data Grids, File Preview Tables, Failed Measurements Tables
- **Tests**:
  - Horizontal scrolling behavior
  - Column visibility management
  - Touch targets for interactive elements
  - Pagination controls

#### Upload System Tests

- **File**: `cypress/e2e/responsive/upload-system-responsiveness.cy.ts`
- **Coverage**: Upload Interface, Progress Display, File Preview
- **Tests**:
  - Layout adaptation (vertical/horizontal stacking)
  - Progress bar responsiveness
  - File list management
  - Error state handling

#### Visual Regression Tests

- **File**: `cypress/e2e/responsive/visual-regression.cy.ts`
- **Coverage**: Screenshot comparison across devices
- **Tests**:
  - Page layout screenshots
  - Component state screenshots
  - Accessibility mode screenshots
  - Performance state screenshots

## Usage Instructions

### Prerequisites

1. Ensure the application is running locally:

   ```bash
   npm run dev
   ```

2. Install required browsers:
   - Chrome (stable/beta)
   - Firefox
   - Microsoft Edge

### Running Tests

#### Quick Start

```bash
# Run all responsive tests (headless)
npm run test:responsive

# Run tests with browser UI (for debugging)
npm run test:responsive:headed

# Open Cypress UI for responsive tests
npm run cy:responsive
```

#### Browser-Specific Testing

```bash
# Test only in Chrome
npm run test:responsive:chrome

# Test only in Firefox
npm run test:responsive:firefox
```

#### Test-Type-Specific Testing

```bash
# Test only modals
npm run test:responsive:modal

# Test only tables
npm run test:responsive:table

# Test only upload system
npm run test:responsive:upload

# Test only visual regression
npm run test:responsive:visual
```

#### Advanced Usage

```bash
# Run specific browser and test type
node scripts/run-responsive-tests.js --browser chrome --test modal

# Run in headed mode for debugging
node scripts/run-responsive-tests.js --headed --browser firefox
```

### Cross-Browser Testing

The framework supports testing across multiple browsers with specific configurations:

- **Chrome**: Touch events enabled, mobile simulation
- **Firefox**: Viewport and pixel ratio settings
- **Edge**: Chromium-based configuration
- **Safari**: (Requires macOS and Safari installation)

### Test Results and Reports

#### Output Locations

- **Screenshots**: `cypress/screenshots/responsive/`
- **Videos**: `cypress/videos/responsive/`
- **Reports**: `cypress/results/`

#### Report Types

- **JSON Report**: `cypress/results/responsive-test-report.json`
- **HTML Report**: `cypress/results/responsive-test-report.html`

#### Sample HTML Report Features

- Success rate overview
- Browser compatibility matrix
- Test type breakdown
- Detailed failure information
- Screenshot gallery links

### Test Data Attributes

To ensure tests work correctly, add these data attributes to your components:

```tsx
// Modals
<ModalDialog data-testid="failed-measurements-modal">

// Buttons
<Button data-testid="clear-failed-button">
<Button data-testid="reingest-button">

// Tables
<Table data-testid="measurements-table">
<div data-testid="table-container">

// Upload Components
<div data-testid="upload-container">
<div data-testid="file-dropzone">
<div data-testid="upload-progress-container">

// Loading States
<div data-testid="loading-indicator">
<div data-testid="error-message">
<div data-testid="empty-state">
```

## Best Practices

### 1. Writing Responsive Tests

- Always wait for layout transitions (`cy.wait(500)`)
- Test critical breakpoints (599px, 600px, 899px, 900px, 1199px, 1200px)
- Verify touch targets are at least 44px
- Check for horizontal scrolling issues
- Test both portrait and landscape orientations

### 2. Device Selection

- Include at least one small mobile device (320-375px)
- Include at least one tablet (768-1024px)
- Include at least one desktop (1200px+)
- Test both touch and non-touch devices

### 3. Performance Considerations

- Use device subsets for CI/CD (5-6 key devices)
- Run full device suite nightly
- Parallelize tests across browsers when possible
- Use `cy.intercept()` to mock slow APIs during testing

### 4. Visual Regression

- Take screenshots after layout has settled
- Use consistent naming conventions
- Compare screenshots between releases
- Set up baseline screenshots in CI/CD

## Troubleshooting

### Common Issues

#### Tests Timing Out

```bash
# Increase timeout in cypress.responsive.config.cjs
defaultCommandTimeout: 15000
```

#### Layout Not Settling

```typescript
// Add wait time after viewport changes
cy.viewport(width, height);
cy.wait(500); // Allow CSS transitions
```

#### Touch Events Not Working

```typescript
// Ensure touch device simulation
cy.setDeviceViewport({
  ...device,
  hasTouch: true
});
```

#### Screenshots Not Capturing Correctly

```typescript
// Ensure full page load before screenshot
cy.get('[data-testid="main-content"]').should('be.visible');
cy.wait(2000);
cy.takeResponsiveScreenshots('test-name');
```

### Debug Mode

Run tests in headed mode to see what's happening:

```bash
npm run test:responsive:headed
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Responsive Tests

on: [push, pull_request]

jobs:
  responsive-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Start application
        run: npm run build && npm run start &
      - name: Wait for server
        run: npx wait-on http://localhost:3000
      - name: Run responsive tests
        run: npm run test:responsive
      - name: Upload test results
        uses: actions/upload-artifact@v2
        with:
          name: responsive-test-results
          path: |
            cypress/screenshots/responsive/
            cypress/results/
```

## Maintenance

### Regular Tasks

1. **Update Device List**: Add new popular devices quarterly
2. **Review Breakpoints**: Adjust based on analytics data
3. **Update Screenshots**: Refresh baseline images after design changes
4. **Performance Testing**: Monitor test execution times

### When to Update Tests

- After major UI changes
- When adding new responsive breakpoints
- After browser updates
- When user analytics show new popular devices

## Support

For issues with the responsive testing framework:

1. Check the troubleshooting section above
2. Review test logs in `cypress/results/`
3. Run tests in headed mode for debugging
4. Check browser console for JavaScript errors

## Contributing

When adding new responsive tests:

1. Follow the existing naming conventions
2. Add appropriate data-testids to components
3. Test across all target devices
4. Update this documentation
5. Add visual regression screenshots for new components
