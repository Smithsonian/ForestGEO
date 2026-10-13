import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn()
    })
  }
}));

import { parseSpeciesCorrectionUndoMetadata, SpeciesCorrectionUndoMetadataError } from './species-correction-undo-metadata';
import type { EditOperationRecord, EditOperationStateRow } from '@/config/editoperations';

const EDIT_OPERATION_ID = 55;
const PLOT_ID = 1;
const CENSUS_ID = 10;
const TREE_ID = 100;
const TREE_TAG = 'T-100';
const BEFORE_SPECIES_ID = 7;
const BEFORE_SPECIES_CODE = 'SPEC-OLD';
const AFTER_SPECIES_ID = 8;
const AFTER_SPECIES_CODE = 'SPEC-NEW';
const STEM_GUID = 1000;
const SIBLING_STEM_GUID = 1001;
const QUADRAT_ID = 50;
const SIBLING_QUADRAT_ID = 51;
const SIBLING_CM_ID = 2000;
const OTHER_SIBLING_CM_ID = 2001;
const EDITED_CM_ID = 2002;
const BEFORE_RAW_SPCODE_SIBLING = 'spec-old';
// Trailing space is deliberate: the stored value is compared byte-exact.
const BEFORE_RAW_SPCODE_EDITED = 'Spec-Old ';
const AFTER_RAW_SPCODE = 'SPEC-NEW';
const METADATA_TABLE = 'species_correction_metadata';
const PLAN_HASH = 'plan-hash-species-correction';
const CREATED_BY = 'tester@example.com';
const CREATED_AT = '2026-10-01T00:00:00.000Z';
const STORED_DBH_BEFORE = '10.500000';
const STORED_DBH_AFTER = '11.250000';
const STORED_DESCRIPTION_AFTER = 'corrected';
const STORED_LOCALX_BEFORE = '3.500000';
const STORED_LOCALX_AFTER = '4.000000';
const DOMAIN_DIFF_DBH_BEFORE = 10.5;
const DOMAIN_DIFF_DBH_AFTER = 11.25;
const DOMAIN_DIFF_LOCALX_BEFORE = '3.5';
const DOMAIN_DIFF_LOCALX_AFTER = '4';
const STORED_MEASUREMENT_DATE_BEFORE = '2026-01-05';
const STORED_MEASUREMENT_DATE_AFTER = '2026-02-09';
const ISO_MEASUREMENT_DATE_BEFORE = '2026-01-05T00:00:00.000Z';
const ISO_MEASUREMENT_DATE_AFTER = '2026-02-09T00:00:00.000Z';
// Leading/trailing spaces are deliberate: text columns compare byte-exact, so whitespace must survive the round trip.
const STORED_RAW_COMMENTS_BEFORE = ' trimmed ';
const STORED_RAW_COMMENTS_AFTER = 'trimmed';
const STORED_LOCALY_AFTER_MAX = '999999.999999';
const ATTRIBUTE_CODE_DEAD = 'DEAD';
const ATTRIBUTE_CODE_BROKEN = 'BROKEN';
const COREMEASUREMENTS_TABLE = 'coremeasurements';
const STEMS_TABLE = 'stems';
const UNKNOWN_DIFF_COLUMN = 'SpeciesID';
const OVERFLOW_DECIMAL = '1000000.000000';
const DATE_WITH_TRAILING_GARBAGE = '2026-01-05garbage';
const IMPOSSIBLE_CALENDAR_DATE = '2026-02-30';
const ISO_DATE_WITHOUT_MILLIS = '2026-01-05T00:00:00Z';
const NUMERIC_DATE_VALUE = 20260105;
const NUMERIC_TEXT_VALUE = 5;
// Numerically equal to STORED_DBH_BEFORE, so this is not an actual change.
const EQUIVALENT_DBH_BEFORE = '10.5';
const TREES_TABLE = 'trees';
const WRONG_PRIMARY_KEY_NAME = 'ID';
const INACTIVE_FLAG = 0;
const STORED_RAW_CODES_AFTER = 'CODE-1';
const CONTRADICTORY_DBH_BEFORE = '99.000000';
const FOREIGN_CENSUS_ID = 11;
const NON_POSITIVE_TREE_ID = 0;
const FRACTIONAL_TREE_ID = 100.5;
const NEGATIVE_STEM_GUID = -1000;
const BLANK_SPECIES_CODE = '   ';
const DIVERGENT_DBH_AFTER = 12.75;

