/**
 * Validation Test Scenarios
 *
 * This file defines comprehensive test scenarios for each validation query.
 * Each scenario includes:
 * - Test data setup
 * - Expected errors
 * - Expected non-errors (false positive checks)
 */

import { ValidationTestScenario } from './validation-test-framework';

/**
 * Validation 1: DBH Growth Exceeds Max (65mm/year)
 */
export const validation1Scenarios: ValidationTestScenario[] = [
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
        // Census 1: DBH = 100mm (CensusID: 0 means first census in array)
        { CensusID: 0, MeasurementDate: new Date('2015-06-01'), MeasuredDBH: 100, MeasuredHOM: 130, IsValidated: true, IsActive: true },
        // Census 2: DBH = 200mm (CensusID: 1 means second census in array - growth of 100mm > 65mm limit)
        { CensusID: 1, MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 200, MeasuredHOM: 130, IsValidated: undefined, IsActive: true }
      ],
      cmattributes: [{ Code: 'A' }, { Code: 'A' }]
    },
    expectedErrors: [{ treeTag: 'GROWTH_TEST_1', condition: 'DBH growth 100mm exceeds max 65mm' }],
    expectedNoErrors: []
  },
  {
    name: 'Normal DBH Growth',
    description: 'Tree with normal DBH growth should NOT be flagged',
    setupData: {
      attributes: [{ Code: 'A', Description: 'alive', Status: 'alive', IsActive: true }],
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [
        { PlotCensusNumber: 1, StartDate: new Date('2015-01-01'), EndDate: new Date('2015-12-31'), IsActive: true },
        { PlotCensusNumber: 2, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }
      ],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'NORMAL_GROWTH_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        { CensusID: 0, MeasurementDate: new Date('2015-06-01'), MeasuredDBH: 100, MeasuredHOM: 130, IsValidated: true, IsActive: true },
        { CensusID: 1, MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, MeasuredHOM: 130, IsValidated: undefined, IsActive: true }
      ],
      cmattributes: [{ Code: 'A' }, { Code: 'A' }]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'NORMAL_GROWTH_1', condition: 'Normal growth (50mm) should not be flagged' }]
  }
];

/**
 * Validation 2: DBH Shrinkage Exceeds Max (5%)
 */
export const validation2Scenarios: ValidationTestScenario[] = [
  {
    name: 'Excessive DBH Shrinkage',
    description: 'Tree with DBH shrinkage > 5% should be flagged',
    setupData: {
      attributes: [{ Code: 'A', Description: 'alive', Status: 'alive', IsActive: true }],
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [
        { PlotCensusNumber: 1, StartDate: new Date('2015-01-01'), EndDate: new Date('2015-12-31'), IsActive: true },
        { PlotCensusNumber: 2, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }
      ],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'SHRINK_TEST_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        { CensusID: 0, MeasurementDate: new Date('2015-06-01'), MeasuredDBH: 200, MeasuredHOM: 130, IsValidated: true, IsActive: true },
        // 90% of 200 = 190 (10% shrinkage > 5% limit)
        { CensusID: 1, MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 180, MeasuredHOM: 130, IsValidated: undefined, IsActive: true }
      ],
      cmattributes: [{ Code: 'A' }, { Code: 'A' }]
    },
    expectedErrors: [{ treeTag: 'SHRINK_TEST_1', condition: 'DBH shrinkage 10% exceeds max 5%' }]
  }
];

/**
 * Validation 3: Invalid Species Codes
 */
export const validation3Scenarios: ValidationTestScenario[] = [
  {
    name: 'Invalid Species Code',
    description: 'Measurement with species not in species table should be flagged',
    setupData: {
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      // NOTE: NOT creating species - tree will reference non-existent species
      trees: [
        {
          TreeTag: 'INVALID_SP_1',
          SpeciesID: 99999, // Non-existent species ID
          IsActive: true
        }
      ],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [{ treeTag: 'INVALID_SP_1', condition: 'Species ID 99999 does not exist in species table' }]
  },
  {
    name: 'Valid Species Code',
    description: 'Measurement with valid species should NOT be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'VALID_SP_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'VALID_SP_1', condition: 'Valid species should not be flagged' }]
  }
];

