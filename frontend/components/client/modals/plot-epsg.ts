import { EPSG_CODE_MAX, EPSG_CODE_MIN } from '@/config/macros';

export type EpsgParseResult = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Parses the plot-edit EPSG input for saving. Blank means "not recorded" and
 * becomes an explicit null — JSON.stringify drops undefined keys and the PATCH
 * handler only updates columns present in the payload, so null is the only value
 * that actually clears a stored code. Geographic codes (e.g. 4326) are
 * deliberately accepted here, unlike in provisioning input: legacy plots whose
 * stored coordinates already are lat/lon degrees can only be described honestly
 * by recording their geographic system.
 */
export function parseEpsgForSave(raw: number | string | null | undefined): EpsgParseResult {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < EPSG_CODE_MIN || parsed > EPSG_CODE_MAX) {
    return { ok: false, error: `EPSG code must be an integer between ${EPSG_CODE_MIN} and ${EPSG_CODE_MAX} (e.g. 26916 = NAD83 / UTM zone 16N).` };
  }
  return { ok: true, value: parsed };
}
