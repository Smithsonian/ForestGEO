// Pure, DB-free parser/validator for the `species_correction_metadata` marker
// row a #427 tree-species correction embeds on both the before- and
// after-state arrays of an `EditOperationRecord` (see
// `tree-species-correction-writer.ts`'s `buildMetadataStateRow`). Narrows
// untrusted, already-JSON-parsed `unknown` data into the producer's own
// `SpeciesCorrectionMetadata` shape and cross-checks it against the rest of
// the record (outer dataType/plot/census/target, sibling snapshot rows,
// before/after agreement). Never touches a database connection, a
// transaction, or any route/runtime undo behavior.
import type { EditOperationDataType, EditOperationRecord, EditOperationStateRow } from '@/config/editoperations';
import {
  SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS,
  SPECIES_CORRECTION_DIFF_STEMS_COLUMNS,
  SPECIES_CORRECTION_METADATA_TABLE,
  SPECIES_CORRECTION_METADATA_VERSION,
  type SpeciesCorrectionColumnChange,
  type SpeciesCorrectionDiffCoreMeasurementColumn,
  type SpeciesCorrectionDiffStemColumn,
  type SpeciesCorrectionDomainDiff,
  type SpeciesCorrectionMetadata,
  type SpeciesCorrectionMetadataMeasurement
} from './tree-species-correction-writer';
import type { SpeciesCorrectionStemPrecondition } from './types';
import { fieldChanged } from './storedfieldcomparison';

/** Mirrors the producer's `buildMetadataStateRow`, which always writes `primaryKey: 'TreeID'`. */
export const SPECIES_CORRECTION_METADATA_MARKER_PRIMARY_KEY = 'TreeID';

const COREMEASUREMENTS_TABLE = 'coremeasurements';
const STEMS_TABLE = 'stems';
const TREES_TABLE = 'trees';
const TREES_PRIMARY_KEY = 'TreeID';
const COREMEASUREMENTS_PRIMARY_KEY = 'CoreMeasurementID';
const STEMS_PRIMARY_KEY = 'StemGUID';
const MEASUREMENTSSUMMARY_DATA_TYPE: EditOperationDataType = 'measurementssummary';

type SpeciesCorrectionDiffColumnKind = 'decimal' | 'date' | 'text';

// Keyed by the producer's own column union types, so a future addition to
// SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS/_STEMS_COLUMNS fails to
// compile here rather than passing through unvalidated.
const SPECIES_CORRECTION_DIFF_COLUMN_KINDS: Record<
  SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn,
  SpeciesCorrectionDiffColumnKind
> = {
  MeasuredDBH: 'decimal',
  MeasuredHOM: 'decimal',
  RawX: 'decimal',
  RawY: 'decimal',
  RawPlotX: 'decimal',
  RawPlotY: 'decimal',
  LocalX: 'decimal',
  LocalY: 'decimal',
  PlotX: 'decimal',
  PlotY: 'decimal',
  MeasurementDate: 'date',
  Description: 'text',
  RawComments: 'text',
  RawCodes: 'text'
};

function kindFor(
  column: SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn,
  editOperationID: number,
  description: string
): SpeciesCorrectionDiffColumnKind {
  const kind = SPECIES_CORRECTION_DIFF_COLUMN_KINDS[column];
  if (!kind) fail(editOperationID, `${description} has no stored-column kind mapped for "${column}"`);
  return kind;
}

const STORED_DECIMAL_PRECISION = 12;
const STORED_DECIMAL_SCALE = 6;
const STORED_DECIMAL_MAX_EXCLUSIVE = 10 ** (STORED_DECIMAL_PRECISION - STORED_DECIMAL_SCALE);
const DECIMAL_STRING_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class SpeciesCorrectionUndoMetadataError extends Error {
  constructor(
    public readonly editOperationID: number,
    message: string
  ) {
    super(`parseSpeciesCorrectionUndoMetadata: EditOperationID=${editOperationID}: ${message}`);
    this.name = 'SpeciesCorrectionUndoMetadataError';
  }
}

export interface SpeciesCorrectionUndoMetadataPair {
  before: SpeciesCorrectionMetadata;
  after: SpeciesCorrectionMetadata;
}

function fail(editOperationID: number, message: string): never {
  throw new SpeciesCorrectionUndoMetadataError(editOperationID, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePlainObject(value: unknown, editOperationID: number, description: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(editOperationID, `${description} is not a plain object (received ${JSON.stringify(value)})`);
  return value;
}

function requirePositiveInteger(value: unknown, editOperationID: number, description: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(editOperationID, `${description} must be a positive integer (received ${JSON.stringify(value)})`);
  }
  return value;
}

function requireNonBlankString(value: unknown, editOperationID: number, description: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(editOperationID, `${description} must be a non-blank string (received ${JSON.stringify(value)})`);
  }
  return value;
}

function requireStrictBoolean(value: unknown, editOperationID: number, description: string): boolean {
  if (typeof value !== 'boolean') fail(editOperationID, `${description} must be a boolean (received ${JSON.stringify(value)})`);
  return value;
}

// NULL is preserved verbatim as evidence of a prior unset RawSpCode; an empty
// string is a distinct, equally valid value. Neither is coerced into the other.
function requireStringOrNull(value: unknown, editOperationID: number, description: string): string | null {
  if (value === null || typeof value === 'string') return value;
  fail(editOperationID, `${description} must be a string or null (received ${JSON.stringify(value)})`);
}