function buildMetadata(side: 'before' | 'after'): Record<string, unknown> {
  const speciesID = side === 'before' ? BEFORE_SPECIES_ID : AFTER_SPECIES_ID;
  const speciesCode = side === 'before' ? BEFORE_SPECIES_CODE : AFTER_SPECIES_CODE;
  return {
    version: 1,
    operation: 'tree-species-correction',
    targetTreeID: TREE_ID,
    treeTag: TREE_TAG,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    speciesID,
    speciesCode,
    stems: [
      { stemGUID: STEM_GUID, censusID: CENSUS_ID, quadratID: QUADRAT_ID, isActive: true },
      { stemGUID: SIBLING_STEM_GUID, censusID: CENSUS_ID, quadratID: SIBLING_QUADRAT_ID, isActive: true }
    ],
    measurements: [
      {
        coreMeasurementID: SIBLING_CM_ID,
        stemGUID: STEM_GUID,
        censusID: CENSUS_ID,
        isActive: true,
        rawSpCode: side === 'before' ? BEFORE_RAW_SPCODE_SIBLING : AFTER_RAW_SPCODE
      },
      {
        coreMeasurementID: OTHER_SIBLING_CM_ID,
        stemGUID: SIBLING_STEM_GUID,
        censusID: CENSUS_ID,
        isActive: true,
        rawSpCode: side === 'before' ? null : AFTER_RAW_SPCODE
      },
      {
        coreMeasurementID: EDITED_CM_ID,
        stemGUID: STEM_GUID,
        censusID: CENSUS_ID,
        isActive: true,
        rawSpCode: side === 'before' ? BEFORE_RAW_SPCODE_EDITED : AFTER_RAW_SPCODE
      }
    ],
    editedCoreMeasurementID: EDITED_CM_ID,
    editedStemGUID: STEM_GUID,
    domainDiff: {
      coremeasurements: {
        MeasuredDBH: { before: STORED_DBH_BEFORE, after: STORED_DBH_AFTER },
        Description: { before: null, after: STORED_DESCRIPTION_AFTER }
      },
      stems: {
        LocalX: { before: STORED_LOCALX_BEFORE, after: STORED_LOCALX_AFTER }
      },
      attributeCodes: { before: [], after: [] }
    }
  };
}

function buildStateRows(side: 'before' | 'after'): EditOperationStateRow[] {
  const speciesID = side === 'before' ? BEFORE_SPECIES_ID : AFTER_SPECIES_ID;
  return [
    {
      table: 'coremeasurements',
      primaryKey: 'CoreMeasurementID',
      primaryKeyValue: SIBLING_CM_ID,
      row: {
        CoreMeasurementID: SIBLING_CM_ID,
        StemGUID: STEM_GUID,
        CensusID: CENSUS_ID,
        IsActive: 1,
        RawSpCode: side === 'before' ? BEFORE_RAW_SPCODE_SIBLING : AFTER_RAW_SPCODE
      }
    },
    {
      table: 'coremeasurements',
      primaryKey: 'CoreMeasurementID',
      primaryKeyValue: OTHER_SIBLING_CM_ID,
      row: {
        CoreMeasurementID: OTHER_SIBLING_CM_ID,
        StemGUID: SIBLING_STEM_GUID,
        CensusID: CENSUS_ID,
        IsActive: 1,
        RawSpCode: side === 'before' ? null : AFTER_RAW_SPCODE
      }
    },
    {
      table: 'stems',
      primaryKey: 'StemGUID',
      primaryKeyValue: STEM_GUID,
      row: {
        StemGUID: STEM_GUID,
        TreeID: TREE_ID,
        QuadratID: QUADRAT_ID,
        CensusID: CENSUS_ID,
        IsActive: 1,
        LocalX: side === 'before' ? STORED_LOCALX_BEFORE : STORED_LOCALX_AFTER
      }
    },
    {
      table: 'coremeasurements',
      primaryKey: 'CoreMeasurementID',
      primaryKeyValue: EDITED_CM_ID,
      row: {
        CoreMeasurementID: EDITED_CM_ID,
        StemGUID: STEM_GUID,
        CensusID: CENSUS_ID,
        IsActive: 1,
        RawSpCode: side === 'before' ? BEFORE_RAW_SPCODE_EDITED : AFTER_RAW_SPCODE,
        MeasuredDBH: side === 'before' ? STORED_DBH_BEFORE : STORED_DBH_AFTER,
        Description: side === 'before' ? null : STORED_DESCRIPTION_AFTER
      }
    },
    {
      table: 'trees',
      primaryKey: 'TreeID',
      primaryKeyValue: TREE_ID,
      row: { TreeID: TREE_ID, TreeTag: TREE_TAG, SpeciesID: speciesID, CensusID: CENSUS_ID, IsActive: 1 }
    },
    {
      table: METADATA_TABLE,
      primaryKey: 'TreeID',
      primaryKeyValue: TREE_ID,
      row: buildMetadata(side)
    }
  ];
}

function buildValidRecord(): EditOperationRecord {
  return {
    editOperationID: EDIT_OPERATION_ID,
    operationType: 'single-row-edit',
    revertable: true,
    dataType: 'measurementssummary',
    targetID: EDITED_CM_ID,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    planHash: PLAN_HASH,
    beforeState: buildStateRows('before'),
    afterState: buildStateRows('after'),
    createdBy: CREATED_BY,
    createdAt: CREATED_AT,
    revertedByEditOperationID: null
  };
}

function markerRow(record: EditOperationRecord, side: 'before' | 'after'): EditOperationStateRow {
  return snapshotRow(record, side, METADATA_TABLE, TREE_ID);
}

function snapshotRow(record: EditOperationRecord, side: 'before' | 'after', table: string, primaryKeyValue: number): EditOperationStateRow {
  const rows = stateRows(record, side);
  const found = rows.find(row => row.table === table && row.primaryKeyValue === primaryKeyValue);
  if (!found) throw new Error(`snapshotRow: no ${table} row with primaryKeyValue=${primaryKeyValue} on ${side}State`);
  return found;
}

function stateRows(record: EditOperationRecord, side: 'before' | 'after'): EditOperationStateRow[] {
  return side === 'before' ? record.beforeState : record.afterState;
}

