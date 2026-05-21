import { createHash } from 'node:crypto';

const SLUG_REPLACE = /[^A-Za-z0-9_]+/g;
const SLUG_MAX = 32;

// MySQL GET_LOCK names are limited to 64 chars in 5.7+; longer names silently
// truncate, which would let two exports for different censuses share a lock.
const LOCK_NAME_MAX_LEN = 64;

export interface NamingInput {
  destinationPlotId: number;
  plotCensusNumber: string;
  schema?: string;
  appCensusId?: number;
  appPlotId?: number;
}

/**
 * Build the procedure name. Includes an 8-char suffix derived from a SHA-256
 * hash of the inputs — so the body of the rendered artifact is fully
 * deterministic for the same input (spec line 347 demands byte-determinism;
 * the previous design used `crypto.randomBytes` which broke that contract).
 *
 * The hash includes the source schema so concurrent exports targeting the same
 * destination from different source schemas (spec line 413 open question)
 * produce distinct procedure names — preventing DDL collisions on
 * `DROP PROCEDURE` / `CREATE PROCEDURE`.
 */
export function buildProcedureName(opts: NamingInput): string {
  if (!Number.isInteger(opts.destinationPlotId) || opts.destinationPlotId < 0) {
    throw new Error(`destinationPlotId must be a non-negative integer; got: ${opts.destinationPlotId}`);
  }
  const slug = opts.plotCensusNumber
    .replace(SLUG_REPLACE, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX);
  if (slug.length === 0) {
    throw new Error(`PlotCensusNumber slug is empty after sanitization (input: ${JSON.stringify(opts.plotCensusNumber)})`);
  }
  return `csv_to_sql_v2_load_${opts.destinationPlotId}_${slug}_${deterministicSuffix(opts)}`;
}

export function buildLockName(opts: NamingInput): string {
  const name = `ctfs-export:${opts.destinationPlotId}:${opts.plotCensusNumber}`;
  if (name.length > LOCK_NAME_MAX_LEN) {
    throw new Error(`Lock name exceeds MySQL GET_LOCK 64-char limit (${name.length}): ${name}. ` + `Shorten the destination plot id or PlotCensusNumber.`);
  }
  return name;
}

/**
 * Deterministic 8-character hex suffix derived from a SHA-256 hash of the
 * naming inputs. Replaces the previous random suffix so the rendered SQL body
 * is byte-identical for the same input.
 */
export function deterministicSuffix(opts: NamingInput): string {
  const material = JSON.stringify({
    destinationPlotId: opts.destinationPlotId,
    plotCensusNumber: opts.plotCensusNumber,
    schema: opts.schema ?? '',
    appCensusId: opts.appCensusId ?? null,
    appPlotId: opts.appPlotId ?? null
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}