// `EditOperationStateRow.primaryKeyValue` is `string | number`; a numeric
// string that parses to the exact integer is accepted, a float or non-numeric
// string is not.
function toExactInteger(value: string | number): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function requireStateRow(value: unknown, editOperationID: number, label: string, index: number): EditOperationStateRow {
  const obj = requirePlainObject(value, editOperationID, `${label}[${index}]`);
  const table = obj.table;
  if (typeof table !== 'string') fail(editOperationID, `${label}[${index}].table is not a string (received ${JSON.stringify(table)})`);
  const primaryKey = obj.primaryKey;
  if (typeof primaryKey !== 'string') fail(editOperationID, `${label}[${index}].primaryKey is not a string (received ${JSON.stringify(primaryKey)})`);
  const primaryKeyValue = obj.primaryKeyValue;
  if (typeof primaryKeyValue !== 'string' && typeof primaryKeyValue !== 'number') {
    fail(editOperationID, `${label}[${index}].primaryKeyValue is not a string or number (received ${JSON.stringify(primaryKeyValue)})`);
  }
  const rawRow = obj.row;
  let row: Record<string, unknown> | null;
  if (rawRow === null) row = null;
  else if (isPlainObject(rawRow)) row = rawRow;
  else {
    fail(editOperationID, `${label}[${index}].row is not null or a plain object (received ${JSON.stringify(rawRow)})`);
  }
  return { table, primaryKey, primaryKeyValue, row };
}

function requireStateArray(value: unknown, editOperationID: number, label: string): EditOperationStateRow[] {
  if (!Array.isArray(value)) fail(editOperationID, `record.${label} is not an array`);
  return value.map((element, index) => requireStateRow(element, editOperationID, label, index));
}

interface MarkerLookup {
  stateRow: EditOperationStateRow;
  row: Record<string, unknown>;
}

function findMarkerRow(stateRows: EditOperationStateRow[], editOperationID: number, side: string): MarkerLookup | null {
  const markers = stateRows.filter(row => row.table === SPECIES_CORRECTION_METADATA_TABLE);
  if (markers.length > 1) fail(editOperationID, `duplicate ${SPECIES_CORRECTION_METADATA_TABLE} marker rows on ${side} (found ${markers.length})`);
  if (markers.length === 0) return null;
  const marker = markers[0];
  if (marker.primaryKey !== SPECIES_CORRECTION_METADATA_MARKER_PRIMARY_KEY) {
    fail(
      editOperationID,
      `${side} ${SPECIES_CORRECTION_METADATA_TABLE} marker has primaryKey "${marker.primaryKey}", expected "${SPECIES_CORRECTION_METADATA_MARKER_PRIMARY_KEY}"`
    );
  }
  if (marker.row === null) fail(editOperationID, `${side} ${SPECIES_CORRECTION_METADATA_TABLE} marker has a null row`);
  return { stateRow: marker, row: marker.row };
}

function checkMarkerPrimaryKeyValue(primaryKeyValue: string | number, targetTreeID: number, editOperationID: number, side: string): void {
  const parsed = toExactInteger(primaryKeyValue);
  if (parsed === null || parsed !== targetTreeID) {
    fail(
      editOperationID,
      `${side} ${SPECIES_CORRECTION_METADATA_TABLE} marker primaryKeyValue (${JSON.stringify(primaryKeyValue)}) does not equal metadata.targetTreeID (${targetTreeID})`
    );
  }
}

// `expectedCensusID` is the side's own `metadata.censusID`: a correction is
// scoped to one census, so membership outside it is rejected here rather
// than by a later re-walk of the parsed array.
function parseStems(value: unknown, expectedCensusID: number, editOperationID: number, side: string): SpeciesCorrectionStemPrecondition[] {
  if (!Array.isArray(value)) fail(editOperationID, `${side} metadata.stems is not an array`);
  const seen = new Set<number>();
  return value.map((item, index) => {
    const label = `${side} metadata.stems[${index}]`;
    const obj = requirePlainObject(item, editOperationID, label);
    const stemGUID = requirePositiveInteger(obj.stemGUID, editOperationID, `${label}.stemGUID`);
    const censusID = requirePositiveInteger(obj.censusID, editOperationID, `${label}.censusID`);
    const quadratID = requirePositiveInteger(obj.quadratID, editOperationID, `${label}.quadratID`);
    const isActive = requireStrictBoolean(obj.isActive, editOperationID, `${label}.isActive`);
    if (seen.has(stemGUID)) fail(editOperationID, `${side} metadata.stems has duplicate stemGUID ${stemGUID}`);
    seen.add(stemGUID);
    if (censusID !== expectedCensusID) {
      fail(editOperationID, `${label}.censusID (${censusID}) does not equal ${side} metadata.censusID (${expectedCensusID})`);
    }
    return { stemGUID, censusID, quadratID, isActive };
  });
}

function parseMeasurements(
  value: unknown,
  stems: SpeciesCorrectionStemPrecondition[],
  expectedCensusID: number,
  editOperationID: number,
  side: string
): SpeciesCorrectionMetadataMeasurement[] {
  if (!Array.isArray(value)) fail(editOperationID, `${side} metadata.measurements is not an array`);
  const stemGUIDs = new Set(stems.map(stem => stem.stemGUID));
  const seen = new Set<number>();
  return value.map((item, index) => {
    const label = `${side} metadata.measurements[${index}]`;
    const obj = requirePlainObject(item, editOperationID, label);
    const coreMeasurementID = requirePositiveInteger(obj.coreMeasurementID, editOperationID, `${label}.coreMeasurementID`);
    const stemGUID = requirePositiveInteger(obj.stemGUID, editOperationID, `${label}.stemGUID`);
    const censusID = requirePositiveInteger(obj.censusID, editOperationID, `${label}.censusID`);
    const isActive = requireStrictBoolean(obj.isActive, editOperationID, `${label}.isActive`);
    const rawSpCode = requireStringOrNull(obj.rawSpCode, editOperationID, `${label}.rawSpCode`);
    if (seen.has(coreMeasurementID)) fail(editOperationID, `${side} metadata.measurements has duplicate coreMeasurementID ${coreMeasurementID}`);
    seen.add(coreMeasurementID);
    if (!stemGUIDs.has(stemGUID)) {
      fail(editOperationID, `${side} metadata.measurements[${index}] references stemGUID ${stemGUID} not present in metadata.stems`);
    }
    if (censusID !== expectedCensusID) {
      fail(editOperationID, `${label}.censusID (${censusID}) does not equal ${side} metadata.censusID (${expectedCensusID})`);
    }
    return { coreMeasurementID, stemGUID, censusID, isActive, rawSpCode };
  });
}