function withMarkerMetadata(record: EditOperationRecord, side: 'before' | 'after', patch: Record<string, unknown>): EditOperationRecord {
  const clone = structuredClone(record);
  const marker = markerRow(clone, side);
  marker.row = { ...(marker.row as Record<string, unknown>), ...patch };
  return clone;
}

function withDomainDiff(record: EditOperationRecord, domainDiff: Record<string, unknown>): EditOperationRecord {
  const withBefore = withMarkerMetadata(record, 'before', { domainDiff });
  return withMarkerMetadata(withBefore, 'after', { domainDiff });
}

function withSnapshotColumns(
  record: EditOperationRecord,
  side: 'before' | 'after',
  table: string,
  primaryKeyValue: number,
  patch: Record<string, unknown>
): EditOperationRecord {
  const clone = structuredClone(record);
  const target = snapshotRow(clone, side, table, primaryKeyValue);
  target.row = { ...(target.row as Record<string, unknown>), ...patch };
  return clone;
}

function emptyColumnDiff(attributeCodes: { before: string[]; after: string[] }): Record<string, unknown> {
  return { coremeasurements: {}, stems: {}, attributeCodes };
}

describe('parseSpeciesCorrectionUndoMetadata', () => {
  it('parses a valid correction pair with the edited measurement last in the array', () => {
    const record = buildValidRecord();
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(['before', 'after']);

    expect(result!.before.speciesID).toBe(BEFORE_SPECIES_ID);
    expect(result!.before.speciesCode).toBe(BEFORE_SPECIES_CODE);
    expect(result!.after.speciesID).toBe(AFTER_SPECIES_ID);
    expect(result!.after.speciesCode).toBe(AFTER_SPECIES_CODE);

    expect(result!.before.measurements).toHaveLength(3);
    expect(result!.after.measurements).toHaveLength(3);

    const beforeEdited = result!.before.measurements.find(measurement => measurement.coreMeasurementID === EDITED_CM_ID);
    expect(beforeEdited?.stemGUID).toBe(STEM_GUID);
    expect(beforeEdited?.rawSpCode).toBe(BEFORE_RAW_SPCODE_EDITED);

    const beforeOtherSibling = result!.before.measurements.find(measurement => measurement.coreMeasurementID === OTHER_SIBLING_CM_ID);
    expect(beforeOtherSibling?.rawSpCode).toBeNull();

    for (const measurement of result!.after.measurements) {
      expect(measurement.rawSpCode).toBe(AFTER_RAW_SPCODE);
    }

    expect(Object.keys(result!.before.domainDiff.coremeasurements)).toEqual(['MeasuredDBH', 'Description']);
    expect(Object.keys(result!.before.domainDiff.stems)).toEqual(['LocalX']);
    expect(result!.before.domainDiff.attributeCodes).toEqual({ before: [], after: [] });
  });

  it('parses an empty domain diff alongside intact tree/stem/target snapshot rows', () => {
    const emptyDiff = { coremeasurements: {}, stems: {}, attributeCodes: { before: [], after: [] } };
    const withBeforeDiff = withMarkerMetadata(buildValidRecord(), 'before', { domainDiff: emptyDiff });
    const record = withMarkerMetadata(withBeforeDiff, 'after', { domainDiff: emptyDiff });

    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.coremeasurements).toEqual({});
    expect(result!.before.domainDiff.stems).toEqual({});
  });

  it('returns null for a legacy record with no species-correction marker row on either side', () => {
    const record = buildValidRecord();
    record.beforeState = record.beforeState.filter(row => row.table !== METADATA_TABLE);
    record.afterState = record.afterState.filter(row => row.table !== METADATA_TABLE);

    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).toBeNull();
  });
});

