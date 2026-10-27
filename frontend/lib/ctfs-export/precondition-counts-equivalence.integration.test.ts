/**
 * Randomised equivalence test for the census overview's publish-precondition counts (#557).
 *
 * For every generated census, three parties must agree with an independent TypeScript model of what each check
 * means:
 *   1. the overview counts (countPublishPreconditions) under three classifiers;
 *   2. the publish gate (checkFinishedCensus): the same flagged rows per kind, at most 50 IDs each;
 *   3. countExportedRowsWithUnresolvedErrors.
 *
 * The model encodes today's meaning of each check. An intended change to a check must update the model too; that
 * friction is the point.
 *
 * Data: a deterministic generator (seededRandom, mulberry32) builds one schema per seed: about 24 random censuses
 * across two plots, a census above the gate's display cap, an inactive-only census, the app-db-seed census, and a
 * fixed witness census whose rows each expose one known way the single pass could go wrong (spec Testing §1-§2,
 * plus W5 for the leaf-link mutant M5).
 * A coverage check fails the run before any comparison when the generated data misses a feature or a witness.
 *
 * Seeds: PRECONDITION_COUNTS_SEEDS=1,2,3 replaces the default seed list for exploratory runs.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: npm run test:integration -- lib/ctfs-export/precondition-counts-equivalence.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { createTestDatabase, DEFAULT_TEST_CONFIG, loadSchema, seededRandom, teardownTestDatabase } from '../../tests/setup/local-db-setup';
import { loadAppDbSeed } from '../../tests/fixtures/ctfs-export/load-app-db-seed';
import type { ExportSkipReasonCount, ExportSkipReasonKind } from '@/config/censusoverview';
import {
  checkFinishedCensus,
  isBlockingPreconditionKind,
  PRECONDITION_ROW_CHECKS,
  type BlockingKindClassifier,
  type BlockingPreconditionKind,
  type PreconditionFailureKind,
  type PreconditionInput,
  type PublishBlockerCount
} from './precondition';
import { countExportedRowsWithUnresolvedErrors, countPublishPreconditions } from './export-preview';

// ---------------------------------------------------------------------------
// Function under test
// ---------------------------------------------------------------------------

interface PublishPreconditionCountsUnderTest {
  blockers: PublishBlockerCount[];
  count: number;
  totalActiveCount: number;
  skipReasons: ExportSkipReasonCount[];
}
type CountPublishPreconditionsUnderTest = (
  conn: Connection,
  input: PreconditionInput,
  isBlocking: BlockingKindClassifier
) => Promise<PublishPreconditionCountsUnderTest>;

const countPublishPreconditionsUnderTest: CountPublishPreconditionsUnderTest = countPublishPreconditions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1'];
const DEFAULT_SEEDS: readonly number[] = [557, 20261027, 4242];
const SEEDS_ENV = 'PRECONDITION_COUNTS_SEEDS';
const SEED_LIST_SEPARATOR = ',';
const SCHEMA_PREFIX = 'forestgeo_pccounts';
const SETUP_HOOK_TIMEOUT_MS = 180_000;
const CENSUS_TEST_TIMEOUT_MS = 120_000;
const MAX_DIFFERING_ROWS_SHOWN = 10;
const LOG_PREFIX = '[#557 equivalence]';

// Restated on purpose: the model never reuses production SQL or constants.
const GATE_DISPLAY_CAP = 50;
const MODEL_MIN_EXPORTABLE_FRACTION = 0.5;
const CTFS_WIDTH = { treeTag: 20, stemTag: 32, quadratName: 8, tsmCode: 10, dbhComments: 128, speciesMnemonic: 10, taxonomyName: 64 } as const;

const MODELLED_ROW_KINDS = [
  'not-validated',
  'unresolved-error',
  'no-stem-guid',
  'inactive-join',
  'unknown-attribute-code',
  'missing-taxonomy-fields',
  'string-too-long'
] as const satisfies readonly PreconditionFailureKind[];
type ModelledRowKind = (typeof MODELLED_ROW_KINDS)[number];

const MODELLED_SKIP_REASON_KINDS = [
  'not-validated',
  'no-stem-guid',
  'inactive-stem-or-tree',
  'missing-link',
  'other'
] as const satisfies readonly ExportSkipReasonKind[];
type ModelledSkipReasonKind = (typeof MODELLED_SKIP_REASON_KINDS)[number];
type ModelledShortfallKind = Extract<PreconditionFailureKind, 'zero-exportable-rows' | 'insufficient-exportable-rows'>;
const SHORTFALL_OUTCOMES = ['zero-exportable-rows', 'insufficient-exportable-rows', 'none'] as const;

const LINK_NAMES = ['stem', 'tree', 'quadrat', 'species', 'genus', 'family'] as const;
type LinkName = (typeof LINK_NAMES)[number];
type LinkState = 'valid' | 'null' | 'dangling';

// app-db-seed.sql, loaded before the generated rows.
const APP_DB_SEED = {
  plotId: 1,
  censusId: 1,
  quadratId: 1,
  quadratName: 'A1',
  familyId: 1,
  family: 'Testaceae',
  genusId: 1,
  genus: 'Foobaria',
  speciesId: 1,
  speciesCode: 'FOO',
  speciesName: 'foo',
  treeId: 1,
  treeTag: '1',
  stemGUID: 1,
  stemTag: '1',
  coreMeasurementId: 1
} as const;
const ACTIVE_ATTRIBUTE_CODE = 'LI'; // app-db-seed.sql
const UNKNOWN_ATTRIBUTE_CODES = ['ZZ', 'ZY'] as const;
const INACTIVE_ONLY_ATTRIBUTE_CODE = 'OLD';
const GENERATED_ATTRIBUTE_CODES: readonly (string | null)[] = [...UNKNOWN_ATTRIBUTE_CODES, INACTIVE_ONLY_ATTRIBUTE_CODE, null];
const DECOY_PLOT_ID = 2;
const PLOT_IDS = [APP_DB_SEED.plotId, DECOY_PLOT_ID] as const;
const ERROR_IDS = [9501, 9502] as const;

const FIXTURE_MEASUREMENT_DATE = '2024-06-02';
const FIXTURE_HOM = 1.3;
const FIXTURE_DELETED_AT = '2024-07-01 00:00:00';
const FIXTURE_CENSUS_START = '2024-01-01';
const FIXTURE_CENSUS_END = '2024-12-31';
const SHORT_DESCRIPTION = 'note';
const DESCRIPTION_FILLER = 'x';
const RAW_FAILED_ROW_PREFIX = 'RAW';

const FIRST_ID = {
  census: 10,
  family: 101,
  genus: 101,
  species: 101,
  quadrat: 101,
  tree: 10_001,
  stem: 10_001,
  measurement: 10_001,
  dangling: 900_001
} as const;

// Generation. A census's defect level scales every per-row defect chance: low levels give censuses with no
// shortfall, level 1 gives insufficient ones.
const RANDOM_CENSUS_COUNT = 24;
const RANDOM_CENSUS_MAX_ROWS = 45;
const ABOVE_CAP_CENSUS_ROWS = 150;
const INACTIVE_ONLY_CENSUS_ROWS = 5;
const CENSUS_DEFECT_LEVELS: readonly number[] = [0.05, 0.4, 1];
const FULL_DEFECT_LEVEL = 1;
const DEFECT_CHANCE = {
  inactiveMeasurement: 0.15,
  notValidated: 0.5,
  failedRow: 0.12,
  danglingStemGUID: 0.08,
  inactiveStemOrTree: 0.15,
  deletedStemOrTree: 0.1,
  nullLink: 0.1,
  danglingLink: 0.1,
  unusualSpecies: 1,
  unusualQuadrat: 1,
  boundaryDescription: 0.4,
  badAttributeCode: 0.5,
  errorLog: 0.4
} as const;
const EVEN_SPLIT = 0.5;
const SHARED_STEM_CHANCE = 0.1;
const NULL_DESCRIPTION_CHANCE = 0.5;
const RESOLVED_LOG_CHANCE = 0.4;
const MAX_ATTRIBUTE_CODES = 3;
const BOUNDARY_DESCRIPTION_LENGTHS = [CTFS_WIDTH.dbhComments, CTFS_WIDTH.dbhComments + 1] as const;
const FAMILY_LINKED_GENERA = 2;
const AT_WIDTH_QUADRATS_PER_PLOT = 3;
const FIXTURE_QUADRAT_GEOMETRY = { startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 } as const;
const FIXTURE_QUADRAT_AREA = FIXTURE_QUADRAT_GEOMETRY.dimensionX * FIXTURE_QUADRAT_GEOMETRY.dimensionY;
const CODE_PADDING = '0';
const SPECIES_CODE_PREFIX = { normal: 'N', exactlyMnemonicWidth: 'MW', overMnemonicWidth: 'OW' } as const;
const QUADRAT_NAME_PREFIX = { atWidth: 'Q', overWidth: 'X' } as const;

// A unique, ASCII value of exactly `length` characters: the prefix, then the id left-padded to fill the rest.
function valueOfLength(prefix: string, id: number, length: number): string {
  const value = `${prefix}${String(id).padStart(length - prefix.length, CODE_PADDING)}`;
  if (value.length !== length) throw new Error(`generator bug: '${value}' is not ${length} characters`);
  return value;
}

// Witness census: fixed rows, the same in every seed. Each row is clean except for the one feature that exposes
// its mutant (spec Testing §2), so no other failure can mask it. A witness row's id is also its stem's and tree's.
const WITNESS_CENSUS_ID = 9;
const WITNESS_REFERENCE = {
  familyId: 90,
  genusId: 90,
  speciesId: 90,
  speciesCode: 'WITSP',
  quadratId: 90,
  quadratName: 'WITQUAD1',
  danglingFamilyGenusId: 91,
  danglingFamilySpeciesId: 91,
  danglingFamilySpeciesCode: 'WITSP5'
} as const;
const WITNESS_ROW_IDS = {
  // M1: an unguarded `sp.SpeciesCode IS NULL` is TRUE on the NULL-extended species row.
  W1a: 5001,
  // M1: the unguarded length clause on cm.Description is TRUE although the quadrat link is missing.
  W1b: 5002,
  // M2: the export predicate is NULL here, so NOT (…) drops the row from every skip reason.
  W2: 5003,
  // M3: exactly the DBH.Comments width; `>=` flags it in both the pass and the gate.
  W3: 5004,
  // M4: a guard on s.TreeID passes for this inactive stem whose TreeID dangles.
  W4: 5005,
  // M5: a guard on gn.FamilyID passes for this unvalidated row whose genus's FamilyID dangles, so missing-link
  // loses it. Family is a leaf link, so no descendant guard masks the change.
  W5: 5006
} as const;
const WITNESS_DANGLING_TREE_ID = 905_005;
const WITNESS_DANGLING_FAMILY_ID = 905_006;

// ---------------------------------------------------------------------------
// Generated world
// ---------------------------------------------------------------------------

interface FamilyRow {
  familyId: number;
  family: string;
}
interface GenusRow {
  genusId: number;
  familyId: number | null;
  genus: string;
}
interface SpeciesRow {
  speciesId: number;
  genusId: number | null;
  speciesCode: string | null;
  speciesName: string;
}
interface QuadratRow {
  quadratId: number;
  plotId: number;
  quadratName: string;
}
interface TreeRow {
  treeId: number;
  treeTag: string;
  speciesId: number | null;
  censusId: number;
  isActive: boolean;
  isDeleted: boolean;
}
interface StemRow {
  stemGUID: number;
  treeId: number | null;
  quadratId: number | null;
  censusId: number;
  stemTag: string;
  isActive: boolean;
  isDeleted: boolean;
}
interface ErrorLogRow {
  errorId: number;
  isResolved: boolean;
}
interface MeasurementRow {
  coreMeasurementId: number;
  censusId: number;
  stemGUID: number | null;
  isValidated: boolean | null;
  isActive: boolean;
  description: string | null;
  attributeCodes: (string | null)[];
  errorLogs: ErrorLogRow[];
}
type CensusRole = 'app-db-seed' | 'random' | 'above-display-cap' | 'inactive-only' | 'witness';
type CensusActivity = 'random' | 'all-active' | 'all-inactive';
interface CensusRow {
  censusId: number;
  plotId: number;
  plotCensusNumber: number;
  role: CensusRole;
  defectLevel: number;
  measurements: MeasurementRow[];
}
interface World {
  seed: number;
  families: Map<number, FamilyRow>;
  genera: Map<number, GenusRow>;
  species: Map<number, SpeciesRow>;
  quadrats: Map<number, QuadratRow>;
  trees: Map<number, TreeRow>;
  stems: Map<number, StemRow>;
  censuses: CensusRow[];
  activeAttributeCodes: ReadonlySet<string>;
}

class WorldBuilder {
  private readonly random: () => number;
  private readonly nextId: Record<keyof typeof FIRST_ID, number> = { ...FIRST_ID };
  private readonly nextPlotCensusNumber = new Map<number, number>(PLOT_IDS.map(plotId => [plotId, plotId === APP_DB_SEED.plotId ? 2 : 1]));
  private readonly quadratsByPlot = new Map<number, QuadratRow[]>();
  private readonly speciesPool: SpeciesRow[] = [];
  private cleanSpecies: SpeciesRow | null = null;
  private readonly generatedStems: StemRow[] = [];
  readonly world: World;

  constructor(seed: number) {
    this.random = seededRandom(seed);
    this.world = {
      seed,
      families: new Map(),
      genera: new Map(),
      species: new Map(),
      quadrats: new Map(),
      trees: new Map(),
      stems: new Map(),
      censuses: [],
      activeAttributeCodes: new Set([ACTIVE_ATTRIBUTE_CODE])
    };
  }

  build(): World {
    this.addAppDbSeed();
    this.addReferencePools();
    this.addWitnessCensus();
    for (let index = 0; index < RANDOM_CENSUS_COUNT; index++) {
      this.addGeneratedCensus(
        'random',
        PLOT_IDS[index % PLOT_IDS.length],
        this.pick(CENSUS_DEFECT_LEVELS),
        this.randomInt(0, RANDOM_CENSUS_MAX_ROWS),
        'random'
      );
    }
    this.addGeneratedCensus('above-display-cap', DECOY_PLOT_ID, FULL_DEFECT_LEVEL, ABOVE_CAP_CENSUS_ROWS, 'all-active');
    this.addGeneratedCensus('inactive-only', APP_DB_SEED.plotId, FULL_DEFECT_LEVEL, INACTIVE_ONLY_CENSUS_ROWS, 'all-inactive');
    return this.world;
  }

  private chance(probability: number): boolean {
    return this.random() < probability;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  private randomInt(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  private allocate(table: keyof typeof FIRST_ID): number {
    const id = this.nextId[table];
    this.nextId[table] = id + 1;
    return id;
  }

  private allocatePlotCensusNumber(plotId: number): number {
    const number = this.nextPlotCensusNumber.get(plotId) ?? 1;
    this.nextPlotCensusNumber.set(plotId, number + 1);
    return number;
  }

  private linkState(defectLevel: number): LinkState {
    if (this.chance(defectLevel * DEFECT_CHANCE.nullLink)) return 'null';
    if (this.chance(defectLevel * DEFECT_CHANCE.danglingLink)) return 'dangling';
    return 'valid';
  }

  private addAppDbSeed(): void {
    const { world } = this;
    world.families.set(APP_DB_SEED.familyId, { familyId: APP_DB_SEED.familyId, family: APP_DB_SEED.family });
    world.genera.set(APP_DB_SEED.genusId, { genusId: APP_DB_SEED.genusId, familyId: APP_DB_SEED.familyId, genus: APP_DB_SEED.genus });
    world.species.set(APP_DB_SEED.speciesId, {
      speciesId: APP_DB_SEED.speciesId,
      genusId: APP_DB_SEED.genusId,
      speciesCode: APP_DB_SEED.speciesCode,
      speciesName: APP_DB_SEED.speciesName
    });
    world.quadrats.set(APP_DB_SEED.quadratId, { quadratId: APP_DB_SEED.quadratId, plotId: APP_DB_SEED.plotId, quadratName: APP_DB_SEED.quadratName });
    world.trees.set(APP_DB_SEED.treeId, {
      treeId: APP_DB_SEED.treeId,
      treeTag: APP_DB_SEED.treeTag,
      speciesId: APP_DB_SEED.speciesId,
      censusId: APP_DB_SEED.censusId,
      isActive: true,
      isDeleted: false
    });
    world.stems.set(APP_DB_SEED.stemGUID, {
      stemGUID: APP_DB_SEED.stemGUID,
      treeId: APP_DB_SEED.treeId,
      quadratId: APP_DB_SEED.quadratId,
      censusId: APP_DB_SEED.censusId,
      stemTag: APP_DB_SEED.stemTag,
      isActive: true,
      isDeleted: false
    });
    world.censuses.push({
      censusId: APP_DB_SEED.censusId,
      plotId: APP_DB_SEED.plotId,
      plotCensusNumber: 1,
      role: 'app-db-seed',
      defectLevel: 0,
      measurements: [
        {
          coreMeasurementId: APP_DB_SEED.coreMeasurementId,
          censusId: APP_DB_SEED.censusId,
          stemGUID: APP_DB_SEED.stemGUID,
          isValidated: true,
          isActive: true,
          description: null,
          attributeCodes: [ACTIVE_ATTRIBUTE_CODE],
          errorLogs: []
        }
      ]
    });
  }

  // Deterministic pools, so every code variant meets every genus link: the per-row draws decide which rows reach them.
  private addReferencePools(): void {
    const { world } = this;
    const familyIds = Array.from({ length: FAMILY_LINKED_GENERA }, () => this.allocate('family'));
    for (const familyId of familyIds) world.families.set(familyId, { familyId, family: `Family${familyId}` });
    const genusFamilyIds: (number | null)[] = [...familyIds, null, this.allocate('dangling')];
    const genusIds = genusFamilyIds.map(familyId => {
      const genusId = this.allocate('genus');
      world.genera.set(genusId, { genusId, familyId, genus: `Genus${genusId}` });
      return genusId;
    });
    const speciesGenusIds: (number | null)[] = [...genusIds, null, this.allocate('dangling')];
    const codeVariants = ['normal', 'null', 'exactly-mnemonic-width', 'over-mnemonic-width'] as const;
    for (const variant of codeVariants) {
      for (const genusId of speciesGenusIds) this.addPoolSpecies(variant, genusId);
    }
    // '' only once: uq_species_active_code is unique on (SpeciesCode, IsActive).
    this.addPoolSpecies('empty', genusIds[0]);
    this.cleanSpecies =
      this.speciesPool.find(species => species.genusId === genusIds[0] && species.speciesCode?.startsWith(SPECIES_CODE_PREFIX.normal)) ?? null;

    for (const plotId of PLOT_IDS) {
      const quadrats = Array.from({ length: AT_WIDTH_QUADRATS_PER_PLOT }, (_, index) =>
        this.addQuadrat(plotId, valueOfLength(`P${plotId}${QUADRAT_NAME_PREFIX.atWidth}`, index + 1, CTFS_WIDTH.quadratName))
      );
      quadrats.push(this.addQuadrat(plotId, valueOfLength(`P${plotId}${QUADRAT_NAME_PREFIX.overWidth}`, 1, CTFS_WIDTH.quadratName + 1)));
      this.quadratsByPlot.set(plotId, quadrats);
    }
  }

  private addPoolSpecies(variant: 'normal' | 'null' | 'empty' | 'exactly-mnemonic-width' | 'over-mnemonic-width', genusId: number | null): void {
    const speciesId = this.allocate('species');
    const speciesCode = {
      normal: `${SPECIES_CODE_PREFIX.normal}${speciesId}`,
      null: null,
      empty: '',
      'exactly-mnemonic-width': valueOfLength(SPECIES_CODE_PREFIX.exactlyMnemonicWidth, speciesId, CTFS_WIDTH.speciesMnemonic),
      'over-mnemonic-width': valueOfLength(SPECIES_CODE_PREFIX.overMnemonicWidth, speciesId, CTFS_WIDTH.speciesMnemonic + 1)
    }[variant];
    const species = { speciesId, genusId, speciesCode, speciesName: `species ${speciesId}` };
    this.world.species.set(speciesId, species);
    this.speciesPool.push(species);
  }

  private addQuadrat(plotId: number, quadratName: string): QuadratRow {
    const quadrat = { quadratId: this.allocate('quadrat'), plotId, quadratName };
    this.world.quadrats.set(quadrat.quadratId, quadrat);
    return quadrat;
  }

  private addWitnessCensus(): void {
    const { world } = this;
    const plotId = APP_DB_SEED.plotId;
    world.families.set(WITNESS_REFERENCE.familyId, { familyId: WITNESS_REFERENCE.familyId, family: 'WitnessFamily' });
    world.genera.set(WITNESS_REFERENCE.genusId, { genusId: WITNESS_REFERENCE.genusId, familyId: WITNESS_REFERENCE.familyId, genus: 'WitnessGenus' });
    world.species.set(WITNESS_REFERENCE.speciesId, {
      speciesId: WITNESS_REFERENCE.speciesId,
      genusId: WITNESS_REFERENCE.genusId,
      speciesCode: WITNESS_REFERENCE.speciesCode,
      speciesName: 'witness species'
    });
    world.quadrats.set(WITNESS_REFERENCE.quadratId, { quadratId: WITNESS_REFERENCE.quadratId, plotId, quadratName: WITNESS_REFERENCE.quadratName });
    world.genera.set(WITNESS_REFERENCE.danglingFamilyGenusId, {
      genusId: WITNESS_REFERENCE.danglingFamilyGenusId,
      familyId: WITNESS_DANGLING_FAMILY_ID,
      genus: 'WitnessOrphanGenus'
    });
    world.species.set(WITNESS_REFERENCE.danglingFamilySpeciesId, {
      speciesId: WITNESS_REFERENCE.danglingFamilySpeciesId,
      genusId: WITNESS_REFERENCE.danglingFamilyGenusId,
      speciesCode: WITNESS_REFERENCE.danglingFamilySpeciesCode,
      speciesName: 'witness species with an orphan genus'
    });

    const census: CensusRow = {
      censusId: WITNESS_CENSUS_ID,
      plotId,
      plotCensusNumber: this.allocatePlotCensusNumber(plotId),
      role: 'witness',
      defectLevel: 0,
      measurements: []
    };
    const addWitness = (
      rowId: number,
      overrides: {
        isValidated?: boolean | null;
        description?: string | null;
        speciesId?: number | null;
        quadratId?: number | null;
        treeId?: number | null;
        stemIsActive?: boolean;
      }
    ): void => {
      const treeId = overrides.treeId === undefined ? rowId : overrides.treeId;
      if (treeId === rowId) {
        world.trees.set(rowId, {
          treeId: rowId,
          treeTag: `W${rowId}`,
          speciesId: overrides.speciesId === undefined ? WITNESS_REFERENCE.speciesId : overrides.speciesId,
          censusId: WITNESS_CENSUS_ID,
          isActive: true,
          isDeleted: false
        });
      }
      world.stems.set(rowId, {
        stemGUID: rowId,
        treeId,
        quadratId: overrides.quadratId === undefined ? WITNESS_REFERENCE.quadratId : overrides.quadratId,
        censusId: WITNESS_CENSUS_ID,
        stemTag: `W${rowId}`,
        isActive: overrides.stemIsActive ?? true,
        isDeleted: false
      });
      census.measurements.push({
        coreMeasurementId: rowId,
        censusId: WITNESS_CENSUS_ID,
        stemGUID: rowId,
        isValidated: overrides.isValidated === undefined ? true : overrides.isValidated,
        isActive: true,
        description: overrides.description ?? null,
        attributeCodes: [],
        errorLogs: []
      });
    };
    addWitness(WITNESS_ROW_IDS.W1a, { speciesId: null });
    addWitness(WITNESS_ROW_IDS.W1b, { description: DESCRIPTION_FILLER.repeat(CTFS_WIDTH.dbhComments + 1), quadratId: null });
    addWitness(WITNESS_ROW_IDS.W2, { isValidated: null });
    addWitness(WITNESS_ROW_IDS.W3, { description: DESCRIPTION_FILLER.repeat(CTFS_WIDTH.dbhComments) });
    addWitness(WITNESS_ROW_IDS.W4, { treeId: WITNESS_DANGLING_TREE_ID, stemIsActive: false });
    addWitness(WITNESS_ROW_IDS.W5, { isValidated: false, speciesId: WITNESS_REFERENCE.danglingFamilySpeciesId });
    world.censuses.push(census);
  }

  private addGeneratedCensus(role: CensusRole, plotId: number, defectLevel: number, rowCount: number, activity: CensusActivity): void {
    const census: CensusRow = {
      censusId: this.allocate('census'),
      plotId,
      plotCensusNumber: this.allocatePlotCensusNumber(plotId),
      role,
      defectLevel,
      measurements: []
    };
    for (let index = 0; index < rowCount; index++) census.measurements.push(this.generateMeasurement(census, activity));
    this.world.censuses.push(census);
  }

  private generateMeasurement(census: CensusRow, activity: CensusActivity): MeasurementRow {
    const level = census.defectLevel;
    const isActive = activity === 'random' ? !this.chance(level * DEFECT_CHANCE.inactiveMeasurement) : activity === 'all-active';
    const isValidated = this.chance(level * DEFECT_CHANCE.notValidated) ? (this.chance(EVEN_SPLIT) ? false : null) : true;
    const description = this.chance(level * DEFECT_CHANCE.boundaryDescription)
      ? DESCRIPTION_FILLER.repeat(this.pick(BOUNDARY_DESCRIPTION_LENGTHS))
      : this.chance(NULL_DESCRIPTION_CHANCE)
        ? null
        : SHORT_DESCRIPTION;
    const attributeCodes: (string | null)[] = [];
    const codeCount = this.randomInt(0, MAX_ATTRIBUTE_CODES);
    for (let index = 0; index < codeCount; index++) {
      const code = this.chance(level * DEFECT_CHANCE.badAttributeCode) ? this.pick(GENERATED_ATTRIBUTE_CODES) : ACTIVE_ATTRIBUTE_CODE;
      if (!attributeCodes.includes(code)) attributeCodes.push(code);
    }
    const errorLogs = ERROR_IDS.filter(() => this.chance(level * DEFECT_CHANCE.errorLog)).map(errorId => ({
      errorId,
      isResolved: this.chance(RESOLVED_LOG_CHANCE)
    }));
    return {
      coreMeasurementId: this.allocate('measurement'),
      censusId: census.censusId,
      stemGUID: this.generateStemGUID(census),
      isValidated,
      isActive,
      description,
      attributeCodes,
      errorLogs
    };
  }

  private generateStemGUID(census: CensusRow): number | null {
    const level = census.defectLevel;
    if (this.chance(level * DEFECT_CHANCE.failedRow)) return null;
    if (this.chance(level * DEFECT_CHANCE.danglingStemGUID)) return this.allocate('dangling');
    if (this.generatedStems.length > 0 && this.chance(SHARED_STEM_CHANCE)) return this.pick(this.generatedStems).stemGUID;
    const stemGUID = this.allocate('stem');
    const stem: StemRow = {
      stemGUID,
      treeId: this.generateTreeLink(census),
      quadratId: this.generateQuadratLink(census),
      censusId: census.censusId,
      stemTag: `S${stemGUID}`,
      isActive: !this.chance(level * DEFECT_CHANCE.inactiveStemOrTree),
      isDeleted: this.chance(level * DEFECT_CHANCE.deletedStemOrTree)
    };
    this.world.stems.set(stemGUID, stem);
    this.generatedStems.push(stem);
    return stemGUID;
  }

  private generateTreeLink(census: CensusRow): number | null {
    const state = this.linkState(census.defectLevel);
    if (state === 'null') return null;
    if (state === 'dangling') return this.allocate('dangling');
    const treeId = this.allocate('tree');
    this.world.trees.set(treeId, {
      treeId,
      treeTag: `T${treeId}`,
      speciesId: this.generateSpeciesLink(census),
      censusId: census.censusId,
      isActive: !this.chance(census.defectLevel * DEFECT_CHANCE.inactiveStemOrTree),
      isDeleted: this.chance(census.defectLevel * DEFECT_CHANCE.deletedStemOrTree)
    });
    return treeId;
  }

  private generateSpeciesLink(census: CensusRow): number | null {
    const state = this.linkState(census.defectLevel);
    if (state === 'null') return null;
    if (state === 'dangling') return this.allocate('dangling');
    if (this.cleanSpecies === null) throw new Error('generator bug: the species pool has no clean species');
    return this.chance(census.defectLevel * DEFECT_CHANCE.unusualSpecies) ? this.pick(this.speciesPool).speciesId : this.cleanSpecies.speciesId;
  }

  private generateQuadratLink(census: CensusRow): number | null {
    const state = this.linkState(census.defectLevel);
    if (state === 'null') return null;
    if (state === 'dangling') return this.allocate('dangling');
    const quadrats = this.quadratsByPlot.get(census.plotId) ?? [];
    return (this.chance(census.defectLevel * DEFECT_CHANCE.unusualQuadrat) ? this.pick(quadrats) : quadrats[0]).quadratId;
  }
}

// ---------------------------------------------------------------------------
// Model oracle
// ---------------------------------------------------------------------------

interface ResolvedLinks {
  stem?: StemRow;
  tree?: TreeRow;
  quadrat?: QuadratRow;
  species?: SpeciesRow;
  genus?: GenusRow;
  family?: FamilyRow;
}

interface RowVerdict {
  flags: Record<ModelledRowKind, boolean>;
  exportable: boolean;
  skipReasons: Record<ModelledSkipReasonKind, boolean>;
  exportedWithUnresolvedError: boolean;
}

interface CensusExpectation {
  activeRowIds: number[];
  flaggedIdsByKind: Record<ModelledRowKind, Set<number>>;
  exportableCount: number;
  skipReasonCounts: Record<ModelledSkipReasonKind, number>;
  exportedWithUnresolvedErrorCount: number;
  shortfallKind: ModelledShortfallKind | null;
}

function lookup<T>(table: Map<number, T>, id: number | null | undefined): T | undefined {
  return id === null || id === undefined ? undefined : table.get(id);
}

// An inner-join chain holds exactly when every linked object exists.
function resolveLinks(world: World, row: MeasurementRow): ResolvedLinks {
  const stem = lookup(world.stems, row.stemGUID);
  const tree = lookup(world.trees, stem?.treeId);
  const quadrat = lookup(world.quadrats, stem?.quadratId);
  const species = lookup(world.species, tree?.speciesId);
  const genus = lookup(world.genera, species?.genusId);
  const family = lookup(world.families, genus?.familyId);
  return { stem, tree, quadrat, species, genus, family };
}

// CHAR_LENGTH(NULL) is NULL, and NULL > n never flags.
function longerThan(value: string | null | undefined, width: number): boolean {
  return value !== null && value !== undefined && value.length > width;
}

function hasEveryLink(links: ResolvedLinks): boolean {
  return LINK_NAMES.every(name => links[name] !== undefined);
}

function judgeRow(world: World, row: MeasurementRow): RowVerdict {
  const links = resolveLinks(world, row);
  const { stem, tree, quadrat, species, genus, family } = links;
  const fullChain = hasEveryLink(links);
  // Check 6 inner-joins the taxonomy chain but not quadrats.
  const taxonomyChain = stem !== undefined && tree !== undefined && species !== undefined && genus !== undefined && family !== undefined;
  // SubspeciesName and the taxonomy authorities are never generated (always NULL), so their clauses never flag.
  const stringTooLong =
    fullChain &&
    (longerThan(tree?.treeTag, CTFS_WIDTH.treeTag) ||
      longerThan(stem?.stemTag, CTFS_WIDTH.stemTag) ||
      longerThan(quadrat?.quadratName, CTFS_WIDTH.quadratName) ||
      longerThan(row.description, CTFS_WIDTH.dbhComments) ||
      longerThan(species?.speciesCode, CTFS_WIDTH.speciesMnemonic) ||
      longerThan(species?.speciesName, CTFS_WIDTH.taxonomyName) ||
      longerThan(genus?.genus, CTFS_WIDTH.taxonomyName) ||
      longerThan(family?.family, CTFS_WIDTH.taxonomyName) ||
      row.attributeCodes.some(code => longerThan(code, CTFS_WIDTH.tsmCode)));
  const flags: Record<ModelledRowKind, boolean> = {
    'not-validated': row.isValidated !== true,
    'unresolved-error': row.errorLogs.some(log => !log.isResolved),
    'no-stem-guid': row.stemGUID === null,
    'inactive-join': stem !== undefined && tree !== undefined && (!stem.isActive || stem.isDeleted || !tree.isActive || tree.isDeleted),
    'unknown-attribute-code': row.attributeCodes.some(code => code === null || !world.activeAttributeCodes.has(code)),
    'missing-taxonomy-fields': taxonomyChain && (species?.speciesCode === null || species?.speciesCode === ''),
    'string-too-long': stringTooLong
  };
  // The export ignores DeletedAt; only IsActive excludes a stem or tree.
  const exportable = fullChain && row.isValidated === true && row.stemGUID !== null && stem?.isActive === true && tree?.isActive === true;
  const namedSkipReasons = {
    'not-validated': row.isValidated !== true,
    'no-stem-guid': row.stemGUID === null,
    'inactive-stem-or-tree': (stem !== undefined && !stem.isActive) || (tree !== undefined && !tree.isActive),
    'missing-link': row.stemGUID !== null && !fullChain
  };
  const skipReasons: Record<ModelledSkipReasonKind, boolean> = {
    ...namedSkipReasons,
    other: !Object.values(namedSkipReasons).some(Boolean)
  };
  return { flags, exportable, skipReasons, exportedWithUnresolvedError: exportable && flags['unresolved-error'] };
}

function modelShortfall(exportableCount: number, activeCount: number): ModelledShortfallKind | null {
  if (exportableCount === 0) return 'zero-exportable-rows';
  if (exportableCount < activeCount * MODEL_MIN_EXPORTABLE_FRACTION) return 'insufficient-exportable-rows';
  return null;
}

function emptyRecord<K extends string, V>(keys: readonly K[], value: () => V): Record<K, V> {
  return Object.fromEntries(keys.map(key => [key, value()])) as Record<K, V>;
}

function expectCensus(world: World, census: CensusRow): CensusExpectation {
  const activeRows = census.measurements.filter(row => row.isActive);
  const flaggedIdsByKind = emptyRecord(MODELLED_ROW_KINDS, () => new Set<number>());
  const skipReasonCounts = emptyRecord(MODELLED_SKIP_REASON_KINDS, () => 0);
  let exportableCount = 0;
  let exportedWithUnresolvedErrorCount = 0;
  for (const row of activeRows) {
    const verdict = judgeRow(world, row);
    for (const kind of MODELLED_ROW_KINDS) if (verdict.flags[kind]) flaggedIdsByKind[kind].add(row.coreMeasurementId);
    if (verdict.exportable) exportableCount++;
    else for (const kind of MODELLED_SKIP_REASON_KINDS) if (verdict.skipReasons[kind]) skipReasonCounts[kind]++;
    if (verdict.exportedWithUnresolvedError) exportedWithUnresolvedErrorCount++;
  }
  return {
    activeRowIds: activeRows.map(row => row.coreMeasurementId),
    flaggedIdsByKind,
    exportableCount,
    skipReasonCounts,
    exportedWithUnresolvedErrorCount,
    shortfallKind: modelShortfall(exportableCount, activeRows.length)
  };
}

function expectedBlockers(expectation: CensusExpectation, isBlocking: BlockingKindClassifier): PublishBlockerCount[] {
  const blockers: PublishBlockerCount[] = [];
  for (const kind of MODELLED_ROW_KINDS) {
    const flagged = expectation.flaggedIdsByKind[kind].size;
    if (flagged > 0 && isBlocking(kind)) blockers.push({ kind, count: flagged });
  }
  const { shortfallKind } = expectation;
  if (shortfallKind !== null && isBlocking(shortfallKind)) blockers.push({ kind: shortfallKind, count: null });
  return blockers;
}

function expectedSkipReasons(expectation: CensusExpectation): ExportSkipReasonCount[] {
  return MODELLED_SKIP_REASON_KINDS.map(kind => ({ kind, count: expectation.skipReasonCounts[kind] }));
}

// ---------------------------------------------------------------------------
// Coverage: a green run must not be vacuous
// ---------------------------------------------------------------------------

function linkStates(world: World, row: MeasurementRow): Partial<Record<LinkName, LinkState>> {
  const states: Partial<Record<LinkName, LinkState>> = {};
  const record = (name: LinkName, id: number | null | undefined, target: object | undefined): void => {
    states[name] = id === null ? 'null' : target === undefined ? 'dangling' : 'valid';
  };
  const { stem, tree, quadrat, species, genus, family } = resolveLinks(world, row);
  record('stem', row.stemGUID, stem);
  if (stem) {
    record('tree', stem.treeId, tree);
    record('quadrat', stem.quadratId, quadrat);
  }
  if (tree) record('species', tree.speciesId, species);
  if (species) record('genus', species.genusId, genus);
  if (genus) record('family', genus.familyId, family);
  return states;
}

function onlyCheckSevenClauseIsDescriptionAtWidth(world: World, row: MeasurementRow): boolean {
  const links = resolveLinks(world, row);
  return hasEveryLink(links) && row.description?.length === CTFS_WIDTH.dbhComments && !judgeRow(world, { ...row, description: null }).flags['string-too-long'];
}

function uncoveredFeatures(world: World): string[] {
  const covered = new Set<string>();
  const censusOutcomes = new Set<string>();
  for (const census of world.censuses) {
    const expectation = expectCensus(world, census);
    censusOutcomes.add(expectation.shortfallKind ?? 'none');
    for (const row of census.measurements.filter(measurement => measurement.isActive)) {
      const verdict = judgeRow(world, row);
      const links = resolveLinks(world, row);
      const states = linkStates(world, row);
      const flaggedKinds = MODELLED_ROW_KINDS.filter(kind => verdict.flags[kind]);
      for (const kind of flaggedKinds) covered.add(`kind ${kind}`);
      if (!verdict.exportable) {
        for (const kind of MODELLED_SKIP_REASON_KINDS) if (verdict.skipReasons[kind]) covered.add(`skip reason ${kind}`);
      }
      for (const name of LINK_NAMES) {
        const state = states[name];
        if (state === 'null' || state === 'dangling') covered.add(`${state} ${name} link`);
      }
      if (flaggedKinds.length >= 3) covered.add('a row flagged by three or more kinds');
      if (row.stemGUID === null) covered.add('a failed (StemGUID NULL) row');
      if (row.attributeCodes.filter(code => code !== null && !world.activeAttributeCodes.has(code)).length >= 2) covered.add('a row with two unknown codes');
      if (row.errorLogs.filter(log => !log.isResolved).length >= 2) covered.add('a row with two unresolved logs');
      if (hasEveryLink(links)) {
        covered.add(`description length ${row.description?.length ?? 'NULL'}`);
        covered.add(`species code length ${links.species?.speciesCode?.length ?? 'NULL'}`);
        covered.add(`quadrat name length ${links.quadrat?.quadratName.length}`);
      }
      const stemAndTreeActive = links.stem?.isActive === true && links.tree?.isActive === true;
      if (links.stem && links.tree && states.species !== 'valid') covered.add('M1 witness: stem and tree present, species link missing');
      if (longerThan(row.description, CTFS_WIDTH.dbhComments) && links.stem && states.quadrat !== 'valid') {
        covered.add('M1 witness: description over the width, quadrat link missing');
      }
      if (row.isValidated === null && row.stemGUID !== null && hasEveryLink(links) && stemAndTreeActive) {
        covered.add('M2 witness: IsValidated NULL, every link present, stem and tree active');
      }
      if (onlyCheckSevenClauseIsDescriptionAtWidth(world, row)) covered.add('M3 witness: description exactly at the width, no other check-7 clause');
      if (links.stem && (!links.stem.isActive || links.stem.isDeleted) && states.tree === 'dangling') {
        covered.add('M4 witness: inactive or deleted stem with a dangling TreeID');
      }
      const everyLinkButFamily = links.stem && links.tree && links.quadrat && links.species && links.genus;
      if (row.isValidated !== true && everyLinkButFamily && states.family === 'dangling') {
        covered.add('M5 witness: unvalidated row whose only missing link is a dangling FamilyID');
      }
    }
    for (const kind of MODELLED_ROW_KINDS) {
      if (expectation.flaggedIdsByKind[kind].size > GATE_DISPLAY_CAP) covered.add('a kind flagged above the display cap');
    }
  }
  for (const outcome of SHORTFALL_OUTCOMES) if (censusOutcomes.has(outcome)) covered.add(`shortfall ${outcome}`);

  const required = [
    ...MODELLED_ROW_KINDS.map(kind => `kind ${kind}`),
    ...MODELLED_SKIP_REASON_KINDS.filter(kind => kind !== 'other').map(kind => `skip reason ${kind}`),
    ...LINK_NAMES.flatMap(name => [`null ${name} link`, `dangling ${name} link`]),
    'a row flagged by three or more kinds',
    'a failed (StemGUID NULL) row',
    'a row with two unknown codes',
    'a row with two unresolved logs',
    ...BOUNDARY_DESCRIPTION_LENGTHS.map(length => `description length ${length}`),
    `species code length ${CTFS_WIDTH.speciesMnemonic}`,
    `species code length ${CTFS_WIDTH.speciesMnemonic + 1}`,
    `quadrat name length ${CTFS_WIDTH.quadratName}`,
    `quadrat name length ${CTFS_WIDTH.quadratName + 1}`,
    ...SHORTFALL_OUTCOMES.map(outcome => `shortfall ${outcome}`),
    'a kind flagged above the display cap',
    'M1 witness: stem and tree present, species link missing',
    'M1 witness: description over the width, quadrat link missing',
    'M2 witness: IsValidated NULL, every link present, stem and tree active',
    'M3 witness: description exactly at the width, no other check-7 clause',
    'M4 witness: inactive or deleted stem with a dangling TreeID',
    'M5 witness: unvalidated row whose only missing link is a dangling FamilyID'
  ];
  return required.filter(feature => !covered.has(feature));
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type SqlValue = string | number | boolean | null;

function isDangling(table: Map<number, unknown>, id: number | null): boolean {
  return id !== null && !table.has(id);
}

// Rows whose link dangles go in with FOREIGN_KEY_CHECKS = 0; every other row goes in with the checks on.
async function insertRows(conn: Connection, insertSql: string, rows: SqlValue[][], danglingRows: SqlValue[][]): Promise<void> {
  if (rows.length > 0) await conn.query(insertSql, [rows]);
  if (danglingRows.length === 0) return;
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await conn.query(insertSql, [danglingRows]);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

function partitionByDangling<T>(rows: readonly T[], dangles: (row: T) => boolean, toValues: (row: T) => SqlValue[]): [SqlValue[][], SqlValue[][]] {
  return [rows.filter(row => !dangles(row)).map(toValues), rows.filter(dangles).map(toValues)];
}

async function insertWorld(conn: Connection, world: World): Promise<void> {
  const generatedCensuses = world.censuses.filter(census => census.role !== 'app-db-seed');
  const measurements = generatedCensuses.flatMap(census => census.measurements);
  const deletedAt = (isDeleted: boolean) => (isDeleted ? FIXTURE_DELETED_AT : null);
  const notInAppDbSeed = <T>(rows: Iterable<T>, id: (row: T) => number, seedId: number): T[] => [...rows].filter(row => id(row) !== seedId);

  await conn.query(`INSERT INTO plots (PlotID, PlotName) VALUES (?, 'Equivalence decoy plot')`, [DECOY_PLOT_ID]);
  await conn.query(`INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, 'retired code', NULL, 0)`, [INACTIVE_ONLY_ATTRIBUTE_CODE]);
  await conn.query(`INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage) VALUES ?`, [
    ERROR_IDS.map(errorId => [errorId, 'validation', `PCCOUNTS_${errorId}`, `Equivalence error ${errorId}`])
  ]);
  await conn.query(`INSERT INTO census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive) VALUES ?`, [
    generatedCensuses.map(census => [census.censusId, census.plotId, census.plotCensusNumber, FIXTURE_CENSUS_START, FIXTURE_CENSUS_END, census.role, 1])
  ]);
  await insertRows(
    conn,
    'INSERT INTO family (FamilyID, Family, IsActive) VALUES ?',
    notInAppDbSeed(world.families.values(), family => family.familyId, APP_DB_SEED.familyId).map(family => [family.familyId, family.family, 1]),
    []
  );
  await insertRows(
    conn,
    'INSERT INTO genus (GenusID, FamilyID, Genus, IsActive) VALUES ?',
    ...partitionByDangling(
      notInAppDbSeed(world.genera.values(), genus => genus.genusId, APP_DB_SEED.genusId),
      genus => isDangling(world.families, genus.familyId),
      genus => [genus.genusId, genus.familyId, genus.genus, 1]
    )
  );
  await insertRows(
    conn,
    'INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, IDLevel, IsActive) VALUES ?',
    ...partitionByDangling(
      notInAppDbSeed(world.species.values(), species => species.speciesId, APP_DB_SEED.speciesId),
      species => isDangling(world.genera, species.genusId),
      species => [species.speciesId, species.genusId, species.speciesCode, species.speciesName, 'species', 1]
    )
  );
  await insertRows(
    conn,
    'INSERT INTO quadrats (QuadratID, PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, IsActive) VALUES ?',
    notInAppDbSeed(world.quadrats.values(), quadrat => quadrat.quadratId, APP_DB_SEED.quadratId).map(quadrat => [
      quadrat.quadratId,
      quadrat.plotId,
      quadrat.quadratName,
      FIXTURE_QUADRAT_GEOMETRY.startX,
      FIXTURE_QUADRAT_GEOMETRY.startY,
      FIXTURE_QUADRAT_GEOMETRY.dimensionX,
      FIXTURE_QUADRAT_GEOMETRY.dimensionY,
      FIXTURE_QUADRAT_AREA,
      1
    ]),
    []
  );
  await insertRows(
    conn,
    'INSERT INTO trees (TreeID, TreeTag, SpeciesID, CensusID, IsActive, DeletedAt) VALUES ?',
    ...partitionByDangling(
      notInAppDbSeed(world.trees.values(), tree => tree.treeId, APP_DB_SEED.treeId),
      tree => isDangling(world.species, tree.speciesId),
      tree => [tree.treeId, tree.treeTag, tree.speciesId, tree.censusId, tree.isActive ? 1 : 0, deletedAt(tree.isDeleted)]
    )
  );
  await insertRows(
    conn,
    'INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, IsActive, DeletedAt) VALUES ?',
    ...partitionByDangling(
      notInAppDbSeed(world.stems.values(), stem => stem.stemGUID, APP_DB_SEED.stemGUID),
      stem => isDangling(world.trees, stem.treeId) || isDangling(world.quadrats, stem.quadratId),
      stem => [stem.stemGUID, stem.treeId, stem.quadratId, stem.censusId, stem.stemTag, stem.isActive ? 1 : 0, deletedAt(stem.isDeleted)]
    )
  );
  await insertRows(
    conn,
    `INSERT INTO coremeasurements
       (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, IsActive,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat)
     VALUES ?`,
    ...partitionByDangling(
      measurements,
      row => isDangling(world.stems, row.stemGUID),
      row => {
        const raw = row.stemGUID === null ? `${RAW_FAILED_ROW_PREFIX}${row.coreMeasurementId}` : null;
        // MeasuredDBH = the row's ID keeps ux_measure_unique (StemGUID, CensusID, date, DBH, HOM) unique for shared stems.
        return [
          row.coreMeasurementId,
          row.censusId,
          row.stemGUID,
          row.isValidated,
          FIXTURE_MEASUREMENT_DATE,
          row.coreMeasurementId,
          FIXTURE_HOM,
          row.description,
          row.isActive ? 1 : 0,
          raw,
          raw,
          raw,
          raw
        ];
      }
    )
  );
  await insertRows(
    conn,
    'INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES ?',
    measurements.flatMap(row => row.attributeCodes.map(code => [row.coreMeasurementId, code])),
    []
  );
  await insertRows(
    conn,
    'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES ?',
    measurements.flatMap(row => row.errorLogs.map(log => [row.coreMeasurementId, log.errorId, log.isResolved ? 1 : 0])),
    []
  );
}

// ---------------------------------------------------------------------------
// Diagnostics: name the rows behind a mismatch
// ---------------------------------------------------------------------------

function describeRow(world: World, row: MeasurementRow): string {
  const { stem, tree, quadrat, species, genus } = resolveLinks(world, row);
  const states = linkStates(world, row);
  return JSON.stringify({
    id: row.coreMeasurementId,
    isValidated: row.isValidated,
    stemGUID: row.stemGUID,
    links: states,
    stem: stem && { isActive: stem.isActive, isDeleted: stem.isDeleted },
    tree: tree && { isActive: tree.isActive, isDeleted: tree.isDeleted },
    quadratNameLength: quadrat?.quadratName.length,
    speciesCode: species?.speciesCode,
    genusFamilyId: genus?.familyId,
    descriptionLength: row.description?.length ?? null,
    attributeCodes: row.attributeCodes,
    errorLogs: row.errorLogs
  });
}

/**
 * Runs `probe` once per active row of the census with every other row of that census made inactive, inside a
 * transaction that is rolled back. The probe's per-row answers are what the function under test says about each row,
 * so a count mismatch can name the rows behind it.
 */