function requireEditedMeasurementLink(
  measurements: SpeciesCorrectionMetadataMeasurement[],
  editedCoreMeasurementID: number,
  editedStemGUID: number,
  editOperationID: number,
  side: string
): void {
  // Found by PK, never by array position — membership order is not meaningful.
  const target = measurements.find(measurement => measurement.coreMeasurementID === editedCoreMeasurementID);
  if (!target) fail(editOperationID, `${side} metadata.measurements has no entry for editedCoreMeasurementID=${editedCoreMeasurementID}`);
  if (target.stemGUID !== editedStemGUID) {
    fail(
      editOperationID,
      `${side} metadata.measurements[editedCoreMeasurementID=${editedCoreMeasurementID}].stemGUID (${target.stemGUID}) does not equal editedStemGUID (${editedStemGUID})`
    );
  }
  if (target.isActive !== true) {
    fail(editOperationID, `${side} metadata.measurements[editedCoreMeasurementID=${editedCoreMeasurementID}] is not active`);
  }
}

function requireEditedStemActive(stems: SpeciesCorrectionStemPrecondition[], editedStemGUID: number, editOperationID: number, side: string): void {
  const target = stems.find(stem => stem.stemGUID === editedStemGUID);
  if (!target) fail(editOperationID, `${side} metadata.stems has no entry for editedStemGUID=${editedStemGUID}`);
  if (target.isActive !== true) fail(editOperationID, `${side} metadata.stems[editedStemGUID=${editedStemGUID}] is not active`);
}

function requireStoredDecimalInRange(numeric: number, editOperationID: number, description: string): void {
  if (Math.abs(numeric) >= STORED_DECIMAL_MAX_EXCLUSIVE) {
    const storedDecimalType = `decimal(${STORED_DECIMAL_PRECISION},${STORED_DECIMAL_SCALE})`;
    fail(editOperationID, `${description} exceeds the stored ${storedDecimalType} bound of magnitude < ${STORED_DECIMAL_MAX_EXCLUSIVE} (received ${numeric})`);
  }
}

function isCompleteStoredDate(value: string): boolean {
  if (CALENDAR_DATE_PATTERN.test(value)) {
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && new Date(value).toISOString().slice(0, 10) === value;
  }
  if (ISO_INSTANT_PATTERN.test(value)) {
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && new Date(value).toISOString() === value;
  }
  return false;
}

// These records are read back as parsed JSON (not live mysql2 rows), so a
// stored DATE/DATETIME column arrives as an ISO string, never a Date
// instance — any object (Date included) is rejected. Validation is per the
// actual stored column type (decimal/date/text), not a generic scalar: a
// boolean, an out-of-range numeric string, or an invalid calendar date is
// rejected regardless of shape.
function requireStoredColumnValue(
  column: SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn,
  value: unknown,
  editOperationID: number,
  description: string
): string | number | null {
  const kind = kindFor(column, editOperationID, description);
  if (value === null) return null;
  if (kind === 'decimal') {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail(editOperationID, `${description} is not a finite decimal (received ${JSON.stringify(value)})`);
      requireStoredDecimalInRange(value, editOperationID, description);
      return value;
    }
    if (typeof value === 'string' && DECIMAL_STRING_PATTERN.test(value) && Number.isFinite(Number(value))) {
      requireStoredDecimalInRange(Number(value), editOperationID, description);
      return value;
    }
    fail(editOperationID, `${description} must be null, a finite number, or a decimal string (received ${JSON.stringify(value)})`);
  }
  if (kind === 'date') {
    if (typeof value === 'string' && isCompleteStoredDate(value)) return value;
    fail(editOperationID, `${description} must be null or a complete YYYY-MM-DD / ISO instant calendar date string (received ${JSON.stringify(value)})`);
  }
  if (typeof value === 'string') return value;
  fail(editOperationID, `${description} must be null or a string (received ${JSON.stringify(value)})`);
}

// `fieldChanged`/`PER_COLUMN_DECIMAL_PRECISION` are keyed on UI field names
// (StemPlotX, DBH, ...), not these stored column names (RawX, LocalX, ...),
// so the shared comparator alone cannot round decimals here.
function storedValuesDiffer(column: SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn, a: unknown, b: unknown): boolean {
  const kind = SPECIES_CORRECTION_DIFF_COLUMN_KINDS[column];
  if (kind === 'decimal') {
    if (a === null || b === null) return a !== b;
    const numA = Number(a);
    const numB = Number(b);
    if (!Number.isFinite(numA) || !Number.isFinite(numB)) return true;
    return numA.toFixed(STORED_DECIMAL_SCALE) !== numB.toFixed(STORED_DECIMAL_SCALE);
  }
  if (kind === 'date') return fieldChanged(column, a, b);
  return !Object.is(a, b);
}