describe('parseSpeciesCorrectionUndoMetadata malformed structure', () => {
  it('throws when beforeState is replaced by a non-array string', () => {
    const record = buildValidRecord();
    record.beforeState = 'not-an-array' as unknown as EditOperationStateRow[];
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.beforeState is not an array/);
  });

  it('throws when afterState is replaced by null, carrying the originating editOperationID', () => {
    const record = buildValidRecord();
    record.afterState = null as unknown as EditOperationStateRow[];
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.afterState is not an array/);
    try {
      parseSpeciesCorrectionUndoMetadata(record);
      throw new Error('expected parseSpeciesCorrectionUndoMetadata to throw');
    } catch (error) {
      if (error instanceof SpeciesCorrectionUndoMetadataError) expect(error.editOperationID).toBe(EDIT_OPERATION_ID);
      else throw error;
    }
  });

  it('throws when a beforeState element is replaced by a bare number', () => {
    const record = buildValidRecord();
    record.beforeState = [7 as unknown as EditOperationStateRow, ...record.beforeState];
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/is not a plain object/);
  });

  it('throws when a state element has a non-string table', () => {
    const record = buildValidRecord();
    record.beforeState[0] = { ...record.beforeState[0], table: 42 as unknown as string };
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/\.table is not a string/);
  });

  it('throws when a state element has a boolean primaryKeyValue', () => {
    const record = buildValidRecord();
    record.beforeState[0] = { ...record.beforeState[0], primaryKeyValue: true as unknown as number };
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/primaryKeyValue is not a string or number/);
  });

  it('throws when a state element row is an array instead of a plain object', () => {
    const record = buildValidRecord();
    record.beforeState[0] = { ...record.beforeState[0], row: [] as unknown as Record<string, unknown> };
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/row is not null or a plain object/);
  });

  it('throws when the marker is present on beforeState only', () => {
    const record = buildValidRecord();
    record.afterState = record.afterState.filter(row => row.table !== METADATA_TABLE);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/marker present on only one side/);
  });

  it('throws when the marker is present on afterState only', () => {
    const record = buildValidRecord();
    record.beforeState = record.beforeState.filter(row => row.table !== METADATA_TABLE);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/marker present on only one side/);
  });

  it('throws when beforeState carries two marker rows', () => {
    const record = buildValidRecord();
    record.beforeState.push(structuredClone(markerRow(record, 'before')));
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/duplicate .* marker rows on beforeState/);
  });

  it('throws when the marker primaryKey is not TreeID', () => {
    const record = buildValidRecord();
    markerRow(record, 'before').primaryKey = 'TreeId';
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/marker has primaryKey "TreeId"/);
  });

  it('throws when the marker primaryKeyValue disagrees with metadata.targetTreeID', () => {
    const record = buildValidRecord();
    markerRow(record, 'before').primaryKeyValue = TREE_ID + 1;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/marker primaryKeyValue \(\d+\) does not equal metadata\.targetTreeID/);
  });

  it('throws when the marker row is null', () => {
    const record = buildValidRecord();
    markerRow(record, 'before').row = null;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/marker has a null row/);
  });

  it('throws when the marker row is an array instead of a plain object', () => {
    const record = buildValidRecord();
    markerRow(record, 'before').row = [] as unknown as Record<string, unknown>;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/row is not null or a plain object/);
  });

  it('throws when the before-side metadata version is 2', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { version: 2 });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.version is unsupported/);
  });

  it('throws when the before-side metadata version is the string "1"', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { version: '1' as unknown as number });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.version is unsupported/);
  });

  it('throws when the after-side metadata operation is tree-species-reassignment', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'after', { operation: 'tree-species-reassignment' });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.operation is unsupported/);
  });
});