/**
 * Validation 6: Measurement Date Outside Census Bounds
 */
export const validation6Scenarios: ValidationTestScenario[] = [
  {
    name: 'Date Before Census Start',
    description: 'Measurement dated before census start should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'DATE_EARLY_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2019-12-15'), // Before census start
          MeasuredDBH: 150,
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'DATE_EARLY_1', condition: 'Measurement date 2019-12-15 is before census start 2020-01-01' }]
  },
  {
    name: 'Date After Census End',
    description: 'Measurement dated after census end should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'DATE_LATE_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2021-01-15'), // After census end
          MeasuredDBH: 150,
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'DATE_LATE_1', condition: 'Measurement date 2021-01-15 is after census end 2020-12-31' }]
  },
  {
    name: 'Date Within Census Bounds',
    description: 'Measurement dated within census bounds should NOT be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [
        {
          PlotCensusNumber: 1,
          StartDate: new Date('2020-01-01'),
          EndDate: new Date('2020-12-31'),
          IsActive: true
        }
      ],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'DATE_OK_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-15'), // Within bounds
          MeasuredDBH: 150,
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'DATE_OK_1', condition: 'Date within census bounds should not be flagged' }]
  }
];

/**
 * Validation 8: Stems Outside Plot Boundaries
 */
export const validation8Scenarios: ValidationTestScenario[] = [
  {
    name: 'Stem X Coordinate Outside Plot',
    description: 'Stem with X coordinate outside plot dimensions should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          GlobalX: 0,
          GlobalY: 0,
          IsActive: true
        }
      ],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [
        {
          QuadratName: 'Q1',
          DimensionX: 20,
          DimensionY: 20,
          StartX: 0,
          StartY: 0,
          IsActive: true
        }
      ],
      trees: [{ TreeTag: 'OUT_OF_BOUNDS_X', IsActive: true }],
      stems: [
        {
          StemTag: 'S1',
          LocalX: 200, // WAY outside plot (plot is 100x100, quadrat starts at 0)
          LocalY: 10,
          IsActive: true
        }
      ],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [{ treeTag: 'OUT_OF_BOUNDS_X', condition: 'Stem X coordinate 200 exceeds plot dimension 100' }]
  },
  {
    name: 'Stem Within Plot Boundaries',
    description: 'Stem within plot boundaries should NOT be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          GlobalX: 0,
          GlobalY: 0,
          IsActive: true
        }
      ],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [
        {
          QuadratName: 'Q1',
          DimensionX: 20,
          DimensionY: 20,
          StartX: 0,
          StartY: 0,
          IsActive: true
        }
      ],
      trees: [{ TreeTag: 'IN_BOUNDS_1', IsActive: true }],
      stems: [
        {
          StemTag: 'S1',
          LocalX: 10,
          LocalY: 10,
          IsActive: true
        }
      ],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'IN_BOUNDS_1', condition: 'Stem within plot bounds should not be flagged' }]
  }
];

/**
 * Validation 14: Invalid Attribute Codes
 */
export const validation14Scenarios: ValidationTestScenario[] = [
  {
    name: 'Invalid Attribute Code',
    description: 'Measurement with attribute code not in attributes table should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'INVALID_ATTR_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }],
      // NOTE: NOT creating the 'MX' attribute - it won't exist in attributes table
      cmattributes: [{ Code: 'MX' }] // Invalid code from bug report
    },
    expectedErrors: [{ treeTag: 'INVALID_ATTR_1', condition: 'Attribute code MX does not exist in attributes table' }]
  },
  {
    name: 'Valid Attribute Code',
    description: 'Measurement with valid attribute code should NOT be flagged',
    setupData: {
      attributes: [{ Code: 'A', Description: 'alive', Status: 'alive', IsActive: true }],
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'VALID_ATTR_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }],
      cmattributes: [{ Code: 'A' }]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'VALID_ATTR_1', condition: 'Valid attribute code should not be flagged' }]
  }
];