function parseColumnChanges<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  value: unknown,
  allowedColumns: readonly TColumn[],
  editOperationID: number,
  description: string
): Partial<Record<TColumn, SpeciesCorrectionColumnChange>> {
  const raw = requirePlainObject(value, editOperationID, description);
  const allowed = new Set<string>(allowedColumns);
  const result: Partial<Record<TColumn, SpeciesCorrectionColumnChange>> = {};
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) fail(editOperationID, `${description} has unknown column "${key}"`);
    // `key` is checked against `allowedColumns` (the `TColumn` universe)
    // immediately above, so this narrowing is validated, not assumed.
    const column = key as TColumn;
    const entryLabel = `${description}.${key}`;
    const entry = requirePlainObject(raw[key], editOperationID, entryLabel);
    if (!Object.prototype.hasOwnProperty.call(entry, 'before')) fail(editOperationID, `${entryLabel} is missing "before"`);
    if (!Object.prototype.hasOwnProperty.call(entry, 'after')) fail(editOperationID, `${entryLabel} is missing "after"`);
    const before = requireStoredColumnValue(column, entry.before, editOperationID, `${entryLabel}.before`);
    const after = requireStoredColumnValue(column, entry.after, editOperationID, `${entryLabel}.after`);
    // The producer only records columns that actually changed; a
    // present-but-equal entry is contradictory evidence.
    if (!storedValuesDiffer(column, before, after)) {
      fail(editOperationID, `${entryLabel} declares before/after that are not actually different under storedValuesDiffer`);
    }
    result[column] = { before, after };
  }
  return result;
}

function parseAttributeCodesArray(value: unknown, editOperationID: number, description: string): string[] {
  if (!Array.isArray(value)) fail(editOperationID, `${description} is not an array`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      fail(editOperationID, `${description}[${index}] must be a non-blank string (received ${JSON.stringify(item)})`);
    }
    if (seen.has(item)) fail(editOperationID, `${description} has duplicate attribute code "${item}"`);
    seen.add(item);
    return item;
  });
}

function parseDomainDiff(value: unknown, editOperationID: number, side: string): SpeciesCorrectionDomainDiff {
  const label = `${side} metadata.domainDiff`;
  const obj = requirePlainObject(value, editOperationID, label);
  const coremeasurements = parseColumnChanges<SpeciesCorrectionDiffCoreMeasurementColumn>(
    obj.coremeasurements,
    SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS,
    editOperationID,
    `${label}.coremeasurements`
  );
  const stems = parseColumnChanges<SpeciesCorrectionDiffStemColumn>(obj.stems, SPECIES_CORRECTION_DIFF_STEMS_COLUMNS, editOperationID, `${label}.stems`);
  const attributeCodesObj = requirePlainObject(obj.attributeCodes, editOperationID, `${label}.attributeCodes`);
  const before = parseAttributeCodesArray(attributeCodesObj.before, editOperationID, `${label}.attributeCodes.before`);
  const after = parseAttributeCodesArray(attributeCodesObj.after, editOperationID, `${label}.attributeCodes.after`);
  return { coremeasurements, stems, attributeCodes: { before, after } };
}

function parseMetadataSide(marker: MarkerLookup, editOperationID: number, side: string): SpeciesCorrectionMetadata {
  const row = marker.row;
  const label = `${side} metadata`;

  if (row.version !== SPECIES_CORRECTION_METADATA_VERSION) {
    fail(editOperationID, `${label}.version is unsupported (received ${JSON.stringify(row.version)}, expected ${SPECIES_CORRECTION_METADATA_VERSION})`);
  }
  if (row.operation !== 'tree-species-correction') {
    fail(editOperationID, `${label}.operation is unsupported (received ${JSON.stringify(row.operation)})`);
  }

  const targetTreeID = requirePositiveInteger(row.targetTreeID, editOperationID, `${label}.targetTreeID`);
  const treeTag = requireNonBlankString(row.treeTag, editOperationID, `${label}.treeTag`);
  const plotID = requirePositiveInteger(row.plotID, editOperationID, `${label}.plotID`);
  const censusID = requirePositiveInteger(row.censusID, editOperationID, `${label}.censusID`);
  const speciesID = requirePositiveInteger(row.speciesID, editOperationID, `${label}.speciesID`);
  const speciesCode = requireNonBlankString(row.speciesCode, editOperationID, `${label}.speciesCode`);
  const editedCoreMeasurementID = requirePositiveInteger(row.editedCoreMeasurementID, editOperationID, `${label}.editedCoreMeasurementID`);
  const editedStemGUID = requirePositiveInteger(row.editedStemGUID, editOperationID, `${label}.editedStemGUID`);

  const stems = parseStems(row.stems, censusID, editOperationID, side);
  const measurements = parseMeasurements(row.measurements, stems, censusID, editOperationID, side);
  requireEditedMeasurementLink(measurements, editedCoreMeasurementID, editedStemGUID, editOperationID, side);
  requireEditedStemActive(stems, editedStemGUID, editOperationID, side);

  const domainDiff = parseDomainDiff(row.domainDiff, editOperationID, side);

  checkMarkerPrimaryKeyValue(marker.stateRow.primaryKeyValue, targetTreeID, editOperationID, side);

  return {
    version: SPECIES_CORRECTION_METADATA_VERSION,
    operation: 'tree-species-correction',
    targetTreeID,
    treeTag,
    plotID,
    censusID,
    speciesID,
    speciesCode,
    stems,
    measurements,
    editedCoreMeasurementID,
    editedStemGUID,
    domainDiff
  };
}

function requireSameScalar<T>(before: T, after: T, editOperationID: number, fieldName: string): void {
  if (before !== after) {
    fail(editOperationID, `metadata.${fieldName} differs between beforeState (${JSON.stringify(before)}) and afterState (${JSON.stringify(after)})`);
  }
}

