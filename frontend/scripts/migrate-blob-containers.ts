/**
 * Legacy Shared Blob Container Migration (F19b)
 *
 * Background
 * ----------
 * Before F19 (commit 8615a2fa) uploaded-file blobs were stored in containers
 * keyed only by plot ID and census number: `plot{id}-census{n}`. Every site
 * whose plot shared that ID wrote into the SAME container, so a single legacy
 * container can hold blobs from MULTIPLE sites (e.g. plot1-census1 holding
 * serc.csv from one schema and harvard.csv from another), with no schema
 * recorded in the blob metadata (`user`, `FormType`, `sourceformat`,
 * `FileErrorState` — none of which identifies the owning schema). Automatic
 * attribution is therefore IMPOSSIBLE in general: a human operator must decide
 * which schema each legacy BLOB belongs to.
 *
 * The OLDEST containers predate even the ID-based scheme: they are named
 * `{sanitizedPlotName}-{censusNumber}` (e.g. `cocoli-1`). That shape encodes no
 * plot ID and cannot be distinguished from arbitrary container names, so those
 * containers cannot be discovered automatically. They are migratable ONLY via
 * the explicit `--map-named`/`--map-named-container` flags, where the operator
 * names the container AND supplies the full destination scope
 * (`<schema>/<plotID>/<censusNumber>`).
 *
 * This script is deliberately dry-run-first and operator-mapped:
 *   - It NEVER guesses. The primary mapping unit is the individual blob:
 *     `--map <legacyContainer>/<blobName>=<schema>`.
 *   - `--map-container <legacyContainer>=<schema>` is an explicit homogeneity
 *     assertion: the operator states that EVERY blob in that container belongs
 *     to the given schema. A plain `--map container=schema` (no slash) is
 *     rejected so nobody gets whole-container semantics by accident.
 *   - `--map-named <container>/<blobName>=<schema>/<plotID>/<censusNumber>` and
 *     `--map-named-container <container>=<schema>/<plotID>/<censusNumber>`
 *     migrate containers whose names encode no plot ID (the plot-name scheme).
 *     The operator supplies the complete destination scope; the flags reject
 *     ID-based (`plot{id}-census{n}`) and already-schema-scoped containers so
 *     the explicit scope can never contradict a name-encoded one.
 *   - Without `--execute` it only prints the plan (zero writes). `--dry-run`
 *     is accepted as an explicit alias for that default.
 *   - Source blobs are deleted only with `--delete-source` AND only after the
 *     copy is verified successful. A failed delete after a verified copy is
 *     counted separately (`delete-failed`) and still fails the run.
 *   - Re-runs are idempotent: a destination blob that already exists is
 *     skipped, never overwritten.
 *
 * Copy mechanism
 * --------------
 * Both the legacy and the schema-scoped containers live in the SAME storage
 * account, so `beginCopyFromURL(sourceBlobClient.url)` performs a server-side
 * async copy without needing a SAS token: the operation authenticates on the
 * destination side with the account key from AZURE_STORAGE_CONNECTION_STRING
 * and Azure can read a same-account source by URL. beginCopyFromURL copies the
 * source blob's metadata by default (no metadata option supplied), so the
 * pre-F19 metadata is preserved on the destination blob.
 *
 * Usage
 * -----
 *   # Dry run (default): list every legacy container, its blobs, and the
 *   # planned destination (or UNMAPPED) with zero writes.
 *   npx tsx scripts/migrate-blob-containers.ts --dry-run \
 *     --map plot1-census1/serc.csv=forestgeo_testing
 *
 *   # Execute the copy for explicitly mapped blobs.
 *   npx tsx scripts/migrate-blob-containers.ts --execute \
 *     --map plot1-census1/serc.csv=forestgeo_testing \
 *     --map-container plot2-census1=forestgeo_other
 *
 *   # Execute and delete source blobs after a verified copy.
 *   npx tsx scripts/migrate-blob-containers.ts --execute --delete-source \
 *     --map plot1-census1/serc.csv=forestgeo_testing
 *
 *   # Migrate the oldest plot-name-based containers: their names encode no
 *   # plot ID, so the operator supplies the full destination scope.
 *   npx tsx scripts/migrate-blob-containers.ts --execute \
 *     --map-named cocoli-1/legacy.csv=forestgeo_panama/3/1 \
 *     --map-named-container luquillo-2=forestgeo_luquillo/1/2
 *
 * Deploy ordering: destination container names are deterministic, so this
 * script can (and should) be run BEFORE deploying the F19 app code — migrated
 * files are then visible the moment the new code goes live.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { BlobServiceClient, BlobClient, ContainerClient } from '@azure/storage-blob';
import { getBlobServiceClient, getContainerClient } from '@/config/macros/azurestorage';
import { getContainerName, isLegacyIdBasedContainerName, isSchemaScopedContainerName, parseLegacyIdBasedContainerName } from '@/config/macros/containernames';

// ---------------------------------------------------------------------------
// Constants (no magic strings)
// ---------------------------------------------------------------------------
export const MIGRATION_ACTION = {
  COPY: 'copy',
  REPORT_UNMAPPED: 'report-unmapped'
} as const;

export type MigrationAction = (typeof MIGRATION_ACTION)[keyof typeof MIGRATION_ACTION];

const CLI_FLAG = {
  MAP: '--map',
  MAP_CONTAINER: '--map-container',
  MAP_NAMED: '--map-named',
  MAP_NAMED_CONTAINER: '--map-named-container',
  EXECUTE: '--execute',
  DRY_RUN: '--dry-run',
  DELETE_SOURCE: '--delete-source'
} as const;

const MAP_SEPARATOR = '=';
const BLOB_PATH_SEPARATOR = '/';
const DESTINATION_SCOPE_SEPARATOR = '/';
const DESTINATION_SCOPE_SHAPE = `<schema>${DESTINATION_SCOPE_SEPARATOR}<plotID>${DESTINATION_SCOPE_SEPARATOR}<censusNumber>`;

// A successful server-side blob copy reports this copyStatus.
const COPY_STATUS_SUCCESS = 'success';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One blob in a legacy container, as discovered by the inventory pass. */
export interface BlobRef {
  container: string;
  blob: string;
}

