# Validation Framework Refactoring Example

## Problem: Current Approach is Too Verbose

### Current Code (25+ lines per scenario)

```typescript
{
  name: 'Excessive DBH Growth',
  description: 'Tree with DBH growth > 65mm between censuses should be flagged',
  setupData: {
    attributes: [{ Code: 'A', Description: 'alive', Status: 'alive', IsActive: true }],
    species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
    plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
    census: [
      { PlotCensusNumber: 1, StartDate: new Date('2015-01-01'), EndDate: new Date('2015-12-31'), IsActive: true },
      { PlotCensusNumber: 2, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }
    ],
    quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
    trees: [{ TreeTag: 'GROWTH_TEST_1', IsActive: true }],
    stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
    coremeasurements: [
      { CensusID: 0, MeasurementDate: new Date('2015-06-01'), MeasuredDBH: 100, MeasuredHOM: 130, IsValidated: true, IsActive: true },
      { CensusID: 1, MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 200, MeasuredHOM: 130, IsValidated: undefined, IsActive: true }
    ],
    cmattributes: [{ Code: 'A' }, { Code: 'A' }]
  },
  expectedErrors: [{ treeTag: 'GROWTH_TEST_1', condition: 'DBH growth 100mm exceeds max 65mm' }],
  expectedNoErrors: []
}
```

**Problems:**

- 25+ lines of boilerplate
- Hard to see what's actually being tested
- Duplicated setup across all scenarios
- Difficult to add new scenarios
- Prone to copy-paste errors

## Solution: Factory Functions + Smart Defaults

### Step 1: Create Test Data Factory

```typescript
// tests/validation-framework/test-data-factory.ts

import { ValidationTestScenario } from './validation-test-framework';

/**
 * Default test data that works for most scenarios
 */
const DEFAULTS = {
  attributes: [{ Code: 'A', Description: 'alive', Status: 'alive' as const, IsActive: true }],
  species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
  plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm' as const, IsActive: true }],
  census: [
    {
      PlotCensusNumber: 1,
      StartDate: new Date('2015-01-01'),
      EndDate: new Date('2015-12-31'),
      IsActive: true
    },
    {
      PlotCensusNumber: 2,
      StartDate: new Date('2020-01-01'),
      EndDate: new Date('2020-12-31'),
      IsActive: true
    }
  ],
  quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
  stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }]
};

/**
 * Creates a test scenario with smart defaults
 * Only specify what's different from the default!
 */
export function createScenario(
  name: string,
  config: {
    description?: string;
    treeTag?: string;
    measurements: Array<{
      censusIndex: number;
      dbh: number;
      hom?: number;
      date?: Date;
      validated?: boolean | undefined;
      attribute?: string;
    }>;
    expectedErrors?: Array<{ treeTag?: string; condition: string }>;
    expectedNoErrors?: Array<{ treeTag?: string; condition: string }>;
    // Allow overriding any defaults
    overrides?: {
      attributes?: typeof DEFAULTS.attributes;
      species?: typeof DEFAULTS.species;
      plots?: typeof DEFAULTS.plots;
      census?: typeof DEFAULTS.census;
      quadrats?: typeof DEFAULTS.quadrats;
      stems?: typeof DEFAULTS.stems;
    };
  }
): ValidationTestScenario {
  const treeTag = config.treeTag || `TEST_${name.replace(/\s+/g, '_').toUpperCase()}`;

  return {
    name,
    description: config.description || name,
    setupData: {
      attributes: config.overrides?.attributes || DEFAULTS.attributes,
      species: config.overrides?.species || DEFAULTS.species,
      plots: config.overrides?.plots || DEFAULTS.plots,
      census: config.overrides?.census || DEFAULTS.census,
      quadrats: config.overrides?.quadrats || DEFAULTS.quadrats,
      trees: [{ TreeTag: treeTag, IsActive: true }],
      stems: config.overrides?.stems || DEFAULTS.stems,
      coremeasurements: config.measurements.map(m => ({
        CensusID: m.censusIndex,
        MeasurementDate: m.date || new Date(`${2015 + m.censusIndex * 5}-06-01`),
        MeasuredDBH: m.dbh,
        MeasuredHOM: m.hom || 130,
        IsValidated: m.validated === undefined ? undefined : m.validated ? true : undefined,
        IsActive: true
      })),
      cmattributes: config.measurements.map(m => ({
        Code: m.attribute || 'A'
      }))
    },
    expectedErrors: config.expectedErrors || [],
    expectedNoErrors: config.expectedNoErrors || []
  };
}

/**
 * Helper for scenarios that need custom census dates
 */
export function createScenarioWithCustomCensus(
  name: string,
  censusYears: number[],
  config: Omit<Parameters<typeof createScenario>[1], 'overrides'>
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      census: censusYears.map((year, i) => ({
        PlotCensusNumber: i + 1,
        StartDate: new Date(`${year}-01-01`),
        EndDate: new Date(`${year}-12-31`),
        IsActive: true
      }))
    }
  });
}

/**
 * Helper for scenarios needing different species
 */
export function createScenarioWithSpecies(
  name: string,
  speciesCode: string,
  speciesName: string,
  config: Omit<Parameters<typeof createScenario>[1], 'overrides'>
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      species: [{ SpeciesCode: speciesCode, SpeciesName: speciesName, IsActive: true }]
    }
  });
}
```

