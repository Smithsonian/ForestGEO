import { describe, expect, it } from 'vitest';
import { parseEpsgForSave } from './plot-epsg';
import { EPSG_CODE_MAX, EPSG_CODE_MIN } from '@/config/macros';

const NAD83_UTM_ZONE_16N_EPSG = 26916;
const WGS84_GEOGRAPHIC_EPSG = 4326;

describe('parseEpsgForSave', () => {
  it('parses a stored numeric code unchanged', () => {
    expect(parseEpsgForSave(NAD83_UTM_ZONE_16N_EPSG)).toEqual({ ok: true, value: NAD83_UTM_ZONE_16N_EPSG });
  });

  it('parses the string the input field holds mid-edit into a number', () => {
    expect(parseEpsgForSave(String(NAD83_UTM_ZONE_16N_EPSG))).toEqual({ ok: true, value: NAD83_UTM_ZONE_16N_EPSG });
  });

  it('maps blank input to an explicit null so the PATCH un-records the code', () => {
    expect(parseEpsgForSave('')).toEqual({ ok: true, value: null });
    expect(parseEpsgForSave('   ')).toEqual({ ok: true, value: null });
    expect(parseEpsgForSave(undefined)).toEqual({ ok: true, value: null });
    expect(parseEpsgForSave(null)).toEqual({ ok: true, value: null });
  });

  it('rejects codes outside the EPSG registry range with the range in the message', () => {
    for (const bad of [EPSG_CODE_MIN - 1, EPSG_CODE_MAX + 1, 0]) {
      const result = parseEpsgForSave(bad);
      expect(result.ok, `${bad} should be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(String(EPSG_CODE_MIN));
        expect(result.error).toContain(String(EPSG_CODE_MAX));
      }
    }
  });

  it('rejects non-integer and non-numeric input', () => {
    expect(parseEpsgForSave(26916.5).ok).toBe(false);
    expect(parseEpsgForSave('not-a-code').ok).toBe(false);
  });

  it('accepts a geographic code: legacy degree-valued plots must stay describable, unlike provisioning input', () => {
    expect(parseEpsgForSave(WGS84_GEOGRAPHIC_EPSG)).toEqual({ ok: true, value: WGS84_GEOGRAPHIC_EPSG });
  });
});