/** Per-blob mapping (primary mode): this one blob belongs to this schema. */
export interface BlobMap {
  legacy: string;
  blob: string;
  schema: string;
}

/**
 * Whole-container mapping (explicit homogeneity opt-in via --map-container):
 * the operator asserts EVERY blob in the legacy container belongs to schema.
 */
export interface ContainerMap {
  legacy: string;
  schema: string;
}

/**
 * Full destination scope for containers whose names encode no plot ID (the
 * oldest, plot-name-based scheme). The operator supplies everything.
 */
export interface DestinationScope {
  schema: string;
  plotID: number;
  censusNumber: number;
}

/** Per-blob mapping for a plot-name-based container (via --map-named). */
export interface NamedBlobMap {
  legacy: string;
  blob: string;
  destination: DestinationScope;
}

/**
 * Whole-container homogeneity assertion for a plot-name-based container
 * (via --map-named-container).
 */
export interface NamedContainerMap {
  legacy: string;
  destination: DestinationScope;
}

export type MigrationMap = BlobMap | ContainerMap | NamedBlobMap | NamedContainerMap;

function isNamedMap(map: MigrationMap): map is NamedBlobMap | NamedContainerMap {
  return 'destination' in map;
}

function isBlobMap(map: MigrationMap): map is BlobMap {
  return 'blob' in map && !isNamedMap(map);
}

function isNamedBlobMap(map: NamedBlobMap | NamedContainerMap): map is NamedBlobMap {
  return 'blob' in map;
}

export interface MigrationPlanEntry {
  sourceContainer: string;
  sourceBlob: string;
  destinationContainer: string | null;
  action: MigrationAction;
}

export interface ParsedArgs {
  maps: MigrationMap[];
  execute: boolean;
  deleteSource: boolean;
}

export interface ExecuteOptions {
  dryRun: boolean;
  deleteSource: boolean;
}

export interface MigrationSummary {
  copied: number;
  skipped: number;
  unmapped: number;
  failed: number;
  deleteFailed: number;
}

/**
 * Injectable container-client factory. Defaults to the app's exported
 * getContainerClient; tests pass a mock so no live Azure is touched.
 */
export type ContainerClientFactory = (name: string, options?: { createIfMissing?: boolean }) => Promise<ContainerClient>;

export class MapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapConflictError';
  }
}

export class ArgumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentParseError';
  }
}

// ---------------------------------------------------------------------------
// Layer 1: pure planner
// ---------------------------------------------------------------------------

