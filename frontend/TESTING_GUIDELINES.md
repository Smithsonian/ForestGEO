# Testing Guidelines for ForestGEO Frontend

## Overview

This document outlines the automated testing process established to ensure tests remain in sync with code changes when
using Claude Code or making manual modifications.

## Automated Test Checking Process

### 1. Automatic Test Discovery

When files are modified, the system automatically:

- Identifies changed files using git diff
- Searches for associated test files using common naming patterns:
  - `{filename}.test.{ts,tsx,js,jsx}`
  - `{filename}.spec.{ts,tsx,js,jsx}`
  - Tests in `__tests__/` subdirectories
- Maps source files to their corresponding test files

### 2. Running the Auto Test Check

```bash
# Run automatic test checking
npm run test:auto

# Run full test suite
npm test
```

The auto test check script (`scripts/auto-test-check.js`) will:

1. Find recently modified files from git
2. Locate associated test files
3. Run only the relevant tests
4. Report results and any failures

### 3. When Files Don't Have Tests

If modified files don't have associated tests, the script will:

- Report "No test files found for modified files"
- This is acceptable for files that don't require testing (e.g., configuration, styles)

## Test File Structure

### Component Tests

- Location: Same directory as component or in `__tests__/` subdirectory
- Naming: `{componentname}.test.{ts,tsx}`
- Framework: Vitest with React Testing Library

### API Route Tests

- Location: Same directory as API route
- Naming: `route.test.ts`
- Framework: Vitest with mocked dependencies

### Utility Function Tests

- Location: Same directory as utility or in `__tests__/` subdirectory
- Naming: `{filename}.test.ts`
- Framework: Vitest

## Best Practices

### 1. Test Maintenance

- **Update tests immediately** when changing component interfaces
- **Add new tests** when creating new components with testable logic
- **Remove obsolete tests** when deleting components

### 2. Test Quality

- Mock external dependencies (databases, APIs, file systems)
- Test both success and failure scenarios
- Use descriptive test names that explain the behavior being tested
- Group related tests using `describe` blocks

### 3. Test Coverage

- Focus on testing public interfaces and critical business logic
- Don't test implementation details that may change
- Include edge cases and error conditions

## Example Test Structure

```typescript
/**
 * @fileoverview Unit tests for ComponentName
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ComponentName } from './ComponentName';

// Mock dependencies
vi.mock('external-dependency');

describe('ComponentName', () => {
  beforeEach(() => {
    // Setup common test conditions
  });

  describe('main functionality', () => {
    it('should handle success case', () => {
      // Test implementation
    });

    it('should handle error case', () => {
      // Test implementation
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      // Test implementation
    });
  });
});
```

## Integration with Development Workflow

### For Claude Code Users

The automated test checking is built into the development process. When Claude Code makes changes:

1. **Automatic Detection**: Modified files are detected via git
2. **Test Discovery**: Associated test files are found automatically
3. **Test Execution**: Relevant tests are run
4. **Failure Handling**: Test failures are reported with guidance for fixes

### For Manual Development

Developers should run the auto test check after making changes:

```bash
# After making changes, before committing
npm run test:auto

# If tests fail, fix them and run again
npm test -- --watch  # For interactive testing during development
```

## Common Test Scenarios

### 1. Adding New Components

When creating new components with complex logic:

```bash
# Create the component
touch components/new-component.tsx

# Create the test file
touch components/new-component.test.tsx

# The auto-test system will find and run the test automatically
```

### 2. Modifying Existing Components

When changing component interfaces or behavior:

1. Modify the component
2. Run `npm run test:auto` to check affected tests
3. Update tests if they fail due to interface changes
4. Ensure new behavior is properly tested

### 3. Refactoring

When refactoring without changing public interfaces:

1. Make the refactoring changes
2. Run `npm run test:auto` to ensure tests still pass
3. If tests fail, investigate whether the refactoring broke functionality

## Troubleshooting

### Tests Not Found

If the auto-test system doesn't find tests for your files:

- Check that test files follow naming conventions
- Ensure tests are in the same directory or `__tests__/` subdirectory
- Verify file extensions match (`.test.ts`, `.test.tsx`, etc.)

### Tests Failing After Changes

If tests fail after making changes:

1. **Interface Changes**: Update test mocks and expectations
2. **Behavior Changes**: Update test assertions to match new behavior
3. **Breaking Changes**: Add new tests for new functionality
4. **Dependency Changes**: Update mocked dependencies

### Performance Issues

If the test suite becomes slow:

- Use `npm run test:auto` instead of full test suite during development
- Consider splitting large test files
- Mock expensive operations (database calls, file I/O)

## Continuous Integration

The testing system integrates with CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Automatic Test Check
  run: npm run test:auto

- name: Run Full Test Suite
  run: npm test -- --run
```

This ensures that:

- All relevant tests run for changed files
- New code doesn't break existing functionality
- Test coverage remains comprehensive
