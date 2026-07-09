/**
 * Unit tests for the legacy shared blob container migration script (F19b).
 *
 * All four layers are covered WITHOUT a live Azure connection:
 *   - planMigration: pure function (no mocks needed)
 *   - parseArgs / exitCodeForSummary: pure functions
 *   - executeMigration: injected mock ContainerClientFactory (zero network)
 *   - collectLegacyBlobInventory: mock BlobServiceClient + mock factory
 *
 * Tests are intentionally verbose so a failure names exactly which contract
 * (per-blob attribution, idempotency, dry-run-no-writes,
 * delete-only-after-verified-copy, delete-failure accounting, ...) broke.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BlobServiceClient } from '@azure/storage-blob';
import { SchemaContainerNameError } from '@/config/macros/containernames';
import {
  planMigration,
  parseArgs,
  executeMigration,
  exitCodeForSummary,
  collectLegacyBlobInventory,
  MIGRATION_ACTION,
  ArgumentParseError,
  MapConflictError,
  type ContainerClientFactory,
  type MigrationPlanEntry,
  type MigrationSummary
} from './migrate-blob-containers';

const SCHEMA_TESTING = 'forestgeo_testing';
const SCHEMA_OTHER = 'forestgeo_other';
const LEGACY_PLOT1 = 'plot1-census1';
const LEGACY_PLOT2 = 'plot2-census1';
const SCHEMA_SCOPED_PLOT1 = 'forestgeo-testing-plot1-census1';
const COPY_STATUS_SUCCESS = 'success';
const COPY_STATUS_FAILED = 'failed';

function summaryOf(partial: Partial<MigrationSummary>): MigrationSummary {
  return { copied: 0, skipped: 0, unmapped: 0, failed: 0, deleteFailed: 0, ...partial };
}

// ---------------------------------------------------------------------------
// Layer 1: planMigration (pure)
// ---------------------------------------------------------------------------
describe('planMigration', () => {
  it('plans schema-scoped destinations only for explicitly mapped blobs', () => {
    const plan = planMigration(
      [
        { container: LEGACY_PLOT1, blob: 'serc.csv' },
        { container: LEGACY_PLOT1, blob: 'harvard.csv' }
      ],
      [{ legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_TESTING }]
    );
    expect(plan).toEqual([
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'serc.csv', destinationContainer: SCHEMA_SCOPED_PLOT1, action: MIGRATION_ACTION.COPY },
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'harvard.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED }
    ]);
  });

  it('maps every blob of a container under a whole-container homogeneity assertion', () => {
    const plan = planMigration(
      [
        { container: LEGACY_PLOT1, blob: 'a.csv' },
        { container: LEGACY_PLOT1, blob: 'b.csv' },
        { container: LEGACY_PLOT2, blob: 'c.csv' }
      ],
      [{ legacy: LEGACY_PLOT1, schema: SCHEMA_TESTING }]
    );
    expect(plan).toEqual([
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'a.csv', destinationContainer: SCHEMA_SCOPED_PLOT1, action: MIGRATION_ACTION.COPY },
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'b.csv', destinationContainer: SCHEMA_SCOPED_PLOT1, action: MIGRATION_ACTION.COPY },
      { sourceContainer: LEGACY_PLOT2, sourceBlob: 'c.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED }
    ]);
  });

  it('excludes blobs in non-legacy containers from the plan entirely', () => {
    const plan = planMigration(
      [
        { container: 'forestgeo-testing-plot9-census2', blob: 'scoped.csv' },
        { container: 'some-unrelated-container', blob: 'noise.txt' },
        { container: LEGACY_PLOT1, blob: 'serc.csv' }
      ],
      [{ legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_TESTING }]
    );
    expect(plan).toEqual([{ sourceContainer: LEGACY_PLOT1, sourceBlob: 'serc.csv', destinationContainer: SCHEMA_SCOPED_PLOT1, action: MIGRATION_ACTION.COPY }]);
  });

  it('surfaces an invalid mapped schema as a planning error rather than silently skipping', () => {
    // Double underscore is a valid MySQL schema but NOT injective onto a
    // container prefix, so getContainerName throws SchemaContainerNameError.
    expect(() =>
      planMigration([{ container: LEGACY_PLOT1, blob: 'serc.csv' }], [{ legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: 'forestgeo__testing' }])
    ).toThrow(SchemaContainerNameError);
  });

  it('rejects duplicate per-blob maps for the same blob', () => {
    expect(() =>
      planMigration(
        [{ container: LEGACY_PLOT1, blob: 'serc.csv' }],
        [
          { legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_TESTING },
          { legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_OTHER }
        ]
      )
    ).toThrow(MapConflictError);
  });

  it('rejects duplicate whole-container maps for the same container', () => {
    expect(() =>
      planMigration(
        [{ container: LEGACY_PLOT1, blob: 'serc.csv' }],
        [
          { legacy: LEGACY_PLOT1, schema: SCHEMA_TESTING },
          { legacy: LEGACY_PLOT1, schema: SCHEMA_OTHER }
        ]
      )
    ).toThrow(MapConflictError);
  });

  it('rejects a per-blob map inside a container that also has a homogeneity assertion', () => {
    expect(() =>
      planMigration(
        [{ container: LEGACY_PLOT1, blob: 'serc.csv' }],
        [
          { legacy: LEGACY_PLOT1, schema: SCHEMA_TESTING },
          { legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_TESTING }
        ]
      )
    ).toThrow(MapConflictError);
  });

  it('reports each legacy blob individually as unmapped when no map covers it', () => {
    const plan = planMigration(
      [
        { container: LEGACY_PLOT1, blob: 'serc.csv' },
        { container: LEGACY_PLOT1, blob: 'harvard.csv' }
      ],
      []
    );
    expect(plan).toEqual([
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'serc.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED },
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'harvard.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED }
    ]);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 helpers: parseArgs / exitCodeForSummary (pure)
// ---------------------------------------------------------------------------
describe('parseArgs', () => {
  it('parses repeatable per-blob maps plus execute and delete-source flags', () => {
    const parsed = parseArgs([
      '--map',
      `${LEGACY_PLOT1}/serc.csv=${SCHEMA_TESTING}`,
      '--map',
      `${LEGACY_PLOT2}/other.csv=${SCHEMA_OTHER}`,
      '--execute',
      '--delete-source'
    ]);

    expect(parsed).toEqual({
      maps: [
        { legacy: LEGACY_PLOT1, blob: 'serc.csv', schema: SCHEMA_TESTING },
        { legacy: LEGACY_PLOT2, blob: 'other.csv', schema: SCHEMA_OTHER }
      ],
      execute: true,
      deleteSource: true
    });
  });

  it('parses --map-container into a whole-container homogeneity map', () => {
    const parsed = parseArgs(['--map-container', `${LEGACY_PLOT1}=${SCHEMA_TESTING}`]);
    expect(parsed.maps).toEqual([{ legacy: LEGACY_PLOT1, schema: SCHEMA_TESTING }]);
  });

  it('parses per-blob maps whose blob names contain slashes', () => {
    const parsed = parseArgs(['--map', `${LEGACY_PLOT1}/nested/path.csv=${SCHEMA_TESTING}`]);
    expect(parsed.maps).toEqual([{ legacy: LEGACY_PLOT1, blob: 'nested/path.csv', schema: SCHEMA_TESTING }]);
  });

  it('parses per-blob maps whose blob names contain "=" (schema split at the LAST separator)', () => {
    const parsed = parseArgs(['--map', `${LEGACY_PLOT1}/report=v2.csv=${SCHEMA_TESTING}`]);
    expect(parsed.maps).toEqual([{ legacy: LEGACY_PLOT1, blob: 'report=v2.csv', schema: SCHEMA_TESTING }]);
  });

  it('defaults to dry-run (execute false) when --execute is absent', () => {
    const parsed = parseArgs(['--map', `${LEGACY_PLOT1}/serc.csv=${SCHEMA_TESTING}`]);
    expect(parsed.execute).toBe(false);
    expect(parsed.deleteSource).toBe(false);
  });

  it('accepts --dry-run as an explicit no-op alias for the default mode', () => {
    const parsed = parseArgs(['--dry-run', '--map', `${LEGACY_PLOT1}/serc.csv=${SCHEMA_TESTING}`]);
    expect(parsed.execute).toBe(false);
  });

  it('rejects --dry-run combined with --execute', () => {
    expect(() => parseArgs(['--dry-run', '--execute'])).toThrow(ArgumentParseError);
  });

  it('rejects a whole-container --map (no slash) and points the operator at --map-container', () => {
    expect(() => parseArgs(['--map', `${LEGACY_PLOT1}=${SCHEMA_TESTING}`])).toThrow(ArgumentParseError);
    expect(() => parseArgs(['--map', `${LEGACY_PLOT1}=${SCHEMA_TESTING}`])).toThrow(/--map-container/);
  });

  it('rejects a --map-container value containing a blob path', () => {
    expect(() => parseArgs(['--map-container', `${LEGACY_PLOT1}/serc.csv=${SCHEMA_TESTING}`])).toThrow(ArgumentParseError);
  });

  it('rejects a --map value without a schema separator', () => {
    expect(() => parseArgs(['--map', `${LEGACY_PLOT1}/serc.csv`])).toThrow(ArgumentParseError);
  });

  it('rejects a --map value with an empty schema', () => {
    expect(() => parseArgs(['--map', `${LEGACY_PLOT1}/serc.csv=`])).toThrow(ArgumentParseError);
  });

  it('rejects a --map flag with no following value', () => {
    expect(() => parseArgs(['--map'])).toThrow(ArgumentParseError);
  });

  it('rejects a --map flag immediately followed by another flag', () => {
    expect(() => parseArgs(['--map', '--execute'])).toThrow(ArgumentParseError);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--force'])).toThrow(ArgumentParseError);
  });
});

describe('exitCodeForSummary', () => {
  it('returns 0 when nothing failed', () => {
    expect(exitCodeForSummary(summaryOf({ copied: 3, skipped: 1, unmapped: 2 }))).toBe(0);
  });

  it('returns 1 when any blob copy failed', () => {
    expect(exitCodeForSummary(summaryOf({ copied: 3, failed: 1 }))).toBe(1);
  });

  it('returns 1 when any source delete failed after a verified copy', () => {
    expect(exitCodeForSummary(summaryOf({ copied: 3, deleteFailed: 1 }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: executeMigration (mocked Azure)
// ---------------------------------------------------------------------------

interface MockBlobStorage {
  factory: ContainerClientFactory;
  factoryCalls: { name: string; createIfMissing: boolean | undefined }[];
  beginCopyCalls: { destination: string; blobName: string; sourceUrl: string }[];
  deletedSourceBlobs: string[];
}

const STORAGE_ACCOUNT_BASE = 'https://acct.blob.core.windows.net';

/**
 * Build an in-memory mock of the Azure blob layer for the executor. The
 * per-blob plan drives which blobs are touched; the mock records every call.
 */