function blobKey(container: string, blob: string): string {
  return `${container}${BLOB_PATH_SEPARATOR}${blob}`;
}

/**
 * Produce a per-blob migration plan from a blob inventory and operator maps.
 *
 * - Blobs in containers that are neither legacy-ID-shaped nor explicitly
 *   targeted by a named map are excluded from the plan entirely — they are
 *   either already schema-scoped or unrelated to this migration.
 * - A blob covered by a per-blob map, or by a --map-container homogeneity
 *   assertion for its container, yields a `copy` entry whose destination is
 *   the schema-scoped name derived from the legacy container's plot/census.
 * - A blob covered by a named map (--map-named / --map-named-container) yields
 *   a `copy` entry whose destination comes entirely from the operator-supplied
 *   scope, since a plot-name-based container encodes no plot ID.
 * - Any other blob in a legacy or named-targeted container yields its own
 *   `report-unmapped` entry (destinationContainer null). It is reported,
 *   never guessed.
 *
 * Throws MapConflictError for duplicate maps of one blob, duplicate container
 * maps, or a per-blob map inside a container that also has a container map
 * (the homogeneity assertion contradicts the need for per-blob attribution).
 * Throws ArgumentParseError when a named map targets an ID-based or
 * schema-scoped container (its explicit scope could contradict the
 * name-encoded one). Propagates SchemaContainerNameError (from
 * getContainerName) when a mapped schema cannot be turned into a
 * collision-free container name — an invalid map surfaces as a planning
 * error, not a silent skip.
 */
export function planMigration(blobRefs: BlobRef[], maps: MigrationMap[]): MigrationPlanEntry[] {
  const schemaByBlobKey = new Map<string, string>();
  const schemaByContainer = new Map<string, string>();
  const blobMappedContainers = new Set<string>();
  const destinationByBlobKey = new Map<string, DestinationScope>();
  const destinationByContainer = new Map<string, DestinationScope>();
  const namedBlobMappedContainers = new Set<string>();

  for (const map of maps) {
    if (isNamedMap(map)) {
      assertNamedMapTarget(map);
      if (isNamedBlobMap(map)) {
        const key = blobKey(map.legacy, map.blob);
        if (destinationByBlobKey.has(key)) {
          throw new MapConflictError(`Duplicate ${CLI_FLAG.MAP_NAMED} for blob "${key}". Each blob may be mapped to at most one destination.`);
        }
        destinationByBlobKey.set(key, map.destination);
        namedBlobMappedContainers.add(map.legacy);
      } else {
        if (destinationByContainer.has(map.legacy)) {
          throw new MapConflictError(`Duplicate ${CLI_FLAG.MAP_NAMED_CONTAINER} for "${map.legacy}". Each container may be asserted homogeneous at most once.`);
        }
        destinationByContainer.set(map.legacy, map.destination);
      }
    } else if (isBlobMap(map)) {
      const key = blobKey(map.legacy, map.blob);
      if (schemaByBlobKey.has(key)) {
        throw new MapConflictError(`Duplicate ${CLI_FLAG.MAP} for blob "${key}". Each blob may be mapped to at most one schema.`);
      }
      schemaByBlobKey.set(key, map.schema);
      blobMappedContainers.add(map.legacy);
    } else {
      if (schemaByContainer.has(map.legacy)) {
        throw new MapConflictError(`Duplicate ${CLI_FLAG.MAP_CONTAINER} for "${map.legacy}". Each container may be asserted homogeneous at most once.`);
      }
      schemaByContainer.set(map.legacy, map.schema);
    }
  }

  for (const container of blobMappedContainers) {
    if (schemaByContainer.has(container)) {
      throw new MapConflictError(
        `Container "${container}" has both a ${CLI_FLAG.MAP_CONTAINER} homogeneity assertion and per-blob ${CLI_FLAG.MAP} entries. ` +
          'These contradict each other: either the container is homogeneous (use only --map-container) or it needs per-blob attribution (use only --map).'
      );
    }
  }

  for (const container of namedBlobMappedContainers) {
    if (destinationByContainer.has(container)) {
      throw new MapConflictError(
        `Container "${container}" has both a ${CLI_FLAG.MAP_NAMED_CONTAINER} homogeneity assertion and per-blob ${CLI_FLAG.MAP_NAMED} entries. ` +
          'These contradict each other: either the container is homogeneous (use only --map-named-container) or it needs per-blob attribution (use only --map-named).'
      );
    }
  }

  const plan: MigrationPlanEntry[] = [];
  for (const ref of blobRefs) {
    if (isLegacyIdBasedContainerName(ref.container)) {
      const mappedSchema = schemaByBlobKey.get(blobKey(ref.container, ref.blob)) ?? schemaByContainer.get(ref.container);
      if (mappedSchema === undefined) {
        plan.push({ sourceContainer: ref.container, sourceBlob: ref.blob, destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED });
        continue;
      }

      const parsed = parseLegacyIdBasedContainerName(ref.container);
      if (!parsed) {
        // isLegacyIdBasedContainerName already matched, so this is unreachable;
        // guard defensively rather than assert non-null.
        plan.push({ sourceContainer: ref.container, sourceBlob: ref.blob, destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED });
        continue;
      }

      // getContainerName throws SchemaContainerNameError for a non-injective
      // schema; let it propagate so the operator fixes the map.
      const destinationContainer = getContainerName(mappedSchema, parsed.plotID, parsed.censusNumber);
      plan.push({ sourceContainer: ref.container, sourceBlob: ref.blob, destinationContainer, action: MIGRATION_ACTION.COPY });
      continue;
    }

    // Non-ID container: only participates when the operator explicitly named it.
    if (!destinationByContainer.has(ref.container) && !namedBlobMappedContainers.has(ref.container)) {
      continue;
    }

    const destination = destinationByBlobKey.get(blobKey(ref.container, ref.blob)) ?? destinationByContainer.get(ref.container);
    if (destination === undefined) {
      plan.push({ sourceContainer: ref.container, sourceBlob: ref.blob, destinationContainer: null, action: MIGRATION_ACTION.REPORT_UNMAPPED });
      continue;
    }

    const destinationContainer = getContainerName(destination.schema, destination.plotID, destination.censusNumber);
    plan.push({ sourceContainer: ref.container, sourceBlob: ref.blob, destinationContainer, action: MIGRATION_ACTION.COPY });
  }

  return plan;
}