async function probeEachActiveRow(conn: Connection, census: CensusRow, probe: () => Promise<boolean>): Promise<Map<number, boolean>> {
  const answers = new Map<number, boolean>();
  for (const row of census.measurements.filter(measurement => measurement.isActive)) {
    await conn.beginTransaction();
    try {
      await conn.query('UPDATE coremeasurements SET IsActive = 0 WHERE CensusID = ? AND CoreMeasurementID <> ?', [census.censusId, row.coreMeasurementId]);
      answers.set(row.coreMeasurementId, await probe());
    } finally {
      await conn.rollback();
    }
  }
  return answers;
}

function differingRows(world: World, census: CensusRow, modelSays: (row: MeasurementRow) => boolean, actualSays: (row: MeasurementRow) => boolean): string {
  const differing = census.measurements.filter(row => row.isActive && modelSays(row) !== actualSays(row));
  if (differing.length === 0) return '    (no single row differs: the mismatch only shows on the whole census)';
  return differing
    .slice(0, MAX_DIFFERING_ROWS_SHOWN)
    .map(row => `    model=${modelSays(row)} actual=${actualSays(row)} ${describeRow(world, row)}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

// Deliberately lying type guard, test-only: every kind name is non-empty, so it reports every kind as blocking and
// every kind's count becomes visible.
const reportsEveryKind: BlockingKindClassifier = (kind): kind is BlockingPreconditionKind => kind.length > 0;
// #545's proposed policy: the 50% rule only warns.
const treatsInsufficientRowsAsWarning: BlockingKindClassifier = (kind): kind is BlockingPreconditionKind =>
  kind !== 'insufficient-exportable-rows' && isBlockingPreconditionKind(kind);
const CLASSIFIERS: readonly { label: string; isBlocking: BlockingKindClassifier }[] = [
  { label: 'every kind blocks', isBlocking: reportsEveryKind },
  { label: 'isBlockingPreconditionKind', isBlocking: isBlockingPreconditionKind },
  { label: "#545's 50% rule as a warning", isBlocking: treatsInsufficientRowsAsWarning }
];

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

async function compareCensus(conn: Connection, schema: string, world: World, census: CensusRow): Promise<string[]> {
  const input: PreconditionInput = { schema, plotId: census.plotId, censusId: census.censusId };
  const expectation = expectCensus(world, census);
  const verdictById = new Map(census.measurements.map(row => [row.coreMeasurementId, judgeRow(world, row)]));
  const verdict = (row: MeasurementRow): RowVerdict => verdictById.get(row.coreMeasurementId) as RowVerdict;
  const context = `seed ${world.seed}, census ${census.censusId} (${census.role}, plot ${census.plotId})`;
  const mismatches: string[] = [];

  const probeCounts = async (read: (counts: PublishPreconditionCountsUnderTest) => number): Promise<Map<number, boolean>> =>
    probeEachActiveRow(conn, census, async () => read(await countPublishPreconditionsUnderTest(conn, input, reportsEveryKind)) > 0);
  const reportCountMismatch = async (
    label: string,
    expected: unknown,
    actual: unknown,
    modelSays: (row: MeasurementRow) => boolean,
    read: (counts: PublishPreconditionCountsUnderTest) => number
  ): Promise<void> => {
    const answers = await probeCounts(read);
    mismatches.push(
      `${context}, ${label}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}\n` +
        differingRows(world, census, modelSays, row => answers.get(row.coreMeasurementId) ?? false)
    );
  };

  // Party 1: the overview counts, under three classifiers.
  for (const { label, isBlocking } of CLASSIFIERS) {
    const actual = await countPublishPreconditionsUnderTest(conn, input, isBlocking);
    const blockers = expectedBlockers(expectation, isBlocking);
    if (JSON.stringify(actual.blockers) !== JSON.stringify(blockers)) {
      const reportedCount = (list: PublishBlockerCount[], kind: PreconditionFailureKind) => list.find(blocker => blocker.kind === kind)?.count ?? 0;
      const differingKinds = MODELLED_ROW_KINDS.filter(kind => reportedCount(actual.blockers, kind) !== reportedCount(blockers, kind));
      mismatches.push(`${context}, blockers under "${label}": expected ${JSON.stringify(blockers)}, actual ${JSON.stringify(actual.blockers)}`);
      for (const kind of differingKinds) {
        await reportCountMismatch(
          `${kind} under "${label}"`,
          reportedCount(blockers, kind),
          reportedCount(actual.blockers, kind),
          row => verdict(row).flags[kind],
          counts => reportedCount(counts.blockers, kind)
        );
      }
    }
    if (actual.count !== expectation.exportableCount) {
      await reportCountMismatch(
        `exportable count under "${label}"`,
        expectation.exportableCount,
        actual.count,
        row => verdict(row).exportable,
        counts => counts.count
      );
    }
    if (actual.totalActiveCount !== expectation.activeRowIds.length) {
      mismatches.push(`${context}, totalActiveCount under "${label}": expected ${expectation.activeRowIds.length}, actual ${actual.totalActiveCount}`);
    }
    const skipReasons = expectedSkipReasons(expectation);
    for (const [index, expected] of skipReasons.entries()) {
      const actualReason = actual.skipReasons[index];
      if (actualReason?.kind !== expected.kind || actualReason.count !== expected.count) {
        await reportCountMismatch(
          `skip reason ${expected.kind} under "${label}"`,
          expected,
          actualReason,
          row => !verdict(row).exportable && verdict(row).skipReasons[expected.kind],
          counts => counts.skipReasons.find(reason => reason.kind === expected.kind)?.count ?? 0
        );
      }
    }
    if (actual.skipReasons.length !== skipReasons.length) {
      mismatches.push(`${context}, skip reasons under "${label}": expected ${skipReasons.length} kinds, actual ${actual.skipReasons.length}`);
    }
  }

  // Party 2: the publish gate.
  const gate = await checkFinishedCensus(conn, input);
  const expectedReasonKinds = [
    ...MODELLED_ROW_KINDS.filter(kind => expectation.flaggedIdsByKind[kind].size > 0),
    ...(expectation.shortfallKind === null ? [] : [expectation.shortfallKind])
  ];
  const gateReasons = gate.ok ? [] : gate.reasons;
  if (gate.ok !== (expectedReasonKinds.length === 0)) mismatches.push(`${context}, gate ok: expected ${expectedReasonKinds.length === 0}, actual ${gate.ok}`);
  if (JSON.stringify(gateReasons.map(reason => reason.kind)) !== JSON.stringify(expectedReasonKinds)) {
    mismatches.push(
      `${context}, gate reason kinds: expected ${JSON.stringify(expectedReasonKinds)}, actual ${JSON.stringify(gateReasons.map(reason => reason.kind))}`
    );
  }
  if (gate.count !== expectation.exportableCount || gate.totalActiveCount !== expectation.activeRowIds.length) {
    mismatches.push(
      `${context}, gate counts: expected ${expectation.exportableCount}/${expectation.activeRowIds.length}, actual ${gate.count}/${gate.totalActiveCount}`
    );
  }
  for (const kind of MODELLED_ROW_KINDS) {
    const expectedIds = expectation.flaggedIdsByKind[kind];
    const gateIds = new Set(gateReasons.find(reason => reason.kind === kind)?.coreMeasurementIds ?? []);
    const idsMatch =
      expectedIds.size <= GATE_DISPLAY_CAP
        ? gateIds.size === expectedIds.size && [...gateIds].every(id => expectedIds.has(id))
        : gateIds.size === GATE_DISPLAY_CAP && [...gateIds].every(id => expectedIds.has(id));
    if (!idsMatch) {
      mismatches.push(
        `${context}, gate IDs for ${kind}: expected ${expectedIds.size} (cap ${GATE_DISPLAY_CAP}), actual ${gateIds.size}\n` +
          differingRows(
            world,
            census,
            row => expectedIds.has(row.coreMeasurementId),
            row => gateIds.has(row.coreMeasurementId)
          )
      );
    }
  }

  // Party 3: exported rows that still carry an unresolved error.
  const exportedWithUnresolved = await countExportedRowsWithUnresolvedErrors(conn, input);
  if (exportedWithUnresolved !== expectation.exportedWithUnresolvedErrorCount) {
    const answers = await probeEachActiveRow(conn, census, async () => (await countExportedRowsWithUnresolvedErrors(conn, input)) > 0);
    mismatches.push(
      `${context}, exported with an unresolved error: expected ${expectation.exportedWithUnresolvedErrorCount}, actual ${exportedWithUnresolved}\n` +
        differingRows(
          world,
          census,
          row => verdict(row).exportedWithUnresolvedError,
          row => answers.get(row.coreMeasurementId) ?? false
        )
    );
  }
  return mismatches;
}

function summarise(world: World, census: CensusRow): string {
  const expectation = expectCensus(world, census);
  const perKind = Object.fromEntries(MODELLED_ROW_KINDS.map(kind => [kind, expectation.flaggedIdsByKind[kind].size]));
  return (
    `${LOG_PREFIX} seed=${world.seed} census=${census.censusId} role=${census.role} plot=${census.plotId} level=${census.defectLevel} ` +
    `active=${expectation.activeRowIds.length} exportable=${expectation.exportableCount} shortfall=${expectation.shortfallKind ?? 'none'} ` +
    `flagged=${JSON.stringify(perKind)} skip=${JSON.stringify(expectation.skipReasonCounts)}`
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

function seedsUnderTest(): readonly number[] {
  const raw = process.env[SEEDS_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEEDS;
  return raw.split(SEED_LIST_SEPARATOR).map(part => {
    const seed = Number(part.trim());
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`${SEEDS_ENV} must be comma-separated non-negative integers; received '${raw}'`);
    return seed;
  });
}

describe('publish-precondition counts equal the model, the gate and each other (#557)', () => {
  beforeAll(() => {
    if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) {
      throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${DEFAULT_TEST_CONFIG.host}', not local. Aborting to avoid writing to a real database.`);
    }
  });

  it('models every row check PRECONDITION_ROW_CHECKS declares, in declaration order', () => {
    const declaredKinds = PRECONDITION_ROW_CHECKS.map(check => check.kind);
    console.log(`${LOG_PREFIX} declared kinds`, JSON.stringify(declaredKinds), 'modelled kinds', JSON.stringify(MODELLED_ROW_KINDS));
    expect(declaredKinds, 'a declared check without a model (or a model without a check) makes this test vacuous for that kind').toEqual([
      ...MODELLED_ROW_KINDS
    ]);
  });

  it('gives each witness row the verdict the spec documents', () => {
    const world = new WorldBuilder(DEFAULT_SEEDS[0]).build();
    const witness = world.censuses.find(census => census.role === 'witness') as CensusRow;
    const verdictOf = (id: number) => judgeRow(world, witness.measurements.find(row => row.coreMeasurementId === id) as MeasurementRow);
    const flaggedKinds = (id: number) => MODELLED_ROW_KINDS.filter(kind => verdictOf(id).flags[kind]);
    const skipped = (id: number) => MODELLED_SKIP_REASON_KINDS.filter(kind => verdictOf(id).skipReasons[kind]);
    console.log(
      `${LOG_PREFIX} witness verdicts`,
      JSON.stringify(Object.values(WITNESS_ROW_IDS).map(id => ({ id, flags: flaggedKinds(id), skip: skipped(id) })))
    );

    expect(flaggedKinds(WITNESS_ROW_IDS.W1a), 'W1a: the inner join to species drops the row, so no check flags it').toEqual([]);
    expect(skipped(WITNESS_ROW_IDS.W1a), 'W1a').toEqual(['missing-link']);
    expect(flaggedKinds(WITNESS_ROW_IDS.W1b), 'W1b: the inner join to quadrats drops the row from check 7').toEqual([]);
    expect(skipped(WITNESS_ROW_IDS.W1b), 'W1b').toEqual(['missing-link']);
    expect(flaggedKinds(WITNESS_ROW_IDS.W2), 'W2').toEqual(['not-validated']);
    expect(skipped(WITNESS_ROW_IDS.W2), 'W2: counted in skip:not-validated').toEqual(['not-validated']);
    expect(flaggedKinds(WITNESS_ROW_IDS.W3), 'W3: 128 characters is not over the width').toEqual([]);
    expect(verdictOf(WITNESS_ROW_IDS.W3).exportable, 'W3 is exported').toBe(true);
    expect(flaggedKinds(WITNESS_ROW_IDS.W4), 'W4: the inner join to trees drops the row from inactive-join').toEqual([]);
    expect(skipped(WITNESS_ROW_IDS.W4), 'W4').toEqual(['inactive-stem-or-tree', 'missing-link']);
    expect(flaggedKinds(WITNESS_ROW_IDS.W5), 'W5: the inner join to family drops the row from checks 6 and 7').toEqual(['not-validated']);
    expect(skipped(WITNESS_ROW_IDS.W5), 'W5: skipped as not-validated and missing-link').toEqual(['not-validated', 'missing-link']);
  });

  describe.each(seedsUnderTest().map(seed => ({ seed, world: new WorldBuilder(seed).build() })))('seed $seed', ({ seed, world }) => {
    const schema = `${SCHEMA_PREFIX}_${seed}_${process.pid}`;
    const config = { ...DEFAULT_TEST_CONFIG, database: schema };
    let conn: Connection;

    beforeAll(async () => {
      const missing = uncoveredFeatures(world);
      if (missing.length > 0) throw new Error(`generator did not cover (seed ${seed}): ${missing.join('; ')}`);
      conn = await createTestDatabase(config);
      await loadSchema(conn);
      await loadAppDbSeed(conn);
      await insertWorld(conn, world);
      const rows = world.censuses.reduce((total, census) => total + census.measurements.length, 0);
      console.log(`${LOG_PREFIX} seed=${seed} schema=${schema} censuses=${world.censuses.length} measurements=${rows}`);
    }, SETUP_HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await teardownTestDatabase(conn, config);
    }, SETUP_HOOK_TIMEOUT_MS);

    for (const census of world.censuses) {
      const expectation = expectCensus(world, census);
      it(
        `census ${census.censusId} (${census.role}, plot ${census.plotId}, ${expectation.activeRowIds.length} active, ${expectation.exportableCount} exportable)`,
        async () => {
          console.log(summarise(world, census));
          const mismatches = await compareCensus(conn, schema, world, census);
          expect(mismatches, `${mismatches.length} mismatch(es):\n${mismatches.join('\n')}`).toEqual([]);
        },
        CENSUS_TEST_TIMEOUT_MS
      );
    }
  });
});
