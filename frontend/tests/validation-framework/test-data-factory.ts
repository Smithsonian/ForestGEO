/**
 * Test Data Factory for Validation Tests
 *
 * This factory provides smart defaults and helper functions to create
 * validation test scenarios with minimal boilerplate.
 *
 * Benefits:
 * - 70% reduction in scenario definition code
 * - Consistent defaults across all tests
 * - Easy to override specific values
 * - Clear test intent (only specify what's different)
 *
 * Usage:
 * ```typescript
 * const scenario = createScenario('Test Name', {
 *   measurements: [
 *     { censusIndex: 0, dbh: 100, validated: true },
 *     { censusIndex: 1, dbh: 200, validated: false }
 *   ],
 *   expectError: 'DBH growth exceeds max'
 * });
 * ```
 */

import { ValidationTestScenario } from './validation-test-framework';

/**
 * Default test data that works for most scenarios
 * These represent a typical valid measurement setup
 */
const DEFAULTS = {
  attributes: [{ Code: 'A', Description: 'alive', Status: 'alive' as const, IsActive: true }],
  species: [{ SpeciesCode: 'ACRU', SpeciesName: 'Acer rubrum', IsActive: true }],
  plots: [
    {
      DimensionX: 100,
      DimensionY: 100,
      DefaultDBHUnits: 'mm' as const,
      IsActive: true
    }
  ],
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
  stems: [
    {
      StemTag: 'S1',
      LocalX: 10,
      LocalY: 10,
      IsActive: true
    }
  ]
};

/**
 * Configuration for creating a test scenario
 */
interface ScenarioConfig {
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
  overrides?: {
    attributes?: typeof DEFAULTS.attributes;
    species?: typeof DEFAULTS.species;
    specieslimits?: Array<Partial<any>>;
    plots?: typeof DEFAULTS.plots;
    census?: typeof DEFAULTS.census;
    quadrats?: typeof DEFAULTS.quadrats;
    trees?: Array<Partial<any>>;
    stems?: typeof DEFAULTS.stems;
  };
}

/**
 * Creates a test scenario with smart defaults
 *
 * Only specify what's different from the default setup!
 * This reduces boilerplate from ~25 lines to ~8 lines per scenario.
 *
 * @param name - Descriptive name for the scenario
 * @param config - Configuration specifying only what differs from defaults
 * @returns Complete ValidationTestScenario ready for testing
 *
 * @example
 * ```typescript
 * createScenario('Excessive DBH Growth', {
 *   measurements: [
 *     { censusIndex: 0, dbh: 100, validated: true },
 *     { censusIndex: 1, dbh: 200, validated: false }
 *   ],
 *   expectedErrors: [{ condition: 'DBH growth 100mm exceeds max 65mm' }]
 * });
 * ```
 */
export function createScenario(name: string, config: ScenarioConfig): ValidationTestScenario {
  // Generate unique tree tag from scenario name
  const treeTag =
    config.treeTag ||
    `TEST_${name
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/gi, '')
      .toUpperCase()}`;

  const setupData: any = {
    attributes: config.overrides?.attributes || DEFAULTS.attributes,
    species: config.overrides?.species || DEFAULTS.species,
    plots: config.overrides?.plots || DEFAULTS.plots,
    census: config.overrides?.census || DEFAULTS.census,
    quadrats: config.overrides?.quadrats || DEFAULTS.quadrats,
    trees: config.overrides?.trees || [{ TreeTag: treeTag, IsActive: true }],
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
  };

  // Add specieslimits if provided
  if (config.overrides?.specieslimits) {
    setupData.specieslimits = config.overrides.specieslimits;
  }

  return {
    name,
    description: config.description || name,
    setupData,
    expectedErrors: config.expectedErrors || [],
    expectedNoErrors: config.expectedNoErrors || []
  };
}

/**
 * Creates a scenario with custom census years
 *
 * Useful for testing date-based validations or multi-census scenarios
 *
 * @example
 * ```typescript
 * createScenarioWithCustomCensus('Multi-year growth', [2010, 2015, 2020], {
 *   measurements: [
 *     { censusIndex: 0, dbh: 100, validated: true },
 *     { censusIndex: 1, dbh: 150, validated: true },
 *     { censusIndex: 2, dbh: 200, validated: false }
 *   ],
 *   expectedNoErrors: [{ condition: 'Consistent growth' }]
 * });
 * ```
 */