/**
 * Named maps exist solely for containers whose names encode no plot/census
 * (the plot-name scheme). Targeting an ID-based container would let the
 * operator-supplied scope silently contradict the name-encoded one, and a
 * schema-scoped container is a destination, not a legacy source.
 */
function assertNamedMapTarget(map: NamedBlobMap | NamedContainerMap): void {
  const flag = isNamedBlobMap(map) ? CLI_FLAG.MAP_NAMED : CLI_FLAG.MAP_NAMED_CONTAINER;
  if (isLegacyIdBasedContainerName(map.legacy)) {
    throw new ArgumentParseError(
      `${flag} targets "${map.legacy}", an ID-based legacy container whose name already encodes plot/census. ` +
        `Use ${CLI_FLAG.MAP}/${CLI_FLAG.MAP_CONTAINER} for it instead.`
    );
  }
  if (isSchemaScopedContainerName(map.legacy)) {
    throw new ArgumentParseError(`${flag} targets "${map.legacy}", which is already a schema-scoped (post-F19) container, not a legacy source.`);
  }
}

// ---------------------------------------------------------------------------
// Layer 2: effectful executor
// ---------------------------------------------------------------------------

/**
 * Execute (or dry-run) a migration plan.
 *
 * Returns a MigrationSummary; the caller maps it to a process exit code via
 * exitCodeForSummary. Per-blob failures are logged with their container/blob
 * context and counted, never swallowed; remaining blobs still process.
 *
 * Dry-run touches NOTHING on Azure: the plan already carries the full blob
 * inventory (collected before planning), so previewing needs no client at all.
 */
