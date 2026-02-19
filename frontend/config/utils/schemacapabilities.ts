/**
 * Schema Capabilities
 *
 * Detects and caches per-schema feature availability (e.g., whether the
 * upload_errors table or ingest_measurements procedure exist).
 *
 * Checks information_schema once per schema per process lifetime, avoiding
 * exception-based detection on every request.
 */

import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

export interface SchemaCapabilities {
  hasUploadErrors: boolean;
  hasIngestMeasurements: boolean;
  hasValidateMeasurements: boolean;
}

const capabilitiesCache = new Map<string, SchemaCapabilities>();

/**
 * Queries information_schema to detect which migration-dependent objects
 * exist in the given schema. Results are cached for the process lifetime.
 *
 * Call `clearSchemaCapabilities(schema)` after running a migration to
 * force re-detection.
 */
export async function getSchemaCapabilities(schema: string): Promise<SchemaCapabilities> {
  const cached = capabilitiesCache.get(schema);
  if (cached) return cached;

  const connectionManager = ConnectionManager.getInstance();

  const [tableResult, procResult] = await Promise.all([
    connectionManager.executeQuery(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'upload_errors'`,
      [schema]
    ),
    connectionManager.executeQuery(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = ? AND routine_name IN ('ingest_measurements', 'validate_measurements')`,
      [schema]
    )
  ]);

  const procedureNames = new Set(procResult.map((row: any) => row.routine_name ?? row.ROUTINE_NAME));

  const capabilities: SchemaCapabilities = {
    hasUploadErrors: tableResult.length > 0,
    hasIngestMeasurements: procedureNames.has('ingest_measurements'),
    hasValidateMeasurements: procedureNames.has('validate_measurements')
  };

  ailogger.info(
    `Schema capabilities for ${schema}: ` +
      `upload_errors=${capabilities.hasUploadErrors}, ` +
      `ingest_measurements=${capabilities.hasIngestMeasurements}, ` +
      `validate_measurements=${capabilities.hasValidateMeasurements}`
  );

  capabilitiesCache.set(schema, capabilities);
  return capabilities;
}

export function clearSchemaCapabilities(schema?: string): void {
  if (schema) {
    capabilitiesCache.delete(schema);
  } else {
    capabilitiesCache.clear();
  }
}