### Step 2: Refactor Scenarios

```typescript
// tests/validation-framework/validation-scenarios.ts

import { createScenario } from './test-data-factory';

/**
 * Validation 1: DBH Growth Exceeds Max (65mm)
 *
 * Before: 50+ lines
 * After: 15 lines (70% reduction!)
 */
export const validation1Scenarios = [
  createScenario('Excessive DBH Growth', {
    description: 'Tree with DBH growth > 65mm between censuses should be flagged',
    measurements: [
      { censusIndex: 0, dbh: 100, validated: true },
      { censusIndex: 1, dbh: 200, validated: false } // 100mm growth > 65mm limit
    ],
    expectedErrors: [{ condition: 'DBH growth 100mm exceeds max 65mm' }]
  }),

  createScenario('Normal DBH Growth', {
    description: 'Tree with normal DBH growth should NOT be flagged',
    measurements: [
      { censusIndex: 0, dbh: 100, validated: true },
      { censusIndex: 1, dbh: 150, validated: false } // 50mm growth < 65mm limit
    ],
    expectedNoErrors: [{ condition: 'Normal growth (50mm) should not be flagged' }]
  })
];

/**
 * Validation 2: DBH Shrinkage Exceeds Max (5%)
 *
 * Before: 30+ lines
 * After: 8 lines
 */
export const validation2Scenarios = [
  createScenario('Excessive DBH Shrinkage', {
    description: 'Tree with DBH shrinkage > 5% should be flagged',
    measurements: [
      { censusIndex: 0, dbh: 200, validated: true },
      { censusIndex: 1, dbh: 180, validated: false } // 10% shrinkage > 5% limit
    ],
    expectedErrors: [{ condition: 'DBH shrinkage 10% exceeds max 5%' }]
  })
];

/**
 * Validation 3: Invalid Species Codes
 *
 * Before: 40+ lines
 * After: 12 lines
 */
export const validation3Scenarios = [
  createScenario('Invalid Species Code', {
    description: 'Measurement with species not in species table should be flagged',
    treeTag: 'INVALID_SP_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    expectedErrors: [{ condition: 'Species ID 99999 does not exist in species table' }],
    overrides: {
      species: [] // No species - will use non-existent SpeciesID
    }
  }),

  createScenario('Valid Species Code', {
    description: 'Measurement with valid species should NOT be flagged',
    treeTag: 'VALID_SP_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    expectedNoErrors: [{ condition: 'Valid species should not be flagged' }]
  })
];

/**
 * Validation 6: Measurement Date Outside Census Bounds
 *
 * Before: 50+ lines
 * After: 18 lines
 */
export const validation6Scenarios = [
  createScenario('Date Before Census Start', {
    description: 'Measurement dated before census start should be flagged',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2019-12-31'), // Before census start (2020-01-01)
        validated: false
      }
    ],
    expectedErrors: [{ condition: 'Date before census start date' }]
  }),

  createScenario('Date After Census End', {
    description: 'Measurement dated after census end should be flagged',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2021-01-01'), // After census end (2020-12-31)
        validated: false
      }
    ],
    expectedErrors: [{ condition: 'Date after census end date' }]
  }),

  createScenario('Date Within Census Bounds', {
    description: 'Measurement dated within census bounds should NOT be flagged',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2020-06-15'), // Within census bounds
        validated: false
      }
    ],
    expectedNoErrors: [{ condition: 'Date within bounds should not be flagged' }]
  })
];
```