export async function executeMigration(
  plan: MigrationPlanEntry[],
  options: ExecuteOptions,
  getContainer: ContainerClientFactory = getContainerClient
): Promise<MigrationSummary> {
  const summary: MigrationSummary = { copied: 0, skipped: 0, unmapped: 0, failed: 0, deleteFailed: 0 };
  const containerClientCache = new Map<string, ContainerClient>();

  // Name-only cache keying is safe because legacy source names and schema-prefixed
  // destination names are disjoint shapes, so no name is ever requested with two
  // different createIfMissing values.
  async function resolveContainer(name: string, createIfMissing: boolean): Promise<ContainerClient> {
    const cached = containerClientCache.get(name);
    if (cached) {
      return cached;
    }
    const client = await getContainer(name, { createIfMissing });
    containerClientCache.set(name, client);
    return client;
  }

  for (const entry of plan) {
    if (entry.action === MIGRATION_ACTION.REPORT_UNMAPPED) {
      summary.unmapped++;
      console.warn(`UNMAPPED  ${blobKey(entry.sourceContainer, entry.sourceBlob)} — no --map/--map-container covers this blob; not migrated.`);
      continue;
    }

    // action === copy; destinationContainer is non-null by construction.
    const destinationContainerName = entry.destinationContainer as string;

    if (options.dryRun) {
      summary.copied++;
      console.log(`WOULD COPY  ${blobKey(entry.sourceContainer, entry.sourceBlob)} -> ${blobKey(destinationContainerName, entry.sourceBlob)}`);
      continue;
    }

    try {
      const sourceContainer = await resolveContainer(entry.sourceContainer, false);
      const destinationContainer = await resolveContainer(destinationContainerName, true);
      await copyOneBlob(
        entry.sourceBlob,
        entry.sourceContainer,
        destinationContainerName,
        sourceContainer,
        destinationContainer,
        options.deleteSource,
        summary
      );
    } catch (error) {
      summary.failed++;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED   ${blobKey(entry.sourceContainer, entry.sourceBlob)} -> ${blobKey(destinationContainerName, entry.sourceBlob)}: ${reason}`);
    }
  }

  return summary;
}

async function copyOneBlob(
  blobName: string,
  sourceName: string,
  destinationName: string,
  sourceContainer: ContainerClient,
  destinationContainer: ContainerClient,
  deleteSource: boolean,
  summary: MigrationSummary
): Promise<void> {
  const destinationBlob = destinationContainer.getBlockBlobClient(blobName);
  const sourceBlob = sourceContainer.getBlobClient(blobName);

  try {
    const alreadyPresent = await destinationBlob.exists();
    if (alreadyPresent) {
      // Idempotent re-run: never overwrite an existing destination blob. When
      // source deletion failed after a verified prior copy, --delete-source
      // must still be able to finish draining the legacy container.
      summary.skipped++;
      console.log(`  skip     ${blobKey(destinationName, blobName)} (already present)`);
      if (deleteSource) {
        await deleteSourceBlob(sourceBlob, sourceName, blobName, summary);
      }
      return;
    }

    const poller = await destinationBlob.beginCopyFromURL(sourceBlob.url);
    const result = await poller.pollUntilDone();

    if (result.copyStatus !== COPY_STATUS_SUCCESS) {
      summary.failed++;
      console.error(`  FAILED   ${blobKey(sourceName, blobName)} -> ${blobKey(destinationName, blobName)}: copyStatus=${result.copyStatus ?? 'unknown'}`);
      return;
    }
  } catch (error) {
    summary.failed++;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED   ${blobKey(sourceName, blobName)} -> ${blobKey(destinationName, blobName)}: ${reason}`);
    return;
  }

  summary.copied++;
  console.log(`  copied   ${blobKey(sourceName, blobName)} -> ${blobKey(destinationName, blobName)}`);

  if (!deleteSource) {
    return;
  }

  // The copy above is verified; a delete failure must NOT be conflated with a
  // copy failure (the data is safe in both places) but still fails the run so
  // the operator knows the legacy container was not fully drained.
  await deleteSourceBlob(sourceBlob, sourceName, blobName, summary);
}