function makeMockStorage(config: {
  source: string;
  destination: string;
  destExistingBlobs?: string[];
  copyStatus?: string;
  copyThrows?: boolean;
  deleteThrows?: boolean;
}): MockBlobStorage {
  const destExisting = new Set(config.destExistingBlobs ?? []);
  const factoryCalls: MockBlobStorage['factoryCalls'] = [];
  const beginCopyCalls: MockBlobStorage['beginCopyCalls'] = [];
  const deletedSourceBlobs: string[] = [];

  const sourceContainer = {
    getBlobClient(blobName: string) {
      return {
        url: `${STORAGE_ACCOUNT_BASE}/${config.source}/${blobName}`,
        delete: vi.fn(async () => {
          if (config.deleteThrows) {
            throw new Error(`simulated delete failure for ${blobName}`);
          }
          deletedSourceBlobs.push(blobName);
        })
      };
    }
  };

  const destinationContainer = {
    getBlockBlobClient(blobName: string) {
      return {
        exists: vi.fn(async () => destExisting.has(blobName)),
        beginCopyFromURL: vi.fn(async (sourceUrl: string) => {
          beginCopyCalls.push({ destination: config.destination, blobName, sourceUrl });
          return {
            pollUntilDone: async () => {
              if (config.copyThrows) {
                throw new Error(`simulated copy failure for ${blobName}`);
              }
              return { copyStatus: config.copyStatus ?? COPY_STATUS_SUCCESS };
            }
          };
        })
      };
    }
  };

  const factory = vi.fn(async (name: string, options?: { createIfMissing?: boolean }) => {
    factoryCalls.push({ name, createIfMissing: options?.createIfMissing });
    if (name === config.destination) {
      return destinationContainer as unknown as Awaited<ReturnType<ContainerClientFactory>>;
    }
    return sourceContainer as unknown as Awaited<ReturnType<ContainerClientFactory>>;
  }) as unknown as ContainerClientFactory;

  return { factory, factoryCalls, beginCopyCalls, deletedSourceBlobs };
}

