/**
 * Validation Test Scenarios
 *
 * This file defines comprehensive test scenarios for each validation query.
 * Uses the test-data-factory to minimize boilerplate (70% code reduction).
 *
 * Each scenario only specifies what's different from the default setup.
 */

import { ValidationTestScenario } from './validation-test-framework';
import { createScenario, createScenarioWithCustomCensus, createScenarioWithNoSpecies, createScenarioWithPlotDimensions } from './test-data-factory';

/**
 * Validation 1: DBH Growth Exceeds Max (65mm/year)
 */
export const validation1Scenarios: ValidationTestScenario[] = [
  createScenario('Excessive DBH Growth', {
    description: 'Tree with DBH growth > 65mm between censuses should be flagged',
    treeTag: 'GROWTH_TEST_1',
    measurements: [
      { censusIndex: 0, dbh: 100, validated: true },
      { censusIndex: 1, dbh: 200, validated: false } // 100mm growth > 65mm limit
    ],
    expectedErrors: [
      {
        treeTag: 'GROWTH_TEST_1',
        condition: 'DBH growth 100mm exceeds max 65mm'
      }
    ]
  }),

  createScenario('Normal DBH Growth', {
    description: 'Tree with normal DBH growth should NOT be flagged',
    treeTag: 'NORMAL_GROWTH_1',
    measurements: [
      { censusIndex: 0, dbh: 100, validated: true },
      { censusIndex: 1, dbh: 150, validated: false } // 50mm growth < 65mm limit
    ],
    expectedNoErrors: [
      {
        treeTag: 'NORMAL_GROWTH_1',
        condition: 'Normal growth (50mm) should not be flagged'
      }
    ]
  })
];

/**
 * Validation 2: DBH Shrinkage Exceeds Max (5%)
 */
export const validation2Scenarios: ValidationTestScenario[] = [
  createScenario('Excessive DBH Shrinkage', {
    description: 'Tree with DBH shrinkage > 5% should be flagged',
    treeTag: 'SHRINK_TEST_1',
    measurements: [
      { censusIndex: 0, dbh: 200, validated: true },
      { censusIndex: 1, dbh: 180, validated: false } // 10% shrinkage > 5% limit
    ],
    expectedErrors: [
      {
        treeTag: 'SHRINK_TEST_1',
        condition: 'DBH shrinkage 10% exceeds max 5%'
      }
    ]
  })
];

/**
 * Validation 3: Invalid Species Codes
 */
export const validation3Scenarios: ValidationTestScenario[] = [
  createScenarioWithNoSpecies('Invalid Species Code', {
    description: 'Measurement with species not in species table should be flagged',
    treeTag: 'INVALID_SP_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    overrides: {
      trees: [
        {
          TreeTag: 'INVALID_SP_1',
          SpeciesID: 99999, // Non-existent species ID
          IsActive: true
        }
      ]
    },
    expectedErrors: [
      {
        treeTag: 'INVALID_SP_1',
        condition: 'Species ID 99999 does not exist in species table'
      }
    ]
  }),

  createScenario('Valid Species Code', {
    description: 'Measurement with valid species should NOT be flagged',
    treeTag: 'VALID_SP_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    expectedNoErrors: [
      {
        treeTag: 'VALID_SP_1',
        condition: 'Valid species should not be flagged'
      }
    ]
  })
];

/**
 * Validation 6: Measurement Date Outside Census Bounds
 */
export const validation6Scenarios: ValidationTestScenario[] = [
  createScenarioWithCustomCensus('Date Before Census Start', [2020], {
    description: 'Measurement dated before census start should be flagged',
    treeTag: 'DATE_EARLY_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2019-12-15'), // Before census start (2020-01-01)
        validated: false
      }
    ],
    expectedErrors: [
      {
        treeTag: 'DATE_EARLY_1',
        condition: 'Measurement date 2019-12-15 is before census start 2020-01-01'
      }
    ]
  }),

  createScenarioWithCustomCensus('Date After Census End', [2020], {
    description: 'Measurement dated after census end should be flagged',
    treeTag: 'DATE_LATE_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2021-01-15'), // After census end (2020-12-31)
        validated: false
      }
    ],
    expectedErrors: [
      {
        treeTag: 'DATE_LATE_1',
        condition: 'Measurement date 2021-01-15 is after census end 2020-12-31'
      }
    ]
  }),

  createScenarioWithCustomCensus('Date Within Census Bounds', [2020], {
    description: 'Measurement dated within census bounds should NOT be flagged',
    treeTag: 'DATE_OK_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 150,
        date: new Date('2020-06-15'), // Within bounds
        validated: false
      }
    ],
    expectedNoErrors: [
      {
        treeTag: 'DATE_OK_1',
        condition: 'Date within census bounds should not be flagged'
      }
    ]
  })
];

/**
 * Validation 8: Stems Outside Plot Boundaries
 */