function requireSameStemSet(before: SpeciesCorrectionStemPrecondition[], after: SpeciesCorrectionStemPrecondition[], editOperationID: number): void {
  if (before.length !== after.length) {
    fail(editOperationID, `metadata.stems membership size differs between beforeState (${before.length}) and afterState (${after.length})`);
  }
  const afterByGUID = new Map(after.map(stem => [stem.stemGUID, stem]));
  for (const beforeStem of before) {
    const afterStem = afterByGUID.get(beforeStem.stemGUID);
    if (!afterStem) fail(editOperationID, `metadata.stems stemGUID ${beforeStem.stemGUID} present on beforeState but missing on afterState`);
    if (afterStem.censusID !== beforeStem.censusID || afterStem.quadratID !== beforeStem.quadratID || afterStem.isActive !== beforeStem.isActive) {
      fail(editOperationID, `metadata.stems stemGUID ${beforeStem.stemGUID} has different censusID/quadratID/isActive between beforeState and afterState`);
    }
  }
}

function requireSameMeasurementSet(
  before: SpeciesCorrectionMetadataMeasurement[],
  after: SpeciesCorrectionMetadataMeasurement[],
  editOperationID: number
): void {
  if (before.length !== after.length) {
    fail(editOperationID, `metadata.measurements membership size differs between beforeState (${before.length}) and afterState (${after.length})`);
  }
  const afterByID = new Map(after.map(measurement => [measurement.coreMeasurementID, measurement]));
  for (const beforeMeasurement of before) {
    const afterMeasurement = afterByID.get(beforeMeasurement.coreMeasurementID);
    if (!afterMeasurement) {
      fail(editOperationID, `metadata.measurements coreMeasurementID ${beforeMeasurement.coreMeasurementID} present on beforeState but missing on afterState`);
    }
    // rawSpCode is deliberately excluded: differing per side is the
    // correction's own evidence, not a drift.
    if (
      afterMeasurement.stemGUID !== beforeMeasurement.stemGUID ||
      afterMeasurement.censusID !== beforeMeasurement.censusID ||
      afterMeasurement.isActive !== beforeMeasurement.isActive
    ) {
      fail(
        editOperationID,
        `metadata.measurements coreMeasurementID ${beforeMeasurement.coreMeasurementID} has different stemGUID/censusID/isActive between beforeState and afterState`
      );
    }
  }
}

function requireSameColumnChanges<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  before: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  after: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  table: string,
  editOperationID: number
): void {
  // `before`/`after` are keyed by `TColumn` even though `Object.keys` widens
  // to `string[]`; both maps were built by `parseColumnChanges` against the
  // same `TColumn` allowlist, so this narrowing is validated, not assumed.
  const beforeKeys = Object.keys(before) as TColumn[];
  const afterKeySet = new Set(Object.keys(after));
  if (beforeKeys.length !== afterKeySet.size || beforeKeys.some(key => !afterKeySet.has(key))) {
    fail(editOperationID, `domainDiff.${table} column key set differs between beforeState and afterState metadata`);
  }
  for (const column of beforeKeys) {
    const beforeChange = before[column];
    const afterChange = after[column];
    if (!beforeChange || !afterChange) continue;
    if (storedValuesDiffer(column, beforeChange.before, afterChange.before) || storedValuesDiffer(column, beforeChange.after, afterChange.after)) {
      fail(editOperationID, `domainDiff.${table}.${column} differs between beforeState and afterState metadata`);
    }
  }
}

function requireSameAttributeCodesArray(before: string[], after: string[], label: string, editOperationID: number): void {
  if (before.length !== after.length || before.some((code, index) => code !== after[index])) {
    fail(editOperationID, `domainDiff.${label} differs between beforeState and afterState metadata`);
  }
}

function requireSameDomainDiff(before: SpeciesCorrectionDomainDiff, after: SpeciesCorrectionDomainDiff, editOperationID: number): void {
  requireSameColumnChanges(before.coremeasurements, after.coremeasurements, COREMEASUREMENTS_TABLE, editOperationID);
  requireSameColumnChanges(before.stems, after.stems, STEMS_TABLE, editOperationID);
  requireSameAttributeCodesArray(before.attributeCodes.before, after.attributeCodes.before, 'attributeCodes.before', editOperationID);
  requireSameAttributeCodesArray(before.attributeCodes.after, after.attributeCodes.after, 'attributeCodes.after', editOperationID);
}

// PK lookup is never by array order: the row's own `primaryKey` column name must match the table's expected PK, and more than one (table, pk) match is rejected.
function findStateRowByPrimaryKeyValue(
  stateRows: EditOperationStateRow[],
  table: string,
  expectedPrimaryKey: string,
  primaryKeyValue: number,
  editOperationID: number,
  side: string
): EditOperationStateRow | null {
  const matches = stateRows.filter(row => row.table === table && toExactInteger(row.primaryKeyValue) === primaryKeyValue);
  if (matches.length > 1) {
    fail(editOperationID, `${side} has ${matches.length} ${table} snapshot rows for pk=${primaryKeyValue}, expected at most one`);
  }
  const match = matches[0];
  if (!match) return null;
  if (match.primaryKey !== expectedPrimaryKey) {
    fail(editOperationID, `${side} ${table} snapshot row (pk=${primaryKeyValue}) has primaryKey "${match.primaryKey}", expected "${expectedPrimaryKey}"`);
  }
  return match;
}