describe('parseSpeciesCorrectionUndoMetadata membership and scope', () => {
  it('throws when beforeState metadata.targetTreeID is the numeric string "100"', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { targetTreeID: '100' as unknown as number });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.targetTreeID must be a positive integer/);
  });

  it('throws when beforeState metadata.treeTag is blank', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { treeTag: '   ' });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.treeTag must be a non-blank string/);
  });

  it('throws when both sides declare the same speciesID', () => {
    const withAfterSpecies = withMarkerMetadata(buildValidRecord(), 'after', { speciesID: BEFORE_SPECIES_ID });
    const treesSnapshot = snapshotRow(withAfterSpecies, 'after', 'trees', TREE_ID);
    treesSnapshot.row = { ...(treesSnapshot.row as Record<string, unknown>), SpeciesID: BEFORE_SPECIES_ID };
    expect(() => parseSpeciesCorrectionUndoMetadata(withAfterSpecies)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(withAfterSpecies)).toThrow(/metadata\.speciesID is identical on beforeState and afterState/);
  });

  it('throws when before/after metadata disagree on treeTag', () => {
    const withAfterTag = withMarkerMetadata(buildValidRecord(), 'after', { treeTag: 'T-999' });
    const treesSnapshot = snapshotRow(withAfterTag, 'after', 'trees', TREE_ID);
    treesSnapshot.row = { ...(treesSnapshot.row as Record<string, unknown>), TreeTag: 'T-999' };
    expect(() => parseSpeciesCorrectionUndoMetadata(withAfterTag)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(withAfterTag)).toThrow(/metadata\.treeTag differs between beforeState \(.+\) and afterState \(.+\)/);
  });

  it('throws when before/after metadata disagree on editedCoreMeasurementID', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'after', { editedCoreMeasurementID: SIBLING_CM_ID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /metadata\.editedCoreMeasurementID differs between beforeState \(.+\) and afterState \(.+\)/
    );
  });

  it('throws when beforeState metadata.stems has two entries with the same stemGUID', () => {
    const stems = buildMetadata('before').stems as Record<string, unknown>[];
    const record = withMarkerMetadata(buildValidRecord(), 'before', { stems: [...stems, stems[0]] });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.stems has duplicate stemGUID/);
  });

  it('throws when a beforeState metadata.measurements entry references a stemGUID absent from metadata.stems', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map((m, i) =>
      i === 0 ? { ...m, stemGUID: SIBLING_STEM_GUID + 1 } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/references stemGUID \d+ not present in metadata\.stems/);
  });

  it('throws when a beforeState metadata.stems entry has a censusID outside metadata.censusID', () => {
    const stems = (buildMetadata('before').stems as Record<string, unknown>[]).map((s, i) => (i === 0 ? { ...s, censusID: CENSUS_ID + 1 } : s));
    const record = withMarkerMetadata(buildValidRecord(), 'before', { stems });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/stems\[0\]\.censusID \(\d+\) does not equal beforeState metadata\.censusID/);
  });

  it('throws when a beforeState metadata.stems entry has isActive as the number 1 instead of a boolean', () => {
    const stems = (buildMetadata('before').stems as Record<string, unknown>[]).map((s, i) => (i === 0 ? { ...s, isActive: 1 } : s));
    const record = withMarkerMetadata(buildValidRecord(), 'before', { stems });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.stems\[0\]\.isActive must be a boolean/);
  });

  it('throws when a beforeState metadata.measurements entry has rawSpCode as the number 5', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map((m, i) => (i === 0 ? { ...m, rawSpCode: 5 } : m));
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.measurements\[0\]\.rawSpCode must be a string or null/);
  });

  it('throws when the edited measurement is removed from beforeState metadata.measurements', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).filter(m => m.coreMeasurementID !== EDITED_CM_ID);
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.measurements has no entry for editedCoreMeasurementID/);
  });

  it('throws when the edited measurement declares a stemGUID other than editedStemGUID', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map(m =>
      m.coreMeasurementID === EDITED_CM_ID ? { ...m, stemGUID: SIBLING_STEM_GUID } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/stemGUID \(\d+\) does not equal editedStemGUID \(\d+\)/);
  });

  it('throws when the edited measurement is not active', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map(m =>
      m.coreMeasurementID === EDITED_CM_ID ? { ...m, isActive: false } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/editedCoreMeasurementID=\d+\] is not active/);
  });

  it('throws when the edited stem is not active', () => {
    const stems = (buildMetadata('before').stems as Record<string, unknown>[]).map(s => (s.stemGUID === STEM_GUID ? { ...s, isActive: false } : s));
    const record = withMarkerMetadata(buildValidRecord(), 'before', { stems });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/stems\[editedStemGUID=\d+\] is not active/);
  });

  // Removing the edited stem's own measurements too so the link rule, not a stale-reference rule, is what fires first.
  it('throws when the edited stem is removed from beforeState metadata.stems along with its measurements', () => {
    const stems = (buildMetadata('before').stems as Record<string, unknown>[]).filter(s => s.stemGUID !== STEM_GUID);
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).filter(m => m.stemGUID !== STEM_GUID);
    const record = withMarkerMetadata(buildValidRecord(), 'before', { stems, measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.measurements has no entry for editedCoreMeasurementID/);
  });

  it('throws when beforeState and afterState metadata.measurements have different membership sizes', () => {
    const measurements = (buildMetadata('after').measurements as Record<string, unknown>[]).filter(m => m.coreMeasurementID !== OTHER_SIBLING_CM_ID);
    const record = withMarkerMetadata(buildValidRecord(), 'after', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /metadata\.measurements membership size differs between beforeState \(\d+\) and afterState \(\d+\)/
    );
  });

  it('throws when a shared measurement member has different isActive between beforeState and afterState', () => {
    const measurements = (buildMetadata('after').measurements as Record<string, unknown>[]).map(m =>
      m.coreMeasurementID === OTHER_SIBLING_CM_ID ? { ...m, isActive: false } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'after', { measurements });
    const cmSnapshot = snapshotRow(record, 'after', 'coremeasurements', OTHER_SIBLING_CM_ID);
    cmSnapshot.row = { ...(cmSnapshot.row as Record<string, unknown>), IsActive: 0 };
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /coreMeasurementID \d+ has different stemGUID\/censusID\/isActive between beforeState and afterState/
    );
  });

  it('accepts differing rawSpCode per side for the same coreMeasurementID as legitimate correction evidence', () => {
    const result = parseSpeciesCorrectionUndoMetadata(buildValidRecord());
    const beforeSibling = result!.before.measurements.find(m => m.coreMeasurementID === SIBLING_CM_ID);
    const afterSibling = result!.after.measurements.find(m => m.coreMeasurementID === SIBLING_CM_ID);
    expect(beforeSibling?.rawSpCode).toBe(BEFORE_RAW_SPCODE_SIBLING);
    expect(afterSibling?.rawSpCode).toBe(AFTER_RAW_SPCODE);
  });

  it('throws when record.dataType is not measurementssummary', () => {
    const record = buildValidRecord();
    record.dataType = 'failedmeasurements';
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.dataType must be "measurementssummary"/);
  });

  it('throws when record.plotID disagrees with metadata.plotID', () => {
    const record = buildValidRecord();
    record.plotID = PLOT_ID + 1;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.plotID \(\d+\) does not equal metadata\.plotID/);
  });

  it('throws when record.targetID is null', () => {
    const record = buildValidRecord();
    record.targetID = null;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.targetID \(null\) does not equal metadata\.editedCoreMeasurementID/);
  });

  it('throws when record.targetID points at a sibling measurement instead of the edited one', () => {
    const record = buildValidRecord();
    record.targetID = SIBLING_CM_ID;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.targetID \(\d+\) does not equal metadata\.editedCoreMeasurementID/);
  });
});

