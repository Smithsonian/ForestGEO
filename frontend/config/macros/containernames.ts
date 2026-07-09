/**
 * Container Naming Utilities for Azure Storage
 *
 * Provides schema-scoped container names for uploaded-file storage.
 *
 * F19 (data isolation): container names are keyed by the site's MySQL schema in
 * addition to plot ID and census number:
 *
 *   {sanitizedSchema}-plot{plotID}-census{censusNumber}
 *
 * Without the schema component, every site whose plot shares an ID collides into
 * the same Azure container and can list/download/delete another site's files.
 *
 * The `getLegacy*` helpers reproduce the pre-F19 shared naming schemes. They are
 * MIGRATION-ONLY: they exist so an operator-driven migration script can locate
 * the old shared containers and copy their blobs into the correct schema-scoped
 * container. They MUST NOT appear in any user-facing read/write path.
 */

// Azure Storage container naming rules
// https://learn.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata
const AZURE_CONTAINER_NAME_MIN_LENGTH = 3;
const AZURE_CONTAINER_NAME_MAX_LENGTH = 63;

/**
 * Thrown when a schema cannot be mapped to an Azure container name without
 * risking a collision with another schema's container. Fail-closed: schemas
 * that would need lossy sanitization (collapsing, trimming, stripping,
 * truncating) are rejected instead of silently colliding.
 */
export class SchemaContainerNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaContainerNameError';
  }
}

/**
 * The only schema shape that maps INJECTIVELY onto an Azure container prefix:
 * lowercase alphanumeric segments separated by single underscores. Under this
 * shape `_` -> `-` is a bijection, so two distinct schemas can never share a
 * container prefix. Anything else (consecutive/leading/trailing underscores,
 * uppercase, other characters) would need lossy collapsing/trimming/stripping
 * — the exact source of silent cross-schema container collisions — and is
 * rejected.
 *
 * NOTE: this is deliberately STRICTLY NARROWER than VALID_SCHEMA_PATTERN in
 * lib/db/sqlsecurity.ts (which admits e.g. `forestgeo__x`). Such a schema can
 * use the rest of the app, but its file operations are rejected with a 400.
 * A drift-guard test in containernames.test.ts asserts every KNOWN_SCHEMAS
 * entry passes getContainerName.
 */
const INJECTIVE_SCHEMA_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function sanitizeSchemaForContainer(schema: string): string {
  if (!INJECTIVE_SCHEMA_PATTERN.test(schema)) {
    throw new SchemaContainerNameError(
      `Schema "${schema}" cannot be mapped to a collision-free container prefix. ` +
        'Schemas must be lowercase alphanumeric segments separated by single underscores ' +
        '(no leading/trailing/consecutive underscores, no other characters).'
    );
  }
  return schema.replace(/_/g, '-');
}

/**
 * Sanitize a plot name to meet Azure container naming requirements.
 * Used only by the legacy plot-name container generator.
 * - Lowercase only
 * - Replace spaces and special chars with hyphens
 * - Remove consecutive hyphens
 * - Ensure doesn't start/end with hyphen
 */