// `toExactInteger`-style parse for a required snapshot column; a missing column is malformed evidence, not "unknown".
function requireSnapshotIntegerColumn(row: Record<string, unknown>, column: string, editOperationID: number, description: string): number {
  if (!Object.prototype.hasOwnProperty.call(row, column)) fail(editOperationID, `${description} is missing column "${column}"`);
  const raw = row[column];
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    fail(editOperationID, `${description} column "${column}" must be a number or numeric string (received ${JSON.stringify(raw)})`);
  }
  const parsed = toExactInteger(raw);
  if (parsed === null) fail(editOperationID, `${description} column "${column}" is not an exact integer (received ${JSON.stringify(raw)})`);
  return parsed;
}

function requireSnapshotStringColumn(row: Record<string, unknown>, column: string, editOperationID: number, description: string): string {
  if (!Object.prototype.hasOwnProperty.call(row, column)) fail(editOperationID, `${description} is missing column "${column}"`);
  const raw = row[column];
  if (typeof raw !== 'string') fail(editOperationID, `${description} column "${column}" must be a string (received ${JSON.stringify(raw)})`);
  return raw;
}

function requireSnapshotStringOrNullColumn(row: Record<string, unknown>, column: string, editOperationID: number, description: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, column)) fail(editOperationID, `${description} is missing column "${column}"`);
  const raw = row[column];
  if (raw === null || typeof raw === 'string') return raw;
  fail(editOperationID, `${description} column "${column}" must be null or a string (received ${JSON.stringify(raw)})`);
}

// A stored tinyint(1) activity flag arrives as a boolean, 0/1, or '0'/'1'; anything else is malformed.
function requireSnapshotActivityColumn(row: Record<string, unknown>, column: string, editOperationID: number, description: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(row, column)) fail(editOperationID, `${description} is missing column "${column}"`);
  const raw = row[column];
  if (raw === true || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 0 || raw === '0') return false;
  fail(editOperationID, `${description} column "${column}" must be a boolean-like activity flag (received ${JSON.stringify(raw)})`);
}

// The before-side snapshot must carry the OLD SpeciesID, the after-side the NEW one — each checked against THIS side's own metadata.speciesID, so a corrupted before-species can't be restored against contradictory evidence.
function checkTreesSnapshot(stateRows: EditOperationStateRow[], metadata: SpeciesCorrectionMetadata, side: string, editOperationID: number): void {
  const stateRow = findStateRowByPrimaryKeyValue(stateRows, TREES_TABLE, TREES_PRIMARY_KEY, metadata.targetTreeID, editOperationID, side);
  if (!stateRow || stateRow.row === null) fail(editOperationID, `${side} is missing a ${TREES_TABLE} snapshot row for pk=${metadata.targetTreeID}`);
  const row = stateRow.row;
  const label = `${side} ${TREES_TABLE} snapshot row (pk=${metadata.targetTreeID})`;

  const treeID = requireSnapshotIntegerColumn(row, 'TreeID', editOperationID, label);
  if (treeID !== metadata.targetTreeID) {
    fail(editOperationID, `${label} TreeID (${treeID}) does not equal metadata.targetTreeID (${metadata.targetTreeID})`);
  }

  const treeTag = requireSnapshotStringColumn(row, 'TreeTag', editOperationID, label);
  if (treeTag !== metadata.treeTag) {
    fail(editOperationID, `${label} TreeTag (${JSON.stringify(treeTag)}) does not equal metadata.treeTag (${JSON.stringify(metadata.treeTag)})`);
  }

  const censusID = requireSnapshotIntegerColumn(row, 'CensusID', editOperationID, label);
  if (censusID !== metadata.censusID) {
    fail(editOperationID, `${label} CensusID (${censusID}) does not equal metadata.censusID (${metadata.censusID})`);
  }

  const speciesID = requireSnapshotIntegerColumn(row, 'SpeciesID', editOperationID, label);
  if (speciesID !== metadata.speciesID) {
    fail(editOperationID, `${label} SpeciesID (${speciesID}) does not equal ${side} metadata.speciesID (${metadata.speciesID})`);
  }
}

function checkStemsSnapshot(stateRows: EditOperationStateRow[], metadata: SpeciesCorrectionMetadata, side: string, editOperationID: number): void {
  const declaredStem = metadata.stems.find(stem => stem.stemGUID === metadata.editedStemGUID);
  if (!declaredStem) fail(editOperationID, `${side} metadata.stems has no entry for editedStemGUID=${metadata.editedStemGUID}`);

  const stateRow = findStateRowByPrimaryKeyValue(stateRows, STEMS_TABLE, STEMS_PRIMARY_KEY, metadata.editedStemGUID, editOperationID, side);
  if (!stateRow || stateRow.row === null) fail(editOperationID, `${side} is missing a ${STEMS_TABLE} snapshot row for pk=${metadata.editedStemGUID}`);
  const row = stateRow.row;
  const label = `${side} ${STEMS_TABLE} snapshot row (pk=${metadata.editedStemGUID})`;

  const stemGUID = requireSnapshotIntegerColumn(row, 'StemGUID', editOperationID, label);
  if (stemGUID !== metadata.editedStemGUID) {
    fail(editOperationID, `${label} StemGUID (${stemGUID}) does not equal metadata.editedStemGUID (${metadata.editedStemGUID})`);
  }

  const treeID = requireSnapshotIntegerColumn(row, 'TreeID', editOperationID, label);
  if (treeID !== metadata.targetTreeID) {
    fail(editOperationID, `${label} TreeID (${treeID}) does not equal metadata.targetTreeID (${metadata.targetTreeID})`);
  }

  const censusID = requireSnapshotIntegerColumn(row, 'CensusID', editOperationID, label);
  if (censusID !== metadata.censusID) {
    fail(editOperationID, `${label} CensusID (${censusID}) does not equal metadata.censusID (${metadata.censusID})`);
  }

  const quadratID = requireSnapshotIntegerColumn(row, 'QuadratID', editOperationID, label);
  if (quadratID !== declaredStem.quadratID) {
    fail(
      editOperationID,
      `${label} QuadratID (${quadratID}) does not equal metadata.stems[stemGUID=${metadata.editedStemGUID}].quadratID (${declaredStem.quadratID})`
    );
  }

  const isActive = requireSnapshotActivityColumn(row, 'IsActive', editOperationID, label);
  if (isActive !== declaredStem.isActive) {
    fail(
      editOperationID,
      `${label} IsActive (${isActive}) does not equal metadata.stems[stemGUID=${metadata.editedStemGUID}].isActive (${declaredStem.isActive})`
    );
  }
}