describe('parseSpeciesCorrectionUndoMetadata domain diff evidence', () => {
  // The shared fieldChanged/PER_COLUMN_DECIMAL_PRECISION policy (fieldpolicy.ts) has no entry
  // for these stored column names, so a naive comparator would reject this legitimate undo.
  it('accepts numeric domainDiff decimals against six-place stored decimal strings', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: DOMAIN_DIFF_DBH_BEFORE, after: DOMAIN_DIFF_DBH_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.coremeasurements.MeasuredDBH).toEqual({ before: DOMAIN_DIFF_DBH_BEFORE, after: DOMAIN_DIFF_DBH_AFTER });
  });

  it('accepts shortened decimal string representations that are numerically equal to the stored values', () => {
    const domainDiff = {
      coremeasurements: {},
      stems: { LocalX: { before: DOMAIN_DIFF_LOCALX_BEFORE, after: DOMAIN_DIFF_LOCALX_AFTER } },
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.stems.LocalX).toEqual({ before: DOMAIN_DIFF_LOCALX_BEFORE, after: DOMAIN_DIFF_LOCALX_AFTER });
  });

  it('accepts a complete YYYY-MM-DD MeasurementDate change backed by matching snapshots', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: STORED_MEASUREMENT_DATE_BEFORE, after: STORED_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    record = withSnapshotColumns(record, 'before', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { MeasurementDate: STORED_MEASUREMENT_DATE_BEFORE });
    record = withSnapshotColumns(record, 'after', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { MeasurementDate: STORED_MEASUREMENT_DATE_AFTER });
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.coremeasurements.MeasurementDate).toEqual({
      before: STORED_MEASUREMENT_DATE_BEFORE,
      after: STORED_MEASUREMENT_DATE_AFTER
    });
  });

  it('accepts a full ISO instant MeasurementDate as emitted by Date serialization', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: ISO_MEASUREMENT_DATE_BEFORE, after: ISO_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    record = withSnapshotColumns(record, 'before', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { MeasurementDate: ISO_MEASUREMENT_DATE_BEFORE });
    record = withSnapshotColumns(record, 'after', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { MeasurementDate: ISO_MEASUREMENT_DATE_AFTER });
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.coremeasurements.MeasurementDate).toEqual({
      before: ISO_MEASUREMENT_DATE_BEFORE,
      after: ISO_MEASUREMENT_DATE_AFTER
    });
  });

  it('compares text evidence byte-exact so a whitespace-only change is real evidence', () => {
    const domainDiff = {
      coremeasurements: { RawComments: { before: STORED_RAW_COMMENTS_BEFORE, after: STORED_RAW_COMMENTS_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    record = withSnapshotColumns(record, 'before', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { RawComments: STORED_RAW_COMMENTS_BEFORE });
    record = withSnapshotColumns(record, 'after', COREMEASUREMENTS_TABLE, EDITED_CM_ID, { RawComments: STORED_RAW_COMMENTS_AFTER });
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.coremeasurements.RawComments).toEqual({
      before: STORED_RAW_COMMENTS_BEFORE,
      after: STORED_RAW_COMMENTS_AFTER
    });
  });

  // cmattributes is deliberately never cross-checked against a snapshot row because CMAID is a storage surrogate.
  it('accepts non-empty attributeCodes that are equal on both sides with no cmattributes snapshot row', () => {
    const attributeCodes = { before: [ATTRIBUTE_CODE_DEAD, ATTRIBUTE_CODE_BROKEN], after: [ATTRIBUTE_CODE_DEAD, ATTRIBUTE_CODE_BROKEN] };
    const record = withDomainDiff(buildValidRecord(), emptyColumnDiff(attributeCodes));
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.attributeCodes).toEqual(attributeCodes);
  });

  // NULL stays distinct from zero: a null-before/max-after decimal change must not be coerced to 0.
  it('accepts a null-to-maximum in-range decimal change at the decimal(12,6) bound', () => {
    const domainDiff = {
      coremeasurements: {},
      stems: { LocalY: { before: null, after: STORED_LOCALY_AFTER_MAX } },
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    record = withSnapshotColumns(record, 'before', STEMS_TABLE, STEM_GUID, { LocalY: null });
    record = withSnapshotColumns(record, 'after', STEMS_TABLE, STEM_GUID, { LocalY: STORED_LOCALY_AFTER_MAX });
    const result = parseSpeciesCorrectionUndoMetadata(record);

    expect(result).not.toBeNull();
    expect(result!.before.domainDiff.stems.LocalY?.before).toBeNull();
    expect(result!.before.domainDiff.stems.LocalY?.after).toBe(STORED_LOCALY_AFTER_MAX);
  });
});