function copyPlan(...blobNames: string[]): MigrationPlanEntry[] {
  return blobNames.map(blobName => ({
    sourceContainer: LEGACY_PLOT1,
    sourceBlob: blobName,
    destinationContainer: SCHEMA_SCOPED_PLOT1,
    action: MIGRATION_ACTION.COPY
  }));
}

describe('executeMigration', () => {
  it('performs zero Azure calls in dry-run: no client fetch, create, copy, or delete', async () => {
    const storage = makeMockStorage({ source: LEGACY_PLOT1, destination: SCHEMA_SCOPED_PLOT1 });

    const summary = await executeMigration(copyPlan('a.csv', 'b.csv'), { dryRun: true, deleteSource: false }, storage.factory);

    expect(summary).toEqual(summaryOf({ copied: 2 }));
    expect(storage.factoryCalls).toHaveLength(0);
    expect(storage.beginCopyCalls).toHaveLength(0);
    expect(storage.deletedSourceBlobs).toHaveLength(0);
  });

  it('copies each planned blob from its source URL when executing', async () => {
    const storage = makeMockStorage({ source: LEGACY_PLOT1, destination: SCHEMA_SCOPED_PLOT1 });

    const summary = await executeMigration(copyPlan('a.csv'), { dryRun: false, deleteSource: false }, storage.factory);

    expect(summary).toEqual(summaryOf({ copied: 1 }));
    expect(storage.beginCopyCalls).toEqual([
      {
        destination: SCHEMA_SCOPED_PLOT1,
        blobName: 'a.csv',
        sourceUrl: `${STORAGE_ACCOUNT_BASE}/${LEGACY_PLOT1}/a.csv`
      }
    ]);
    // Destination container is ensured to exist before copying.
    expect(storage.factoryCalls).toContainEqual({ name: SCHEMA_SCOPED_PLOT1, createIfMissing: true });
    // Source container is only ever opened read-only.
    expect(storage.factoryCalls).toContainEqual({ name: LEGACY_PLOT1, createIfMissing: false });
  });

  it('deletes the source blob only when deleteSource is set and the copy succeeded', async () => {
    const withDelete = makeMockStorage({ source: LEGACY_PLOT1, destination: SCHEMA_SCOPED_PLOT1 });
    await executeMigration(copyPlan('a.csv'), { dryRun: false, deleteSource: true }, withDelete.factory);
    expect(withDelete.deletedSourceBlobs).toEqual(['a.csv']);

    const withoutDelete = makeMockStorage({ source: LEGACY_PLOT1, destination: SCHEMA_SCOPED_PLOT1 });
    await executeMigration(copyPlan('a.csv'), { dryRun: false, deleteSource: false }, withoutDelete.factory);
    expect(withoutDelete.deletedSourceBlobs).toEqual([]);
  });

  it('never deletes the source blob when the copy did not succeed', async () => {
    const storage = makeMockStorage({
      source: LEGACY_PLOT1,
      destination: SCHEMA_SCOPED_PLOT1,
      copyStatus: COPY_STATUS_FAILED
    });

    const summary = await executeMigration(copyPlan('a.csv'), { dryRun: false, deleteSource: true }, storage.factory);

    expect(summary).toEqual(summaryOf({ failed: 1 }));
    expect(storage.deletedSourceBlobs).toEqual([]);
  });

  it('counts a failed source delete after a verified copy as deleteFailed, not failed, without double-counting copied', async () => {
    const storage = makeMockStorage({ source: LEGACY_PLOT1, destination: SCHEMA_SCOPED_PLOT1, deleteThrows: true });

    const summary = await executeMigration(copyPlan('a.csv'), { dryRun: false, deleteSource: true }, storage.factory);

    expect(summary).toEqual(summaryOf({ copied: 1, deleteFailed: 1 }));
    expect(exitCodeForSummary(summary)).toBe(1);
  });

  it('skips existing destination blobs without overwriting them (idempotent re-run)', async () => {
    // Asymmetric on purpose: 3 source blobs, 1 already present -> 2 copied, 1 skipped.
    const storage = makeMockStorage({
      source: LEGACY_PLOT1,
      destination: SCHEMA_SCOPED_PLOT1,
      destExistingBlobs: ['a.csv']
    });

    const summary = await executeMigration(copyPlan('a.csv', 'b.csv', 'c.csv'), { dryRun: false, deleteSource: false }, storage.factory);

    expect(summary).toEqual(summaryOf({ copied: 2, skipped: 1 }));
    // Only the not-yet-present blobs are copied; the existing one is left alone.
    expect(storage.beginCopyCalls.map(c => c.blobName)).toEqual(['b.csv', 'c.csv']);
  });

  it('counts a thrown copy poll as failed and continues with remaining blobs', async () => {
    const storage = makeMockStorage({
      source: LEGACY_PLOT1,
      destination: SCHEMA_SCOPED_PLOT1,
      copyThrows: true
    });

    const summary = await executeMigration(copyPlan('a.csv', 'b.csv'), { dryRun: false, deleteSource: false }, storage.factory);

    expect(summary).toEqual(summaryOf({ failed: 2 }));
    // Both blobs were attempted despite the first failure.
    expect(storage.beginCopyCalls.map(c => c.blobName)).toEqual(['a.csv', 'b.csv']);
    expect(exitCodeForSummary(summary)).toBe(1);
  });

  it('counts report-unmapped plan entries per blob without touching Azure', async () => {
    const unmappedPlan: MigrationPlanEntry[] = [
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'serc.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED },
      { sourceContainer: LEGACY_PLOT1, sourceBlob: 'harvard.csv', destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED }
    ];
    const factory = vi.fn() as unknown as ContainerClientFactory;

    const summary = await executeMigration(unmappedPlan, { dryRun: false, deleteSource: false }, factory);

    expect(summary).toEqual(summaryOf({ unmapped: 2 }));
    expect(factory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Inventory: collectLegacyBlobInventory (mocked Azure)
// ---------------------------------------------------------------------------
describe('collectLegacyBlobInventory', () => {
  function makeMockServiceClient(containerBlobs: Record<string, string[]>): {
    client: BlobServiceClient;
    factory: ContainerClientFactory;
    factoryCalls: string[];
  } {
    const factoryCalls: string[] = [];

    const client = {
      listContainers: async function* () {
        for (const name of Object.keys(containerBlobs)) {
          yield { name };
        }
      }
    } as unknown as BlobServiceClient;

    const factory = vi.fn(async (name: string) => {
      factoryCalls.push(name);
      return {
        listBlobsFlat: async function* () {
          for (const blobName of containerBlobs[name]) {
            yield { name: blobName };
          }
        }
      } as unknown as Awaited<ReturnType<ContainerClientFactory>>;
    }) as unknown as ContainerClientFactory;

    return { client, factory, factoryCalls };
  }

  it('enumerates blobs of legacy containers only, skipping schema-scoped and unrelated containers', async () => {
    const { client, factory, factoryCalls } = makeMockServiceClient({
      [LEGACY_PLOT1]: ['serc.csv', 'harvard.csv'],
      [SCHEMA_SCOPED_PLOT1]: ['already-migrated.csv'],
      'unrelated-container': ['noise.txt'],
      [LEGACY_PLOT2]: []
    });

    const inventory = await collectLegacyBlobInventory(client, factory);

    expect(inventory).toEqual([
      { container: LEGACY_PLOT1, blob: 'serc.csv' },
      { container: LEGACY_PLOT1, blob: 'harvard.csv' }
    ]);
    // Non-legacy containers are never even opened.
    expect(factoryCalls).toEqual([LEGACY_PLOT1, LEGACY_PLOT2]);
  });
});