function sanitizePlotNameForContainer(plotName: string): string {
  return plotName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace invalid chars with hyphen
    .replace(/-+/g, '-') // Remove consecutive hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Generate the schema-scoped container name for a site's plot/census files.
 *
 * Format: {sanitizedSchema}-plot{plotID}-census{censusNumber}
 * Example: getContainerName('forestgeo_testing', 1, 1) -> 'forestgeo-testing-plot1-census1'
 *
 * Fail-closed: schemas that cannot be mapped injectively (see
 * INJECTIVE_SCHEMA_PATTERN) or whose combined name would exceed Azure's
 * 63-character limit throw SchemaContainerNameError instead of being
 * collapsed/trimmed/truncated into a name another schema could also produce.
 *
 * @param schema - The site's MySQL schema name (validated upstream by isValidSchema)
 * @param plotID - The unique plot identifier
 * @param censusNumber - The census number
 * @returns Schema-scoped container name
 * @throws SchemaContainerNameError if the schema cannot be mapped collision-free
 * @throws Error if plotID/censusNumber are invalid
 */
export function getContainerName(schema: string, plotID: number, censusNumber: number): string {
  if (!plotID || plotID <= 0) {
    throw new Error(`Invalid plotID: ${plotID}. Must be a positive number.`);
  }
  if (!censusNumber || censusNumber <= 0) {
    throw new Error(`Invalid censusNumber: ${censusNumber}. Must be a positive number.`);
  }

  const sanitizedSchema = sanitizeSchemaForContainer(schema);
  const containerName = `${sanitizedSchema}-plot${plotID}-census${censusNumber}`;

  if (containerName.length > AZURE_CONTAINER_NAME_MAX_LENGTH) {
    throw new SchemaContainerNameError(
      `Container name "${containerName}" exceeds the ${AZURE_CONTAINER_NAME_MAX_LENGTH}-character Azure limit; ` +
        `refusing to truncate schema "${schema}" because truncation could collide with another schema's container.`
    );
  }

  if (!validateContainerName(containerName)) {
    throw new Error(`Generated container name "${containerName}" is invalid`);
  }

  return containerName;
}

/**
 * MIGRATION-ONLY: reproduce the pre-F19 shared, ID-based container name.
 *
 * Format: plot{plotID}-census{censusNumber}
 *
 * These containers are shared across every site whose plot has this ID, so they
 * MUST NOT be read from or written to by user-facing operations. The migration
 * script (scripts/migrate-blob-containers.ts) locates legacy containers with
 * isLegacyIdBasedContainerName / parseLegacyIdBasedContainerName rather than
 * generating names with this helper; it is retained for tests and reference.
 */
export function getLegacyIdBasedContainerName(plotID: number, censusNumber: number): string {
  if (!plotID || plotID <= 0) {
    throw new Error(`Invalid plotID: ${plotID}. Must be a positive number.`);
  }
  if (!censusNumber || censusNumber <= 0) {
    throw new Error(`Invalid censusNumber: ${censusNumber}. Must be a positive number.`);
  }

  const containerName = `plot${plotID}-census${censusNumber}`;
  if (!validateContainerName(containerName)) {
    throw new Error(`Generated container name "${containerName}" is invalid`);
  }

  return containerName;
}

/**
 * MIGRATION-ONLY: reproduce the oldest, plot-name-based container name.
 *
 * Format: {sanitizedPlotName}-{censusNumber}
 *
 * Shared across sites reusing the same plot name; MUST NOT be used by
 * user-facing operations. Plot-name-based containers are OUT OF SCOPE of the
 * migration script (scripts/migrate-blob-containers.ts): their
 * `{sanitizedPlotName}-{censusNumber}` shape has no reliable pattern to
 * distinguish it from arbitrary container names, so they cannot be detected
 * automatically. This helper is retained for tests and reference only.
 */
export function getLegacyPlotNameContainerName(plotName: string, censusNumber: number): string {
  if (!plotName || plotName.trim() === '') {
    throw new Error('Invalid plotName: cannot be empty');
  }
  if (!censusNumber || censusNumber <= 0) {
    throw new Error(`Invalid censusNumber: ${censusNumber}. Must be a positive number.`);
  }

  const sanitized = sanitizePlotNameForContainer(plotName.trim());
  return `${sanitized}-${censusNumber}`;
}

/**
 * Validate a container name meets Azure Storage requirements:
 * - 3-63 characters long
 * - only lowercase letters, numbers, and hyphens
 * - starts and ends with a letter or number
 * - no consecutive hyphens
 */
export function validateContainerName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  if (name.length < AZURE_CONTAINER_NAME_MIN_LENGTH || name.length > AZURE_CONTAINER_NAME_MAX_LENGTH) {
    return false;
  }

  const validPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  if (!validPattern.test(name)) {
    return false;
  }

  if (name.includes('--')) {
    return false;
  }

  return true;
}

/**
 * Parse a schema-scoped container name into its components.
 *
 * `schemaPrefix` is the SANITIZED container prefix (e.g. `forestgeo-testing`),
 * not the MySQL schema name. Because INJECTIVE_SCHEMA_PATTERN forbids hyphens
 * in schemas, every hyphen in the prefix came from an underscore, so the
 * MySQL schema is recoverable as `schemaPrefix.replace(/-/g, '_')`.
 *
 * @param containerName - Name in the form {schemaPrefix}-plot{plotID}-census{censusNumber}
 * @returns { schemaPrefix, plotID, censusNumber } or null if it is not schema-scoped
 */
export function parseContainerName(containerName: string): { schemaPrefix: string; plotID: number; censusNumber: number } | null {
  const match = containerName.match(/^([a-z0-9-]+)-plot(\d+)-census(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    schemaPrefix: match[1],
    plotID: parseInt(match[2], 10),
    censusNumber: parseInt(match[3], 10)
  };
}

/**
 * MIGRATION-ONLY: parse a pre-F19 shared ID-based container name.
 *
 * @param containerName - Name in the form plot{plotID}-census{censusNumber}
 * @returns { plotID, censusNumber } or null if it is not legacy ID-based
 */
export function parseLegacyIdBasedContainerName(containerName: string): { plotID: number; censusNumber: number } | null {
  const match = containerName.match(/^plot(\d+)-census(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    plotID: parseInt(match[1], 10),
    censusNumber: parseInt(match[2], 10)
  };
}

/**
 * Check whether a container name uses the schema-scoped (F19) format.
 */
export function isSchemaScopedContainerName(containerName: string): boolean {
  return /^[a-z0-9-]+-plot\d+-census\d+$/.test(containerName) && validateContainerName(containerName);
}

/**
 * MIGRATION-ONLY: check whether a container name is a pre-F19 shared ID-based name.
 */
export function isLegacyIdBasedContainerName(containerName: string): boolean {
  return /^plot\d+-census\d+$/.test(containerName);
}