describe('parseSpeciesCorrectionUndoMetadata domain diff rejections', () => {
  it('throws when domainDiff.coremeasurements declares a column outside the producer allowlist', () => {
    const domainDiff = {
      coremeasurements: { [UNKNOWN_DIFF_COLUMN]: { before: null, after: 'x' } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.domainDiff\.coremeasurements has unknown column "SpeciesID"/);
  });

  it('throws when a domainDiff column change entry is a bare string instead of an object', () => {
    const domainDiff = { coremeasurements: { MeasuredDBH: STORED_DBH_AFTER }, stems: {}, attributeCodes: { before: [], after: [] } };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.domainDiff\.coremeasurements\.MeasuredDBH is not a plain object/);
  });

  it('throws when a domainDiff column change entry omits the "after" key', () => {
    const domainDiff = { coremeasurements: { MeasuredDBH: { before: STORED_DBH_BEFORE } }, stems: {}, attributeCodes: { before: [], after: [] } };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.domainDiff\.coremeasurements\.MeasuredDBH is missing "after"/);
  });

  it('throws when a decimal column change carries a boolean instead of a stored decimal', () => {
    const domainDiff = { coremeasurements: { MeasuredDBH: { before: STORED_DBH_BEFORE, after: true } }, stems: {}, attributeCodes: { before: [], after: [] } };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/\.after must be null, a finite number, or a decimal string \(received true\)/);
  });

  // decimal(12,6) leaves six integer digits, so 1000000 is unrepresentable and must be rejected as
  // evidence rather than failing later at the SQL write.
  it('throws when decimal evidence overflows the stored decimal(12,6) bound', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: STORED_DBH_BEFORE, after: OVERFLOW_DECIMAL } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/exceeds the stored decimal\(12,6\) bound/);
  });

  // Only the first ten characters used to be validated, so this value previously passed and could
  // reach a SQL write.
  it('throws when a MeasurementDate carries trailing garbage after a valid date prefix', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: DATE_WITH_TRAILING_GARBAGE, after: STORED_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/must be null or a complete YYYY-MM-DD \/ ISO instant calendar date string/);
  });

  it('throws when a MeasurementDate names a day that does not exist in that month', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: IMPOSSIBLE_CALENDAR_DATE, after: STORED_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/must be null or a complete YYYY-MM-DD \/ ISO instant calendar date string/);
  });

  // Only the exact Date.prototype.toISOString() form is accepted.
  it('throws when a MeasurementDate is an ISO instant missing the millisecond field', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: ISO_DATE_WITHOUT_MILLIS, after: STORED_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/must be null or a complete YYYY-MM-DD \/ ISO instant calendar date string/);
  });

  it('throws when a date column change carries a number instead of a serialized date', () => {
    const domainDiff = {
      coremeasurements: { MeasurementDate: { before: NUMERIC_DATE_VALUE, after: STORED_MEASUREMENT_DATE_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/must be null or a complete YYYY-MM-DD \/ ISO instant calendar date string/);
  });

  it('throws when a text column change carries a number instead of a string', () => {
    const domainDiff = { coremeasurements: { Description: { before: null, after: NUMERIC_TEXT_VALUE } }, stems: {}, attributeCodes: { before: [], after: [] } };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/\.after must be null or a string \(received 5\)/);
  });

  // The producer only records columns that actually changed, so '10.500000' vs '10.5' is
  // contradictory evidence rather than a change.
  it('throws when a column change declares before and after values that are not actually different', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: STORED_DBH_BEFORE, after: EQUIVALENT_DBH_BEFORE } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/declares before\/after that are not actually different under storedValuesDiffer/);
  });

  it('throws when attributeCodes.before is a bare string instead of an array', () => {
    const domainDiff = { coremeasurements: {}, stems: {}, attributeCodes: { before: ATTRIBUTE_CODE_DEAD, after: [] } };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/metadata\.domainDiff\.attributeCodes\.before is not an array/);
  });

  it('throws when attributeCodes repeats the same code', () => {
    const domainDiff = emptyColumnDiff({ before: [ATTRIBUTE_CODE_DEAD, ATTRIBUTE_CODE_DEAD], after: [ATTRIBUTE_CODE_DEAD, ATTRIBUTE_CODE_DEAD] });
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/has duplicate attribute code "DEAD"/);
  });

  it('throws when the two sides declare different domainDiff column key sets', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: DOMAIN_DIFF_DBH_BEFORE, after: DOMAIN_DIFF_DBH_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    record = withMarkerMetadata(record, 'after', { domainDiff: emptyColumnDiff({ before: [], after: [] }) });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /domainDiff\.coremeasurements column key set differs between beforeState and afterState metadata/
    );
  });

  it('throws when the two sides disagree on the value of the same domainDiff column', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: DOMAIN_DIFF_DBH_BEFORE, after: DOMAIN_DIFF_DBH_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    let record = withDomainDiff(buildValidRecord(), domainDiff);
    const divergentDiff = {
      coremeasurements: { MeasuredDBH: { before: DOMAIN_DIFF_DBH_BEFORE, after: DIVERGENT_DBH_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    record = withMarkerMetadata(record, 'after', { domainDiff: divergentDiff });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /domainDiff\.coremeasurements\.MeasuredDBH differs between beforeState and afterState metadata/
    );
  });

  // A column missing from the captured snapshot is malformed evidence, not an unknown value.
  it('throws when a declared domainDiff column is absent from the edited measurement snapshot row', () => {
    const domainDiff = {
      coremeasurements: { RawCodes: { before: null, after: STORED_RAW_CODES_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /beforeState coremeasurements snapshot row \(pk=\d+\) is missing column "RawCodes" declared in domainDiff/
    );
  });

  it('throws when the snapshot value contradicts the declared domainDiff evidence', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: CONTRADICTORY_DBH_BEFORE, after: STORED_DBH_AFTER } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const record = withDomainDiff(buildValidRecord(), domainDiff);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/column "MeasuredDBH" \(.+\) does not match domainDiff evidence/);
  });
});

