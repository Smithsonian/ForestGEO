import { EDIT_OPERATION_RECORD_ID_MARKER } from '@/lib/changelog/edit-operation-projection';

export type ChangelogRowImage = Record<string, unknown>;

export interface ChangelogRecord {
  primaryKey: string;
  oldState: ChangelogRowImage | null;
  newState: ChangelogRowImage | null;
}

export interface DecodableChangelogRow {
  tableName: string;
  recordID: string;
  oldRowState: unknown;
  newRowState: unknown;
}

export interface DecodedChangelogRow {
  records: ChangelogRecord[];
  undecodable: boolean;
}

export const FILE_UPLOAD_CHANGELOG_TABLE = 'file_upload';
export const QUADRAT_OVERLAP_ACKNOWLEDGMENT_CHANGELOG_TABLE = 'quadrat_overlap_acknowledgment';
export const BULK_REVISION_CHANGELOG_TABLE = 'bulk-revision-apply';

/** Tables whose changelog rows summarize an event; their state is never a row image. */
export const SUMMARY_CHANGELOG_TABLES: ReadonlySet<string> = new Set([
  FILE_UPLOAD_CHANGELOG_TABLE,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_CHANGELOG_TABLE,
  BULK_REVISION_CHANGELOG_TABLE
]);

export const COMPOSITE_KEY_SEPARATOR = '-';

/**
 * Primary keys (db/sql/tablestructures.sql) of the fourteen tables the legacy interceptor
 * (lib/connectionlogger.ts) logged as arrays of row images. Its own table map is not the row
 * key for attributes and measurement_error_log, so it cannot be reused here.
 */
export const LEGACY_ROW_KEY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  attributes: ['Code', 'IsActive'],
  cmattributes: ['CMAID'],
  coremeasurements: ['CoreMeasurementID'],
  family: ['FamilyID'],
  genus: ['GenusID'],
  measurement_error_log: ['MeasurementID', 'ErrorID'],
  measurement_errors: ['ErrorID'],
  personnel: ['PersonnelID'],
  quadrats: ['QuadratID'],
  roles: ['RoleID'],
  species: ['SpeciesID'],
  specieslimits: ['SpeciesLimitID'],
  stems: ['StemGUID'],
  trees: ['TreeID']
};

const EDIT_OPERATION_ID_PATTERN = /^\d+$/;

type StateSide = { kind: 'absent' } | { kind: 'undecodable' } | { kind: 'object'; image: ChangelogRowImage } | { kind: 'array'; images: ChangelogRowImage[] };

const ABSENT_SIDE: StateSide = { kind: 'absent' };
const UNDECODABLE_SIDE: StateSide = { kind: 'undecodable' };

function isRowImage(value: unknown): value is ChangelogRowImage {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStateSide(stored: unknown): StateSide {
  if (stored === null || stored === undefined) return ABSENT_SIDE;

  let parsed: unknown = stored;
  if (typeof stored === 'string') {
    try {
      parsed = JSON.parse(stored);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return UNDECODABLE_SIDE;
      throw error;
    }
  }

  // mysql2 hands back a JSON null literal and SQL NULL as the same value, so both read as "no image".
  if (parsed === null) return ABSENT_SIDE;
  if (Array.isArray(parsed)) return parsed.every(isRowImage) ? { kind: 'array', images: parsed } : UNDECODABLE_SIDE;
  return isRowImage(parsed) ? { kind: 'object', image: parsed } : UNDECODABLE_SIDE;
}

function imagesOf(side: StateSide): ChangelogRowImage[] {
  if (side.kind === 'array') return side.images;
  return side.kind === 'object' ? [side.image] : [];
}

function readLegacyKeyValues(tableName: string, image: ChangelogRowImage): string[] | null {
  if (!Object.hasOwn(LEGACY_ROW_KEY_COLUMNS, tableName)) return null;
  const keyColumns = LEGACY_ROW_KEY_COLUMNS[tableName];
  const values: string[] = [];
  for (const column of keyColumns) {
    const value = image[column];
    if (value === null || value === undefined) return null;
    values.push(String(value));
  }
  return values;
}

/** A before-image and an after-image are the same row only when the table's full key matches; position proves nothing. */
function pairLegacyImages(row: DecodableChangelogRow, beforeImages: ChangelogRowImage[], afterImages: ChangelogRowImage[]): ChangelogRecord[] {
  const afterCandidates = afterImages.map(image => {
    const keyValues = readLegacyKeyValues(row.tableName, image);
    return { image, keyValues, matchKey: keyValues === null ? null : JSON.stringify(keyValues), paired: false };
  });

  const records: ChangelogRecord[] = beforeImages.map(image => {
    const keyValues = readLegacyKeyValues(row.tableName, image);
    const matchKey = keyValues === null ? null : JSON.stringify(keyValues);
    const match = matchKey === null ? undefined : afterCandidates.find(candidate => !candidate.paired && candidate.matchKey === matchKey);
    if (match) match.paired = true;
    return {
      primaryKey: keyValues === null ? row.recordID : keyValues.join(COMPOSITE_KEY_SEPARATOR),
      oldState: image,
      newState: match ? match.image : null
    };
  });

  for (const candidate of afterCandidates) {
    if (candidate.paired) continue;
    records.push({
      primaryKey: candidate.keyValues === null ? row.recordID : candidate.keyValues.join(COMPOSITE_KEY_SEPARATOR),
      oldState: null,
      newState: candidate.image
    });
  }
  return records;
}

/** `<pk>::edit-op-<id>` → the key and the edit operation; any other RecordID is returned whole. */
export function splitEditOperationRecordID(recordID: string): { primaryKey: string; editOperationID: string | null } {
  const markerIndex = recordID.lastIndexOf(EDIT_OPERATION_RECORD_ID_MARKER);
  if (markerIndex === -1) return { primaryKey: recordID, editOperationID: null };
  const editOperationID = recordID.slice(markerIndex + EDIT_OPERATION_RECORD_ID_MARKER.length);
  if (!EDIT_OPERATION_ID_PATTERN.test(editOperationID)) return { primaryKey: recordID, editOperationID: null };
  return { primaryKey: recordID.slice(0, markerIndex), editOperationID };
}

/**
 * Reads both stored states of one unifiedchangelog row as records. Object states (every current
 * writer) form one record keyed by the stored RecordID. Array states (the legacy interceptor)
 * pair by the table's full key read from the images.
 */
export function decodeChangelogRow(row: DecodableChangelogRow): DecodedChangelogRow {
  const oldSide = readStateSide(row.oldRowState);
  const newSide = readStateSide(row.newRowState);

  if (oldSide.kind === 'undecodable' || newSide.kind === 'undecodable') return { records: [], undecodable: true };

  if (oldSide.kind === 'array' || newSide.kind === 'array') {
    return { records: pairLegacyImages(row, imagesOf(oldSide), imagesOf(newSide)), undecodable: false };
  }

  if (oldSide.kind === 'absent' && newSide.kind === 'absent') return { records: [], undecodable: false };

  return {
    records: [
      {
        primaryKey: splitEditOperationRecordID(row.recordID).primaryKey,
        oldState: oldSide.kind === 'object' ? oldSide.image : null,
        newState: newSide.kind === 'object' ? newSide.image : null
      }
    ],
    undecodable: false
  };
}