// Cross-checks one coremeasurements snapshot row against the declared member it claims to be. RawSpCode is the raw evidence an undo restores: compared byte-exact, NULL included.
function checkCoreMeasurementMemberSnapshot(
  row: Record<string, unknown>,
  member: SpeciesCorrectionMetadataMeasurement,
  side: string,
  editOperationID: number
): void {
  const label = `${side} ${COREMEASUREMENTS_TABLE} snapshot row (pk=${member.coreMeasurementID})`;
  const memberLabel = `metadata.measurements[coreMeasurementID=${member.coreMeasurementID}]`;

  const coreMeasurementID = requireSnapshotIntegerColumn(row, 'CoreMeasurementID', editOperationID, label);
  if (coreMeasurementID !== member.coreMeasurementID) {
    fail(editOperationID, `${label} CoreMeasurementID (${coreMeasurementID}) does not equal ${memberLabel}.coreMeasurementID`);
  }

  const stemGUID = requireSnapshotIntegerColumn(row, 'StemGUID', editOperationID, label);
  if (stemGUID !== member.stemGUID) {
    fail(editOperationID, `${label} StemGUID (${stemGUID}) does not equal ${memberLabel}.stemGUID (${member.stemGUID})`);
  }

  const censusID = requireSnapshotIntegerColumn(row, 'CensusID', editOperationID, label);
  if (censusID !== member.censusID) {
    fail(editOperationID, `${label} CensusID (${censusID}) does not equal ${memberLabel}.censusID (${member.censusID})`);
  }

  const isActive = requireSnapshotActivityColumn(row, 'IsActive', editOperationID, label);
  if (isActive !== member.isActive) {
    fail(editOperationID, `${label} IsActive (${isActive}) does not equal ${memberLabel}.isActive (${member.isActive})`);
  }

  const rawSpCode = requireSnapshotStringOrNullColumn(row, 'RawSpCode', editOperationID, label);
  if (rawSpCode !== member.rawSpCode) {
    fail(editOperationID, `${label} RawSpCode (${JSON.stringify(rawSpCode)}) does not equal ${memberLabel}.rawSpCode (${JSON.stringify(member.rawSpCode)})`);
  }
}

// The trees row, the edited stem row, and the edited coremeasurements row are hard-required on every side regardless of domainDiff; every OTHER declared member's coremeasurements row is cross-checked only if present.
function checkSideSnapshot(stateRows: EditOperationStateRow[], metadata: SpeciesCorrectionMetadata, side: string, editOperationID: number): void {
  checkTreesSnapshot(stateRows, metadata, side, editOperationID);
  checkStemsSnapshot(stateRows, metadata, side, editOperationID);

  const editedStateRow = findStateRowByPrimaryKeyValue(
    stateRows,
    COREMEASUREMENTS_TABLE,
    COREMEASUREMENTS_PRIMARY_KEY,
    metadata.editedCoreMeasurementID,
    editOperationID,
    side
  );
  if (!editedStateRow || editedStateRow.row === null) {
    fail(editOperationID, `${side} is missing a ${COREMEASUREMENTS_TABLE} snapshot row for pk=${metadata.editedCoreMeasurementID} (the edited measurement)`);
  }
  const editedMember = metadata.measurements.find(measurement => measurement.coreMeasurementID === metadata.editedCoreMeasurementID);
  if (!editedMember) fail(editOperationID, `${side} metadata.measurements has no entry for editedCoreMeasurementID=${metadata.editedCoreMeasurementID}`);
  checkCoreMeasurementMemberSnapshot(editedStateRow.row, editedMember, side, editOperationID);

  for (const member of metadata.measurements) {
    if (member.coreMeasurementID === metadata.editedCoreMeasurementID) continue;
    const siblingStateRow = findStateRowByPrimaryKeyValue(
      stateRows,
      COREMEASUREMENTS_TABLE,
      COREMEASUREMENTS_PRIMARY_KEY,
      member.coreMeasurementID,
      editOperationID,
      side
    );
    if (!siblingStateRow || siblingStateRow.row === null) continue;
    checkCoreMeasurementMemberSnapshot(siblingStateRow.row, member, side, editOperationID);
  }
}

function requireSnapshotColumnMatches<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  row: Record<string, unknown>,
  expected: unknown,
  table: string,
  column: TColumn,
  primaryKeyValue: number,
  side: string,
  editOperationID: number
): void {
  if (!Object.prototype.hasOwnProperty.call(row, column)) {
    fail(editOperationID, `${side} ${table} snapshot row (pk=${primaryKeyValue}) is missing column "${column}" declared in domainDiff`);
  }
  if (storedValuesDiffer(column, row[column], expected)) {
    fail(
      editOperationID,
      `${side} ${table} snapshot row (pk=${primaryKeyValue}) column "${column}" (${JSON.stringify(row[column])}) does not match domainDiff evidence (${JSON.stringify(expected)})`
    );
  }
}