/**
 * Validation 15: Abnormally High DBH
 */
export const validation15Scenarios: ValidationTestScenario[] = [
  {
    name: 'Abnormally High DBH (26600mm)',
    description: 'Measurement with DBH >= 3500mm should be flagged (Bug: Tag=011379 with dbh=26600)',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'HIGH_DBH_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 26600, // From bug report
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'HIGH_DBH_1', condition: 'DBH 26600mm exceeds max threshold 3500mm' }]
  },
  {
    name: 'DBH At Threshold',
    description: 'Measurement with DBH exactly at 3500mm should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'THRESHOLD_DBH_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 3500, // Exactly at threshold
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'THRESHOLD_DBH_1', condition: 'DBH 3500mm meets or exceeds threshold' }]
  },
  {
    name: 'Normal DBH',
    description: 'Measurement with normal DBH should NOT be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'NORMAL_DBH_1', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 350, // Normal DBH
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'NORMAL_DBH_1', condition: 'Normal DBH 350mm should not be flagged' }]
  }
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
  {
    name: 'BROKEN QUERY TEST - Tree Stems with Same Species (will fail)',
    description: 'EXPECTED TO FAIL: Current query cannot detect different species because species is at tree level',
    setupData: {
      species: [
        { SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true },
        { SpeciesCode: 'QURU', SpeciesName: 'Quercus rubra', IsActive: true }
      ],
      plots: [{ DimensionX: 100, DimensionY: 100, IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'MULTI_SPECIES_TREE', IsActive: true }], // This tree will only have one species
      stems: [
        { StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true },
        { StemTag: 'S2', LocalX: 11, LocalY: 11, IsActive: true }
      ],
      coremeasurements: [
        { MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true },
        { MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 160, IsValidated: undefined, IsActive: true }
      ]
    },
    // In an ideal world where stems could have different species, this would be flagged
    // But current data model makes this impossible to test properly
    expectedErrors: [{ treeTag: 'MULTI_SPECIES_TREE', condition: 'Tree has stems with different species (IMPOSSIBLE IN CURRENT MODEL)' }]
  }
];

/**
 * Validation 8 Extension: Lower Bound Check (FIXED ✅)
 *
 * ✅ THIS VALIDATION IS NOW FIXED - Includes comprehensive boundary checks
 *
 * Fixed: Query now checks:
 * - NULL stem coordinates
 * - Negative stem coordinates
 * - Lower bound violations (coordinates < 0)
 * - Upper bound violations (coordinates > DimensionX/Y)
 *
 * Expected: All tests should PASS
 */
export const validation8ExtendedScenarios: ValidationTestScenario[] = [
  ...validation8Scenarios,
  {
    name: 'Negative X Coordinate - Should Flag',
    description: 'Stem with negative X coordinate should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          GlobalX: 0,
          GlobalY: 0,
          IsActive: true
        }
      ],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
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
      trees: [{ TreeTag: 'NEGATIVE_X_STEM', IsActive: true }],
      stems: [
        {
          StemTag: 'S1',
          LocalX: -20, // Negative local coordinate: -20 + 10 (quadrat) + 0 (global) = -10 (OUTSIDE!)
          LocalY: 5,
          IsActive: true
        }
      ],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [{ treeTag: 'NEGATIVE_X_STEM', condition: 'Stem X coordinate -20 results in negative absolute position -10' }]
  },
  {
    name: 'Negative Y Coordinate - Should Flag',
    description: 'Stem with negative Y coordinate should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [
        {
          DimensionX: 100,
          DimensionY: 100,
          GlobalX: 0,
          GlobalY: 0,
          IsActive: true
        }
      ],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
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
      trees: [{ TreeTag: 'NEGATIVE_Y_STEM', IsActive: true }],
      stems: [
        {
          StemTag: 'S1',
          LocalX: 5,
          LocalY: -10, // Negative local coordinate: -10 + 5 (quadrat) + 0 (global) = -5 (OUTSIDE!)
          IsActive: true
        }
      ],
      coremeasurements: [{ MeasurementDate: new Date('2020-06-01'), MeasuredDBH: 150, IsValidated: undefined, IsActive: true }]
    },
    expectedErrors: [{ treeTag: 'NEGATIVE_Y_STEM', condition: 'Stem Y coordinate -10 results in negative absolute position -5' }]
  }
];