export const validation8Scenarios: ValidationTestScenario[] = [
  createScenarioWithPlotDimensions('Stem X Coordinate Outside Plot', 100, 100, {
    description: 'Stem with X coordinate outside plot dimensions should be flagged',
    treeTag: 'OUT_OF_BOUNDS_X',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    overrides: {
      stems: [
        {
          StemTag: 'S1',
          LocalX: 200, // WAY outside plot (plot is 100x100)
          LocalY: 10,
          IsActive: true
        }
      ]
    },
    expectedErrors: [
      {
        treeTag: 'OUT_OF_BOUNDS_X',
        condition: 'Stem X coordinate 200 exceeds plot dimension 100'
      }
    ]
  }),

  createScenario('Stem Within Plot Boundaries', {
    description: 'Stem within plot boundaries should NOT be flagged',
    treeTag: 'IN_BOUNDS_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    overrides: {
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          DefaultDBHUnits: 'mm' as const,
          IsActive: true
        }
      ]
    },
    expectedNoErrors: [
      {
        treeTag: 'IN_BOUNDS_1',
        condition: 'Stem within plot bounds should not be flagged'
      }
    ]
  })
];

/**
 * Validation 8 Extended: Lower Bound Check (FIXED ✅)
 */
export const validation8ExtendedScenarios: ValidationTestScenario[] = [
  ...validation8Scenarios,
  createScenario('Negative X Coordinate - Should Flag', {
    description: 'Stem with negative X coordinate should be flagged',
    treeTag: 'NEGATIVE_X_STEM',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    overrides: {
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          DefaultDBHUnits: 'mm' as const,
          IsActive: true
        }
      ],
      quadrats: [
        {
          QuadratName: 'Q1',
          DimensionX: 20,
          DimensionY: 20,
          StartX: 10,
          StartY: 10,
          IsActive: true
        }
      ],
      stems: [
        {
          StemTag: 'S1',
          LocalX: -20, // -20 + 10 (quadrat) = -10 (OUTSIDE!)
          LocalY: 5,
          IsActive: true
        }
      ]
    },
    expectedErrors: [
      {
        treeTag: 'NEGATIVE_X_STEM',
        condition: 'Stem X coordinate -20 results in negative absolute position -10'
      }
    ]
  }),

  createScenario('Negative Y Coordinate - Should Flag', {
    description: 'Stem with negative Y coordinate should be flagged',
    treeTag: 'NEGATIVE_Y_STEM',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    overrides: {
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          DefaultDBHUnits: 'mm' as const,
          IsActive: true
        }
      ],
      quadrats: [
        {
          QuadratName: 'Q1',
          DimensionX: 20,
          DimensionY: 20,
          StartX: 5,
          StartY: 5,
          IsActive: true
        }
      ],
      stems: [
        {
          StemTag: 'S1',
          LocalX: 5,
          LocalY: -10, // -10 + 5 (quadrat) = -5 (OUTSIDE!)
          IsActive: true
        }
      ]
    },
    expectedErrors: [
      {
        treeTag: 'NEGATIVE_Y_STEM',
        condition: 'Stem Y coordinate -10 results in negative absolute position -5'
      }
    ]
  })
];

/**
 * Validation 11: Measured Diameter Min/Max (FIXED ✅)
 */
export const validation11Scenarios: ValidationTestScenario[] = [
  createScenario('DBH Below Species-Specific Minimum - Should Flag', {
    description: 'Measurement with DBH below species minimum should be flagged',
    treeTag: 'BELOW_SPECIES_MIN',
    measurements: [
      {
        censusIndex: 0,
        dbh: 5, // Below species minimum of 10mm
        validated: false
      }
    ],
    overrides: {
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 10, UpperBound: 500, IsActive: true }]
    },
    expectedErrors: [
      {
        treeTag: 'BELOW_SPECIES_MIN',
        condition: 'DBH 5mm below species-specific minimum of 10mm'
      }
    ]
  }),

  createScenario('DBH Above Species-Specific Maximum - Should Flag', {
    description: 'Measurement with DBH above species maximum should be flagged',
    treeTag: 'ABOVE_SPECIES_MAX',
    measurements: [
      {
        censusIndex: 0,
        dbh: 1000, // Above species maximum of 500mm
        validated: false
      }
    ],
    overrides: {
      species: [{ SpeciesCode: 'SMALL_SP', SpeciesName: 'Small Species', IsActive: true }],
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 5, UpperBound: 500, IsActive: true }]
    },
    expectedErrors: [
      {
        treeTag: 'ABOVE_SPECIES_MAX',
        condition: 'DBH 1000mm above species-specific maximum of 500mm'
      }
    ]
  }),

  createScenario('DBH Within Species-Specific Bounds - Should Not Flag', {
    description: 'DBH within species-specific bounds should NOT be flagged',
    treeTag: 'WITHIN_BOUNDS',
    measurements: [
      {
        censusIndex: 0,
        dbh: 250, // Within species bounds (10-500mm)
        validated: false
      }
    ],
    overrides: {
      species: [
        {
          SpeciesCode: 'NORMAL_SP',
          SpeciesName: 'Normal Species',
          IsActive: true
        }
      ],
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 10, UpperBound: 500, IsActive: true }]
    },
    expectedNoErrors: [
      {
        treeTag: 'WITHIN_BOUNDS',
        condition: 'DBH within species-specific bounds should not be flagged'
      }
    ]
  })
];