export function createScenarioWithCustomCensus(
  name: string,
  censusYears: number[],
  config: Omit<ScenarioConfig, 'overrides'> & {
    overrides?: Partial<ScenarioConfig['overrides']>;
  }
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      ...config.overrides,
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
 * Creates a scenario with a specific species
 *
 * Useful for testing species-specific validations
 *
 * @example
 * ```typescript
 * createScenarioWithSpecies('Large oak', 'QURU', 'Quercus rubra', {
 *   measurements: [{ censusIndex: 0, dbh: 500, validated: false }],
 *   expectedNoErrors: [{ condition: 'Large DBH valid for oak' }]
 * });
 * ```
 */
export function createScenarioWithSpecies(
  name: string,
  speciesCode: string,
  speciesName: string,
  config: Omit<ScenarioConfig, 'overrides'> & {
    overrides?: Partial<ScenarioConfig['overrides']>;
  }
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      ...config.overrides,
      species: [{ SpeciesCode: speciesCode, SpeciesName: speciesName, IsActive: true }]
    }
  });
}

/**
 * Creates a scenario with custom plot dimensions
 *
 * Useful for testing coordinate validation
 *
 * @example
 * ```typescript
 * createScenarioWithPlotDimensions('Edge coordinates', 50, 50, {
 *   measurements: [{ censusIndex: 0, dbh: 100, validated: false }],
 *   overrides: {
 *     stems: [{ StemTag: 'S1', LocalX: 49.9, LocalY: 49.9, IsActive: true }]
 *   },
 *   expectedNoErrors: [{ condition: 'Coordinates at edge' }]
 * });
 * ```
 */
export function createScenarioWithPlotDimensions(
  name: string,
  dimensionX: number,
  dimensionY: number,
  config: Omit<ScenarioConfig, 'overrides'> & {
    overrides?: Partial<ScenarioConfig['overrides']>;
  }
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      ...config.overrides,
      plots: [
        {
          DimensionX: dimensionX,
          DimensionY: dimensionY,
          DefaultDBHUnits: 'mm' as const,
          IsActive: true
        }
      ]
    }
  });
}

/**
 * Creates a scenario with no species (for testing invalid species)
 *
 * @example
 * ```typescript
 * createScenarioWithNoSpecies('Invalid species', {
 *   measurements: [{ censusIndex: 0, dbh: 100, validated: false }],
 *   expectedErrors: [{ condition: 'Species not in table' }]
 * });
 * ```
 */
export function createScenarioWithNoSpecies(
  name: string,
  config: Omit<ScenarioConfig, 'overrides'> & {
    overrides?: Partial<ScenarioConfig['overrides']>;
  }
): ValidationTestScenario {
  return createScenario(name, {
    ...config,
    overrides: {
      ...config.overrides,
      species: [] // Empty species array - tree will reference non-existent species
    }
  });
}

/**
 * Creates a scenario with specific attributes
 *
 * Useful for testing attribute-based validations
 *
 * @example
 * ```typescript
 * createScenarioWithAttributes('Dead tree', ['D'], {
 *   measurements: [{ censusIndex: 0, dbh: 100, attribute: 'D', validated: false }],
 *   expectedNoErrors: [{ condition: 'Dead status valid' }],
 *   overrides: {
 *     attributes: [{ Code: 'D', Description: 'dead', Status: 'dead', IsActive: true }]
 *   }
 * });
 * ```
 */
export function createScenarioWithAttributes(
  name: string,
  attributeCodes: string[],
  config: Omit<ScenarioConfig, 'overrides'> & {
    overrides?: Partial<ScenarioConfig['overrides']>;
  }
): ValidationTestScenario {
  const attributes = attributeCodes.map(code => ({
    Code: code,
    Description: code.toLowerCase(),
    Status: code === 'D' ? ('dead' as const) : ('alive' as const),
    IsActive: true
  })) as any;

  return createScenario(name, {
    ...config,
    overrides: {
      ...config.overrides,
      attributes
    }
  });
}