function checkTableSnapshot<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  beforeStateRows: EditOperationStateRow[],
  afterStateRows: EditOperationStateRow[],
  table: string,
  expectedPrimaryKey: string,
  primaryKeyValue: number,
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  editOperationID: number
): void {
  // Same `Object.keys` widening as `requireSameColumnChanges`, narrowed back
  // to `TColumn` on the same "built from the allowlist" basis.
  const columns = Object.keys(changes) as TColumn[];
  // No diff evidence for this column set: existence of the row itself is already required by `checkSideSnapshot`.
  if (columns.length === 0) return;

  const beforeRow = findStateRowByPrimaryKeyValue(beforeStateRows, table, expectedPrimaryKey, primaryKeyValue, editOperationID, 'beforeState');
  if (!beforeRow || beforeRow.row === null)
    fail(editOperationID, `beforeState is missing a ${table} snapshot row for pk=${primaryKeyValue} required by domainDiff`);
  const afterRow = findStateRowByPrimaryKeyValue(afterStateRows, table, expectedPrimaryKey, primaryKeyValue, editOperationID, 'afterState');
  if (!afterRow || afterRow.row === null)
    fail(editOperationID, `afterState is missing a ${table} snapshot row for pk=${primaryKeyValue} required by domainDiff`);

  for (const column of columns) {
    const change = changes[column];
    if (!change) continue;
    requireSnapshotColumnMatches(beforeRow.row, change.before, table, column, primaryKeyValue, 'beforeState', editOperationID);
    requireSnapshotColumnMatches(afterRow.row, change.after, table, column, primaryKeyValue, 'afterState', editOperationID);
  }
}

// cmattributes is never cross-checked here: CMAID is a storage surrogate,
// not semantic identity — the metadata's explicit attributeCodes arrays are
// the sole authority for attribute-code evidence.
function checkSnapshots(
  beforeStateRows: EditOperationStateRow[],
  afterStateRows: EditOperationStateRow[],
  before: SpeciesCorrectionMetadata,
  after: SpeciesCorrectionMetadata,
  editOperationID: number
): void {
  checkSideSnapshot(beforeStateRows, before, 'beforeState', editOperationID);
  checkSideSnapshot(afterStateRows, after, 'afterState', editOperationID);

  checkTableSnapshot(
    beforeStateRows,
    afterStateRows,
    COREMEASUREMENTS_TABLE,
    COREMEASUREMENTS_PRIMARY_KEY,
    before.editedCoreMeasurementID,
    before.domainDiff.coremeasurements,
    editOperationID
  );
  checkTableSnapshot(beforeStateRows, afterStateRows, STEMS_TABLE, STEMS_PRIMARY_KEY, before.editedStemGUID, before.domainDiff.stems, editOperationID);
}

export function parseSpeciesCorrectionUndoMetadata(record: EditOperationRecord): SpeciesCorrectionUndoMetadataPair | null {
  const editOperationID = record.editOperationID;
  const beforeStateRows = requireStateArray(record.beforeState, editOperationID, 'beforeState');
  const afterStateRows = requireStateArray(record.afterState, editOperationID, 'afterState');

  const beforeMarker = findMarkerRow(beforeStateRows, editOperationID, 'beforeState');
  const afterMarker = findMarkerRow(afterStateRows, editOperationID, 'afterState');

  if (!beforeMarker && !afterMarker) return null;
  if (!beforeMarker || !afterMarker) {
    fail(editOperationID, `${SPECIES_CORRECTION_METADATA_TABLE} marker present on only one side (beforeState=${!!beforeMarker}, afterState=${!!afterMarker})`);
  }

  const before = parseMetadataSide(beforeMarker, editOperationID, 'beforeState');
  const after = parseMetadataSide(afterMarker, editOperationID, 'afterState');

  requireSameScalar(before.targetTreeID, after.targetTreeID, editOperationID, 'targetTreeID');
  requireSameScalar(before.treeTag, after.treeTag, editOperationID, 'treeTag');
  requireSameScalar(before.plotID, after.plotID, editOperationID, 'plotID');
  requireSameScalar(before.censusID, after.censusID, editOperationID, 'censusID');
  requireSameScalar(before.editedCoreMeasurementID, after.editedCoreMeasurementID, editOperationID, 'editedCoreMeasurementID');
  requireSameScalar(before.editedStemGUID, after.editedStemGUID, editOperationID, 'editedStemGUID');
  if (before.speciesID === after.speciesID) {
    fail(editOperationID, `metadata.speciesID is identical on beforeState and afterState (${before.speciesID}) — not an actual correction`);
  }

  requireSameStemSet(before.stems, after.stems, editOperationID);
  requireSameMeasurementSet(before.measurements, after.measurements, editOperationID);
  requireSameDomainDiff(before.domainDiff, after.domainDiff, editOperationID);

  if (record.dataType !== MEASUREMENTSSUMMARY_DATA_TYPE) {
    fail(editOperationID, `record.dataType must be "${MEASUREMENTSSUMMARY_DATA_TYPE}" for a species correction (received "${record.dataType}")`);
  }
  if (record.plotID !== before.plotID) {
    fail(editOperationID, `record.plotID (${record.plotID}) does not equal metadata.plotID (${before.plotID})`);
  }
  if (record.censusID !== before.censusID) {
    fail(editOperationID, `record.censusID (${record.censusID}) does not equal metadata.censusID (${before.censusID})`);
  }
  // A species correction is a single-target record; null (a batch summary) is never revertable here.
  if (record.targetID === null || record.targetID !== before.editedCoreMeasurementID) {
    fail(
      editOperationID,
      `record.targetID (${JSON.stringify(record.targetID)}) does not equal metadata.editedCoreMeasurementID (${before.editedCoreMeasurementID})`
    );
  }

  checkSnapshots(beforeStateRows, afterStateRows, before, after, editOperationID);

  return { before, after };
}