/**
 * Validation 14: Invalid Attribute Codes
 */
export const validation14Scenarios: ValidationTestScenario[] = [
  createScenarioWithCustomCensus('Invalid Attribute Code', [2020], {
    description: 'Measurement with attribute code not in attributes table should be flagged',
    treeTag: 'INVALID_ATTR_1',
    measurements: [{ censusIndex: 0, dbh: 150, attribute: 'MX', validated: false }],
    overrides: {
      attributes: [] // No attributes defined - 'MX' won't exist
    },
    expectedErrors: [
      {
        treeTag: 'INVALID_ATTR_1',
        condition: 'Attribute code MX does not exist in attributes table'
      }
    ]
  }),

  createScenarioWithCustomCensus('Valid Attribute Code', [2020], {
    description: 'Measurement with valid attribute code should NOT be flagged',
    treeTag: 'VALID_ATTR_1',
    measurements: [{ censusIndex: 0, dbh: 150, validated: false }],
    expectedNoErrors: [
      {
        treeTag: 'VALID_ATTR_1',
        condition: 'Valid attribute code should not be flagged'
      }
    ]
  })
];

/**
 * Validation 15: Abnormally High DBH
 */
export const validation15Scenarios: ValidationTestScenario[] = [
  createScenarioWithCustomCensus('Abnormally High DBH (26600mm)', [2020], {
    description: 'Measurement with DBH >= 3500mm should be flagged (Bug: Tag=011379 with dbh=26600)',
    treeTag: 'HIGH_DBH_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 26600, // From bug report
        validated: false
      }
    ],
    expectedErrors: [
      {
        treeTag: 'HIGH_DBH_1',
        condition: 'DBH 26600mm exceeds max threshold 3500mm'
      }
    ]
  }),

  createScenarioWithCustomCensus('DBH At Threshold', [2020], {
    description: 'Measurement with DBH exactly at 3500mm should be flagged',
    treeTag: 'THRESHOLD_DBH_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 3500, // Exactly at threshold
        validated: false
      }
    ],
    expectedErrors: [
      {
        treeTag: 'THRESHOLD_DBH_1',
        condition: 'DBH 3500mm meets or exceeds threshold'
      }
    ]
  }),

  createScenarioWithCustomCensus('Normal DBH', [2020], {
    description: 'Measurement with normal DBH should NOT be flagged',
    treeTag: 'NORMAL_DBH_1',
    measurements: [
      {
        censusIndex: 0,
        dbh: 350, // Normal DBH
        validated: false
      }
    ],
    expectedNoErrors: [
      {
        treeTag: 'NORMAL_DBH_1',
        condition: 'Normal DBH 350mm should not be flagged'
      }
    ]
  })
];

/**
 * Validation 7: Stems in Tree with Different Species (BROKEN)
 *
 * ⚠️ THIS VALIDATION IS BROKEN - Tests will FAIL until query is fixed
 *
 * Issue: The query checks if trees have stems with different species, but species
 * is defined at the TREE level, not the STEM level. All stems in a tree will always
 * have the same species. The query joins stems to trees and gets SpeciesID from the
 * tree, then counts distinct species codes per tree - this count will ALWAYS be 1.
 *
 * Expected: These tests should FAIL with current implementation
 * After Fix: Tests should PASS
 */
export const validation7Scenarios: ValidationTestScenario[] = [
  createScenarioWithCustomCensus('BROKEN QUERY TEST - Tree Stems with Same Species (will fail)', [2020], {
    description: 'EXPECTED TO FAIL: Current query cannot detect different species because species is at tree level',
    treeTag: 'MULTI_SPECIES_TREE',
    measurements: [
      { censusIndex: 0, dbh: 150, validated: false },
      { censusIndex: 0, dbh: 160, validated: false }
    ],
    overrides: {
      species: [
        { SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true },
        { SpeciesCode: 'QURU', SpeciesName: 'Quercus rubra', IsActive: true }
      ],
      stems: [
        { StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true },
        { StemTag: 'S2', LocalX: 11, LocalY: 11, IsActive: true }
      ]
    },
    expectedErrors: [
      {
        treeTag: 'MULTI_SPECIES_TREE',
        condition: 'Tree has stems with different species (IMPOSSIBLE IN CURRENT MODEL)'
      }
    ]
  })
];

// Export all scenarios organized by validation ID
export const allValidationScenarios: Map<number, ValidationTestScenario[]> = new Map([
  [1, validation1Scenarios],
  [2, validation2Scenarios],
  [3, validation3Scenarios],
  [6, validation6Scenarios],
  [7, validation7Scenarios], // BROKEN - Expected to fail
  [8, validation8ExtendedScenarios],
  [11, validation11Scenarios],
  [14, validation14Scenarios],
  [15, validation15Scenarios]
]);