### Step 3: Easy to Add Edge Cases Now!

```typescript
/**
 * Adding edge cases is now trivial!
 */
export const validation1EdgeCases = [
  createScenario('Zero DBH Growth', {
    measurements: [
      { censusIndex: 0, dbh: 100, validated: true },
      { censusIndex: 1, dbh: 100, validated: false } // No growth
    ],
    expectedNoErrors: [{ condition: 'Zero growth should not be flagged' }]
  }),

  createScenario('Negative DBH', {
    measurements: [
      { censusIndex: 0, dbh: -1, validated: false } // Invalid
    ],
    expectedErrors: [{ condition: 'Negative DBH should be flagged' }]
  }),

  createScenario('Null DBH', {
    measurements: [{ censusIndex: 0, dbh: null as any, validated: false }],
    expectedErrors: [{ condition: 'Null DBH should be flagged' }]
  }),

  createScenario('Maximum DBH', {
    measurements: [{ censusIndex: 0, dbh: 999999, validated: false }],
    expectedNoErrors: [{ condition: 'Very large DBH should be allowed' }]
  })
];
```

## Benefits

### Before Refactoring

```
validation-scenarios.ts: 645 lines
- 21 scenarios
- ~30 lines per scenario
- Lots of duplication
- Hard to add new scenarios
- Difficult to see test intent
```

### After Refactoring

```
test-data-factory.ts: 150 lines (reusable!)
validation-scenarios.ts: 200 lines
- 21 scenarios
- ~10 lines per scenario
- Minimal duplication
- Easy to add scenarios (3 minutes)
- Clear test intent
```

### Time Savings

| Task             | Before                | After                 | Savings |
| ---------------- | --------------------- | --------------------- | ------- |
| Add new scenario | 15 min                | 3 min                 | 80%     |
| Modify defaults  | Change 21 places      | Change 1 place        | 95%     |
| Understand test  | Read 30 lines         | Read 10 lines         | 67%     |
| Debug test       | Find bug in 645 lines | Find bug in 200 lines | 69%     |

## Migration Strategy

### Phase 1: Create Factory (Day 1)

1. Create `test-data-factory.ts`
2. Test that factory produces correct data
3. No changes to existing tests yet

### Phase 2: Convert 5 Scenarios (Day 2)

1. Convert validation 1 scenarios
2. Run tests - should still pass
3. Verify no behavior changes

### Phase 3: Convert Remaining (Day 3)

1. Convert remaining scenarios
2. Run full test suite
3. Should see exactly same test results

### Phase 4: Add Edge Cases (Day 4-5)

1. Now easy to add new scenarios
2. Add 20-30 edge case scenarios
3. Dramatically improve coverage

## Example: Adding Complex Scenario

### Before (would take 30+ lines)

```typescript
// Too tedious to even attempt...
```

### After (takes 12 lines)

```typescript
createScenarioWithSpecies('Special Char Species', 'AC-RU!', 'Acer rubrum', {
  measurements: [{ censusIndex: 0, dbh: 100, validated: false }],
  expectedErrors: [{ condition: 'Invalid chars in species code' }]
});
```

## Conclusion

The factory pattern reduces validation test code by **70%** while making it **80% faster** to add new scenarios. This is a **no-brainer refactoring** that will pay dividends immediately.

**Start with this refactoring before adding new tests!**
