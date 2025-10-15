# Test Commands Consolidation Plan

## Current State (21 commands)
```
test, test:unit (duplicate), test:unit:watch, test:component, test:component:open,
test:e2e, test:e2e:open, test:e2e:prod, test:all, test:ci, test:deployment,
test:responsive, test:responsive:dev, test:responsive:ci, test:auth-flow,
test:auto, test:validations, test:validations:watch, test:coverage,
test:coverage:ui, test:coverage:watch
```

## Proposed Consolidation (13 commands)

### Category 1: Core Unit Tests (3 commands)
```json
"test": "vitest run",                    // Run all unit tests once
"test:watch": "vitest",                  // Watch mode (renamed from test:unit:watch)
"test:coverage": "vitest run --coverage" // Run with coverage report
```

**Removed:**
- `test:unit` - DUPLICATE of `test`
- `test:coverage:ui` - Rarely used, can be run manually: `npx vitest --coverage --ui`
- `test:coverage:watch` - Rarely used, can use `test:watch` for dev

### Category 2: Component & E2E Tests (4 commands)
```json
"test:component": "cypress run --component",
"test:cypress": "cypress open",          // Consolidated from test:component:open + test:e2e:open
"test:e2e": "start-server-and-test dev http://localhost:3000 \"cypress run --e2e\"",
"test:e2e:prod": "start-server-and-test start http://localhost:3000 \"cypress run --e2e\""
```

**Removed:**
- `test:component:open` - Replaced by generic `test:cypress`
- `test:e2e:open` - Replaced by generic `test:cypress`

### Category 3: CI/Deployment (3 commands)
```json
"test:ci": "npm run test && npm run test:component",
"test:deployment": "npm run lint && npm run test:ci",
"test:all": "npm run test && npm run test:component && npm run test:e2e"
```

**Note:** Updated to use consolidated command names

### Category 4: Specialized Tests (3 commands)
```json
"test:validations": "vitest run tests/validation-framework",
"test:responsive": "cypress run --config-file cypress.ci.config.cjs --spec 'cypress/e2e/responsive/*.cy.ts'",
"test:auth": "node scripts/test-auth-flow.mjs"
```

**Removed:**
- `test:validations:watch` - Can use: `npx vitest watch tests/validation-framework`
- `test:responsive:dev` - Can use: `test:cypress` with manual file selection
- `test:responsive:ci` - Merged into simplified `test:responsive`
- `test:auto` - Unclear purpose, evaluate if needed

## Summary
- **Before:** 21 commands
- **After:** 13 commands
- **Reduction:** 38% fewer commands

## Benefits
1. ✅ Eliminates duplicates (`test` vs `test:unit`)
2. ✅ Consolidates interactive modes into single `test:cypress`
3. ✅ Removes rarely-used coverage variants
4. ✅ Simplifies specialized test commands
5. ✅ Maintains all essential functionality
6. ✅ Clearer, more intuitive naming

## Advanced Usage (For Power Users)
Users can still run removed commands manually:
```bash
npx vitest --coverage --ui              # Instead of test:coverage:ui
npx vitest watch --coverage             # Instead of test:coverage:watch
npx vitest watch tests/validation-framework  # Instead of test:validations:watch
cypress open --component                # Instead of test:component:open
```