describe('parseSpeciesCorrectionUndoMetadata snapshot evidence', () => {
  it('throws when the beforeState trees snapshot row is absent', () => {
    const record = buildValidRecord();
    record.beforeState = record.beforeState.filter(row => row.table !== TREES_TABLE);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState is missing a trees snapshot row for pk=\d+/);
  });

  // Each side's tree snapshot must carry that side's own species, so a corrupted before-species cannot be restored against contradictory evidence.
  it('throws when the afterState trees snapshot row still carries the pre-correction SpeciesID', () => {
    const record = withSnapshotColumns(buildValidRecord(), 'after', TREES_TABLE, TREE_ID, { SpeciesID: BEFORE_SPECIES_ID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /trees snapshot row \(pk=\d+\) SpeciesID \(\d+\) does not equal afterState metadata\.speciesID/
    );
  });

  // PK lookup must never silently take the first of several matches.
  it('throws when beforeState carries two trees snapshot rows for the same primary key', () => {
    const record = buildValidRecord();
    record.beforeState.push(structuredClone(snapshotRow(record, 'before', TREES_TABLE, TREE_ID)));
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState has 2 trees snapshot rows for pk=\d+, expected at most one/);
  });

  it('throws when a snapshot row declares the wrong primaryKey column name', () => {
    const record = buildValidRecord();
    snapshotRow(record, 'before', STEMS_TABLE, STEM_GUID).primaryKey = WRONG_PRIMARY_KEY_NAME;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState stems snapshot row \(pk=\d+\) has primaryKey "ID", expected "StemGUID"/);
  });

  it('throws when the beforeState stems snapshot row for the edited stem is absent', () => {
    const record = buildValidRecord();
    record.beforeState = record.beforeState.filter(row => !(row.table === STEMS_TABLE && row.primaryKeyValue === STEM_GUID));
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState is missing a stems snapshot row for pk=\d+/);
  });

  it('throws when the stems snapshot QuadratID disagrees with the declared stem precondition', () => {
    const record = withSnapshotColumns(buildValidRecord(), 'before', STEMS_TABLE, STEM_GUID, { QuadratID: SIBLING_QUADRAT_ID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/QuadratID \(\d+\) does not equal metadata\.stems\[stemGUID=\d+\]\.quadratID/);
  });

  // RawSpCode is the raw evidence an undo restores, so it is compared byte-exact including NULL.
  it('throws when a sibling measurement snapshot RawSpCode disagrees with its declared member', () => {
    const record = withSnapshotColumns(buildValidRecord(), 'before', COREMEASUREMENTS_TABLE, SIBLING_CM_ID, { RawSpCode: AFTER_RAW_SPCODE });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /coremeasurements snapshot row \(pk=\d+\) RawSpCode \(.+\) does not equal metadata\.measurements\[coreMeasurementID=\d+\]\.rawSpCode/
    );
  });

  // An empty domainDiff must not let a record skip the required target snapshot.
  it('throws when the edited measurement snapshot row is absent even though domainDiff is empty', () => {
    const record = withDomainDiff(buildValidRecord(), emptyColumnDiff({ before: [], after: [] }));
    record.beforeState = record.beforeState.filter(row => !(row.table === COREMEASUREMENTS_TABLE && row.primaryKeyValue === EDITED_CM_ID));
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /beforeState is missing a coremeasurements snapshot row for pk=\d+ \(the edited measurement\)/
    );
  });

  // A stored tinyint(1) arrives as 0/1, so 0 must narrow to `false` and contradict the declared precondition.
  it('throws when the edited stem snapshot is inactive but the declared precondition says active', () => {
    const record = withSnapshotColumns(buildValidRecord(), 'before', STEMS_TABLE, STEM_GUID, { IsActive: INACTIVE_FLAG });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/IsActive \(false\) does not equal metadata\.stems\[stemGUID=\d+\]\.isActive \(true\)/);
  });
});

describe('parseSpeciesCorrectionUndoMetadata membership scope gaps', () => {
  // A correction is scoped to a single census, so a member from another census must never be swept into the undo.
  it('throws when a measurements entry declares a censusID outside metadata.censusID', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map(m =>
      m.coreMeasurementID === SIBLING_CM_ID ? { ...m, censusID: FOREIGN_CENSUS_ID } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(
      /beforeState metadata\.measurements\[\d+\]\.censusID \(\d+\) does not equal beforeState metadata\.censusID \(\d+\)/
    );
  });

  it('throws when metadata.measurements repeats the same coreMeasurementID', () => {
    const measurements = (buildMetadata('before').measurements as Record<string, unknown>[]).map(m =>
      m.coreMeasurementID === OTHER_SIBLING_CM_ID ? { ...m, coreMeasurementID: SIBLING_CM_ID } : m
    );
    const record = withMarkerMetadata(buildValidRecord(), 'before', { measurements });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState metadata\.measurements has duplicate coreMeasurementID \d+/);
  });

  it('throws when record.censusID disagrees with metadata.censusID', () => {
    const record = buildValidRecord();
    record.censusID = FOREIGN_CENSUS_ID;
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/record\.censusID \(\d+\) does not equal metadata\.censusID \(\d+\)/);
  });

  it('throws when metadata.targetTreeID is zero', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { targetTreeID: NON_POSITIVE_TREE_ID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState metadata\.targetTreeID must be a positive integer \(received 0\)/);
  });

  it('throws when metadata.targetTreeID is fractional', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { targetTreeID: FRACTIONAL_TREE_ID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState metadata\.targetTreeID must be a positive integer \(received 100\.5\)/);
  });

  it('throws when metadata.editedStemGUID is negative', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { editedStemGUID: NEGATIVE_STEM_GUID });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState metadata\.editedStemGUID must be a positive integer \(received -1000\)/);
  });

  it('throws when metadata.speciesCode is whitespace only', () => {
    const record = withMarkerMetadata(buildValidRecord(), 'before', { speciesCode: BLANK_SPECIES_CODE });
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(SpeciesCorrectionUndoMetadataError);
    expect(() => parseSpeciesCorrectionUndoMetadata(record)).toThrow(/beforeState metadata\.speciesCode must be a non-blank string/);
  });
});