async function deleteSourceBlob(sourceBlob: BlobClient, sourceName: string, blobName: string, summary: MigrationSummary): Promise<void> {
  try {
    await sourceBlob.delete();
    console.log(`  deleted  ${blobKey(sourceName, blobName)} (source)`);
  } catch (error) {
    summary.deleteFailed++;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`  DELETE FAILED (destination retained; source retained)  ${blobKey(sourceName, blobName)}: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Layer 3: thin CLI
// ---------------------------------------------------------------------------

/**
 * Parse CLI argv (already sliced past node + script path).
 * Rejects malformed --map/--map-container values and unknown flags rather
 * than ignoring them. --dry-run is an explicit alias for the default mode
 * and conflicts with --execute.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const maps: MigrationMap[] = [];
  let execute = false;
  let explicitDryRun = false;
  let deleteSource = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case CLI_FLAG.MAP: {
        maps.push(parseBlobMapValue(requireFlagValue(argv, i, CLI_FLAG.MAP, `<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}<schema>`)));
        i++;
        break;
      }
      case CLI_FLAG.MAP_CONTAINER: {
        maps.push(parseContainerMapValue(requireFlagValue(argv, i, CLI_FLAG.MAP_CONTAINER, `<legacyContainer>${MAP_SEPARATOR}<schema>`)));
        i++;
        break;
      }
      case CLI_FLAG.MAP_NAMED: {
        maps.push(
          parseNamedBlobMapValue(
            requireFlagValue(argv, i, CLI_FLAG.MAP_NAMED, `<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}`)
          )
        );
        i++;
        break;
      }
      case CLI_FLAG.MAP_NAMED_CONTAINER: {
        maps.push(
          parseNamedContainerMapValue(requireFlagValue(argv, i, CLI_FLAG.MAP_NAMED_CONTAINER, `<legacyContainer>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}`))
        );
        i++;
        break;
      }
      case CLI_FLAG.EXECUTE:
        execute = true;
        break;
      case CLI_FLAG.DRY_RUN:
        explicitDryRun = true;
        break;
      case CLI_FLAG.DELETE_SOURCE:
        deleteSource = true;
        break;
      default:
        throw new ArgumentParseError(
          `Unknown argument "${arg}". Supported flags: ${CLI_FLAG.MAP}, ${CLI_FLAG.MAP_CONTAINER}, ${CLI_FLAG.MAP_NAMED}, ${CLI_FLAG.MAP_NAMED_CONTAINER}, ${CLI_FLAG.DRY_RUN}, ${CLI_FLAG.EXECUTE}, ${CLI_FLAG.DELETE_SOURCE}.`
        );
    }
  }

  if (explicitDryRun && execute) {
    throw new ArgumentParseError(`${CLI_FLAG.DRY_RUN} and ${CLI_FLAG.EXECUTE} contradict each other; pass at most one (dry-run is already the default).`);
  }

  return { maps, execute, deleteSource };
}

function requireFlagValue(argv: string[], flagIndex: number, flag: string, expectedShape: string): string {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentParseError(`${flag} requires a "${expectedShape}" value.`);
  }
  return value;
}

function parseBlobMapValue(value: string): BlobMap {
  const separatorIndex = value.lastIndexOf(MAP_SEPARATOR);
  if (separatorIndex === -1) {
    throw new ArgumentParseError(
      `Malformed ${CLI_FLAG.MAP} value "${value}". Expected "<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}<schema>".`
    );
  }

  const target = value.slice(0, separatorIndex);
  const schema = value.slice(separatorIndex + 1);

  const pathSeparatorIndex = target.indexOf(BLOB_PATH_SEPARATOR);
  if (pathSeparatorIndex === -1) {
    throw new ArgumentParseError(
      `${CLI_FLAG.MAP} value "${value}" names a whole container, but ${CLI_FLAG.MAP} is per-blob ` +
        `("<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}<schema>"). ` +
        `To assert that EVERY blob in a legacy container belongs to one schema, use ${CLI_FLAG.MAP_CONTAINER} <legacyContainer>${MAP_SEPARATOR}<schema>.`
    );
  }

  const legacy = target.slice(0, pathSeparatorIndex);
  const blob = target.slice(pathSeparatorIndex + 1);
  if (legacy.length === 0 || blob.length === 0 || schema.length === 0) {
    throw new ArgumentParseError(`Malformed ${CLI_FLAG.MAP} value "${value}". Container, blob, and schema must all be non-empty.`);
  }

  return { legacy, blob, schema };
}

function parseDestinationScope(flag: string, raw: string): DestinationScope {
  const parts = raw.split(DESTINATION_SCOPE_SEPARATOR);
  if (parts.length !== 3) {
    throw new ArgumentParseError(`${flag} destination "${raw}" must be "${DESTINATION_SCOPE_SHAPE}".`);
  }
  const [schema, plotIDRaw, censusNumberRaw] = parts;
  if (schema.length === 0) {
    throw new ArgumentParseError(`${flag} destination "${raw}" has an empty schema.`);
  }
  const plotID = parseStrictPositiveInteger(plotIDRaw);
  const censusNumber = parseStrictPositiveInteger(censusNumberRaw);
  if (plotID === undefined || censusNumber === undefined) {
    throw new ArgumentParseError(`${flag} destination "${raw}" needs strictly positive integer plotID and censusNumber ("${DESTINATION_SCOPE_SHAPE}").`);
  }
  return { schema, plotID, censusNumber };
}

function parseStrictPositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNamedBlobMapValue(value: string): NamedBlobMap {
  const separatorIndex = value.lastIndexOf(MAP_SEPARATOR);
  if (separatorIndex === -1) {
    throw new ArgumentParseError(
      `Malformed ${CLI_FLAG.MAP_NAMED} value "${value}". Expected "<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}".`
    );
  }

  const target = value.slice(0, separatorIndex);
  const destination = parseDestinationScope(CLI_FLAG.MAP_NAMED, value.slice(separatorIndex + 1));

  const pathSeparatorIndex = target.indexOf(BLOB_PATH_SEPARATOR);
  if (pathSeparatorIndex === -1) {
    throw new ArgumentParseError(
      `${CLI_FLAG.MAP_NAMED} value "${value}" names a whole container, but ${CLI_FLAG.MAP_NAMED} is per-blob ` +
        `("<legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}"). ` +
        `To assert that EVERY blob in a named container belongs to one destination, use ${CLI_FLAG.MAP_NAMED_CONTAINER} <legacyContainer>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}.`
    );
  }

  const legacy = target.slice(0, pathSeparatorIndex);
  const blob = target.slice(pathSeparatorIndex + 1);
  if (legacy.length === 0 || blob.length === 0) {
    throw new ArgumentParseError(`Malformed ${CLI_FLAG.MAP_NAMED} value "${value}". Container and blob must both be non-empty.`);
  }

  return { legacy, blob, destination };
}

function parseNamedContainerMapValue(value: string): NamedContainerMap {
  const separatorIndex = value.lastIndexOf(MAP_SEPARATOR);
  if (separatorIndex === -1) {
    throw new ArgumentParseError(
      `Malformed ${CLI_FLAG.MAP_NAMED_CONTAINER} value "${value}". Expected "<legacyContainer>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}".`
    );
  }

  const legacy = value.slice(0, separatorIndex);
  const destination = parseDestinationScope(CLI_FLAG.MAP_NAMED_CONTAINER, value.slice(separatorIndex + 1));
  if (legacy.includes(BLOB_PATH_SEPARATOR)) {
    throw new ArgumentParseError(
      `${CLI_FLAG.MAP_NAMED_CONTAINER} value "${value}" contains a blob path, but ${CLI_FLAG.MAP_NAMED_CONTAINER} asserts a WHOLE container is homogeneous. ` +
        `For a single blob use ${CLI_FLAG.MAP_NAMED} <legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}${DESTINATION_SCOPE_SHAPE}.`
    );
  }
  if (legacy.length === 0) {
    throw new ArgumentParseError(`Malformed ${CLI_FLAG.MAP_NAMED_CONTAINER} value "${value}". Container name must be non-empty.`);
  }

  return { legacy, destination };
}

function parseContainerMapValue(value: string): ContainerMap {
  const separatorIndex = value.lastIndexOf(MAP_SEPARATOR);
  if (separatorIndex === -1) {
    throw new ArgumentParseError(`Malformed ${CLI_FLAG.MAP_CONTAINER} value "${value}". Expected "<legacyContainer>${MAP_SEPARATOR}<schema>".`);
  }

  const legacy = value.slice(0, separatorIndex);
  const schema = value.slice(separatorIndex + 1);
  if (legacy.includes(BLOB_PATH_SEPARATOR)) {
    throw new ArgumentParseError(
      `${CLI_FLAG.MAP_CONTAINER} value "${value}" contains a blob path, but ${CLI_FLAG.MAP_CONTAINER} asserts a WHOLE container is homogeneous. ` +
        `For a single blob use ${CLI_FLAG.MAP} <legacyContainer>${BLOB_PATH_SEPARATOR}<blobName>${MAP_SEPARATOR}<schema>.`
    );
  }
  if (legacy.length === 0 || schema.length === 0) {
    throw new ArgumentParseError(`Malformed ${CLI_FLAG.MAP_CONTAINER} value "${value}". Both container name and schema must be non-empty.`);
  }

  return { legacy, schema };
}

export function exitCodeForSummary(summary: MigrationSummary): number {
  return summary.failed > 0 || summary.deleteFailed > 0 ? 1 : 0;
}

/**
 * Inventory pass: list every container in the account, keep the legacy-shaped
 * ones plus any container the operator explicitly targeted with a named map,
 * and enumerate their blobs. Read-only (createIfMissing:false). A named
 * container absent from the account is warned about — a typo there would
 * otherwise read as "nothing to migrate".
 */
export async function collectLegacyBlobInventory(
  client: BlobServiceClient,
  getContainer: ContainerClientFactory = getContainerClient,
  namedContainers: ReadonlySet<string> = new Set()
): Promise<BlobRef[]> {
  const refs: BlobRef[] = [];
  const namedContainersSeen = new Set<string>();
  for await (const container of client.listContainers()) {
    const isNamedTarget = namedContainers.has(container.name);
    if (isNamedTarget) {
      namedContainersSeen.add(container.name);
    }
    if (!isLegacyIdBasedContainerName(container.name) && !isNamedTarget) {
      continue;
    }
    const containerClient = await getContainer(container.name, { createIfMissing: false });
    for await (const blob of containerClient.listBlobsFlat()) {
      refs.push({ container: container.name, blob: blob.name });
    }
  }
  for (const name of namedContainers) {
    if (!namedContainersSeen.has(name)) {
      console.warn(`NAMED CONTAINER NOT FOUND  "${name}" — no container with this name exists in the storage account; check the map for typos.`);
    }
  }
  return refs;
}

/** Containers explicitly targeted by --map-named / --map-named-container. */
export function namedContainersOf(maps: MigrationMap[]): Set<string> {
  const named = new Set<string>();
  for (const map of maps) {
    if (isNamedMap(map)) {
      named.add(map.legacy);
    }
  }
  return named;
}

async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const dryRun = !args.execute;

  console.log('='.repeat(60));
  console.log('Legacy Shared Blob Container Migration (F19b)');
  console.log(`Mode:          ${dryRun ? 'DRY RUN (no writes)' : 'EXECUTE'}`);
  console.log(`Delete source: ${args.deleteSource ? 'yes (after verified copy)' : 'no'}`);
  console.log(`Maps:${args.maps.length === 0 ? '          (none)' : ''}`);
  for (const map of args.maps) {
    if (isNamedMap(map)) {
      const destination = `${map.destination.schema}/plot${map.destination.plotID}/census${map.destination.censusNumber}`;
      if (isNamedBlobMap(map)) {
        console.log(`  named blob       ${blobKey(map.legacy, map.blob)} -> ${destination}`);
      } else {
        console.log(`  named container  ${map.legacy} -> ${destination} (operator asserts every blob in this container belongs to this destination)`);
      }
    } else if (isBlobMap(map)) {
      console.log(`  blob       ${blobKey(map.legacy, map.blob)} -> ${map.schema}`);
    } else {
      console.log(`  container  ${map.legacy} -> ${map.schema} (operator asserts every blob in this container belongs to this schema)`);
    }
  }
  console.log('='.repeat(60));

  const client = getBlobServiceClient();
  const inventory = await collectLegacyBlobInventory(client, getContainerClient, namedContainersOf(args.maps));
  const plan = planMigration(inventory, args.maps);

  console.log('\nPlan:');
  if (plan.length === 0) {
    console.log('  (no blobs found in legacy shared containers)');
  }
  for (const entry of plan) {
    if (entry.action === MIGRATION_ACTION.COPY) {
      console.log(`  [COPY]     ${blobKey(entry.sourceContainer, entry.sourceBlob)} -> ${blobKey(entry.destinationContainer as string, entry.sourceBlob)}`);
    } else {
      console.log(`  [UNMAPPED] ${blobKey(entry.sourceContainer, entry.sourceBlob)}`);
    }
  }

  console.log(`\n${dryRun ? 'Previewing' : 'Migrating'}:`);
  const summary = await executeMigration(plan, { dryRun, deleteSource: args.deleteSource });

  const copiedLabel = dryRun ? 'would-copy' : 'copied';
  console.log(
    `\n${copiedLabel}=${summary.copied} skipped=${summary.skipped} unmapped=${summary.unmapped} failed=${summary.failed} delete-failed=${summary.deleteFailed}`
  );
  process.exitCode = exitCodeForSummary(summary);
}

const invokedDirectly = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal: ${reason}`);
    process.exitCode = 1;
  });
}