/**
 * Validation 11: Measured Diameter Min/Max (FIXED ✅)
 *
 * ✅ THIS VALIDATION IS NOW FIXED - Uses species-specific limits from specieslimits table
 *
 * Fixed: Query now joins with specieslimits table to check each measurement against its
 * species-specific LowerBound and UpperBound values.
 *
 * Expected: All tests should PASS
 */
export const validation11Scenarios: ValidationTestScenario[] = [
  {
    name: 'DBH Below Species-Specific Minimum - Should Flag',
    description: 'Measurement with DBH below species minimum should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 10, UpperBound: 500, IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'BELOW_SPECIES_MIN', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 5, // Below species minimum of 10mm
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'BELOW_SPECIES_MIN', condition: 'DBH 5mm below species-specific minimum of 10mm' }]
  },
  {
    name: 'DBH Above Species-Specific Maximum - Should Flag',
    description: 'Measurement with DBH above species maximum should be flagged',
    setupData: {
      species: [{ SpeciesCode: 'SMALL_SP', SpeciesName: 'Small Species', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 5, UpperBound: 500, IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'ABOVE_SPECIES_MAX', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 1000, // Above species maximum of 500mm
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [{ treeTag: 'ABOVE_SPECIES_MAX', condition: 'DBH 1000mm above species-specific maximum of 500mm' }]
  },
  {
    name: 'DBH Within Species-Specific Bounds - Should Not Flag',
    description: 'DBH within species-specific bounds should NOT be flagged',
    setupData: {
      species: [{ SpeciesCode: 'NORMAL_SP', SpeciesName: 'Normal Species', IsActive: true }],
      plots: [{ DimensionX: 100, DimensionY: 100, DefaultDBHUnits: 'mm', IsActive: true }],
      census: [{ PlotCensusNumber: 1, StartDate: new Date('2020-01-01'), EndDate: new Date('2020-12-31'), IsActive: true }],
      specieslimits: [{ LimitType: 'DBH', LowerBound: 10, UpperBound: 500, IsActive: true }],
      quadrats: [{ QuadratName: 'Q1', DimensionX: 20, DimensionY: 20, StartX: 0, StartY: 0, IsActive: true }],
      trees: [{ TreeTag: 'WITHIN_BOUNDS', IsActive: true }],
      stems: [{ StemTag: 'S1', LocalX: 10, LocalY: 10, IsActive: true }],
      coremeasurements: [
        {
          MeasurementDate: new Date('2020-06-01'),
          MeasuredDBH: 250, // Within species bounds (10-500mm)
          IsValidated: undefined,
          IsActive: true
        }
      ]
    },
    expectedErrors: [],
    expectedNoErrors: [{ treeTag: 'WITHIN_BOUNDS', condition: 'DBH within species-specific bounds should not be flagged' }]
  }
];

// Export all scenarios organized by validation ID
export const allValidationScenarios: Map<number, ValidationTestScenario[]> = new Map([
  [1, validation1Scenarios],
  [2, validation2Scenarios],
  [3, validation3Scenarios],
  [6, validation6Scenarios],
  [7, validation7Scenarios], // BROKEN - Expected to fail
  [8, validation8ExtendedScenarios], // INCOMPLETE - Some tests will fail
  [11, validation11Scenarios], // BROKEN - Expected to fail
  [14, validation14Scenarios],
  [15, validation15Scenarios]
]);
