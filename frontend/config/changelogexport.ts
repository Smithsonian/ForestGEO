import Papa from 'papaparse';
import { computeDiff, recordedFieldNames } from '@/config/changelogdiff';
import {
  decodeChangelogRow,
  FILE_UPLOAD_CHANGELOG_TABLE,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_CHANGELOG_TABLE,
  splitEditOperationRecordID,
  type ChangelogRecord,
  type ChangelogRowImage
} from '@/config/changelogdecode';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';

export const EXPORT_COLUMNS = [
  'LogID',
  'ChangedBy',
  'ChangedTable',
  'PrimaryKey',
  'ChangedColumn',
  'ChangeDate',
  'ChangeTime',
  'Description',
  'Action',
  'Old',
  'New',
  'PlotID',
  'CensusID'
] as const;

/** ChangedColumn of a row that summarizes a change instead of naming one field. */
export const SUMMARY_COLUMN_MARKER = '*';
export const NO_FILE_RECORDED_KEY = '(no file recorded)';
export const FILTERED_COUNT_SUFFIX = '; entries matching the export filters';

/** Papa's built-in formula pattern stops at a line break, so a multi-line cell starting with a sigil went out unescaped. */
export const FORMULA_LEADING_CELL = /^[=+\-@\t\r][\s\S]*$/;

const CHANGE_DATE_LENGTH = 'YYYY-MM-DD'.length;
const BLANK_CELL = '';
const NO_FILE_RECORDED_PHRASE = 'no file recorded';
const NO_BATCH_RECORDED_PHRASE = 'no batch recorded';
const NO_VALUE_LABEL = 'none';
/** Keys of the stored file_upload, quadrat-acknowledgment and bulk-revision states that Descriptions read. */
const STATE_KEYS = {
  fileName: 'fileName',
  sourceFormat: 'sourceFormat',
  formType: 'formType',
  uploadMode: 'uploadMode',
  rowCount: 'rowCount',
  droppedCount: 'droppedCount',
  batchCount: 'batchCount',
  chunksByIdentity: 'chunksByIdentity',
  insertedCount: 'insertedCount',
  updatedCount: 'updatedCount',
  skippedCount: 'skippedCount',
  deletedDuplicateCount: 'deletedDuplicateCount',
  failedRowCount: 'failedRowCount',
  summaries: 'summaries',
  summaryKind: 'summaryKind'
} as const;
const MEASUREMENT_SHAPE_KEYS = [STATE_KEYS.sourceFormat, STATE_KEYS.chunksByIdentity, STATE_KEYS.droppedCount, STATE_KEYS.batchCount];

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export type ChangeOperationName = 'INSERT' | 'UPDATE' | 'DELETE';
export type ExportAction = 'I' | 'U' | 'D';
export type ExportCell = string | number | boolean;

const ACTION_BY_OPERATION: Record<ChangeOperationName, ExportAction> = { INSERT: 'I', UPDATE: 'U', DELETE: 'D' };
const RECORD_VERB_BY_OPERATION: Record<ChangeOperationName, string> = { INSERT: 'Added', UPDATE: 'Updated', DELETE: 'Deleted' };

/** Columns whose IDs the Description translates to a current code or name. Extend only when a researcher asks. */
export const FOREIGN_KEY_LABELS = {
  SpeciesID: { table: 'species', labelColumn: 'SpeciesCode' },
  QuadratID: { table: 'quadrats', labelColumn: 'QuadratName' }
} as const;

export type ForeignKeyColumn = keyof typeof FOREIGN_KEY_LABELS;
export type ForeignKeyLabelMap = Record<ForeignKeyColumn, ReadonlyMap<number, string>>;
export type ForeignKeyReferences = Record<ForeignKeyColumn, number[]>;

export const FOREIGN_KEY_COLUMNS = Object.keys(FOREIGN_KEY_LABELS) as ForeignKeyColumn[];

function isForeignKeyColumn(column: string): column is ForeignKeyColumn {
  // Object.hasOwn, not `in`: a changed field can be named `constructor` or `toString`.
  return Object.hasOwn(FOREIGN_KEY_LABELS, column);
}

/** One unifiedchangelog row as the export reads it; `changeTime` is already `YYYY-MM-DD HH:MM:SS` text. */
export interface ExportSourceChange {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: ChangeOperationName;
  oldRowState: unknown;
  newRowState: unknown;
  changeTime: string | null;
  changedBy: string | null;
  plotID: number | null;
  censusID: number | null;
}

/** One group of upload-pipeline coremeasurements rows; `logID` and `changeTime` come from its lowest ChangeID. */
export interface UploadRollupGroup {
  logID: number;
  changeTime: string | null;
  changedTable: string;
  operation: ChangeOperationName;
  changedBy: string | null;
  plotID: number;
  censusID: number | null;
  fileID: string | null;
  baseBatchID: string | null;
  memberCount: number;
}

interface RecordIdentity {
  table: string;
  primaryKey: string;
  editOperationID: string | null;
}

export type ChangeDescriptor =
  | ({ kind: 'field-update'; column: string; oldValue: unknown; newValue: unknown } & RecordIdentity)
  | ({ kind: 'record-added' | 'record-deleted' | 'prior-state-missing' | 'new-state-missing' } & RecordIdentity)
  | ({ kind: 'no-field-values'; operation: ChangeOperationName } & RecordIdentity)
  | { kind: 'images-unavailable'; operation: ChangeOperationName; table: string; recordID: string }
  | { kind: 'bulk-revision'; summary: ChangelogRowImage; editOperationID: string | null }
  | { kind: 'file-upload'; recordID: string; state: ChangelogRowImage | null }
  | { kind: 'quadrat-overlap-acknowledgment'; recordID: string; state: ChangelogRowImage | null }
  | { kind: 'upload-rollup'; operation: ChangeOperationName; fileID: string | null; baseBatchID: string | null; memberCount: number };

export interface DescribeChangeContext {
  labels: ForeignKeyLabelMap;
  /** True when a quick search or a date bound narrows the export, so a rollup count may be part of an upload. */
  countsAreFiltered: boolean;
}

/** A CSV row before its Description is written; the Description needs labels that are looked up after expansion. */
export interface ChangeExportDraft {
  logID: number;
  changedBy: string | null;
  changedTable: string;
  primaryKey: string;
  changedColumn: string;
  changeTime: string | null;
  action: ExportAction;
  oldValue: unknown;
  newValue: unknown;
  plotID: number | null;
  censusID: number | null;
  descriptor: ChangeDescriptor;
}

type DraftScope = Pick<ChangeExportDraft, 'logID' | 'changedBy' | 'changedTable' | 'changeTime' | 'action' | 'plotID' | 'censusID'>;

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && POSITIVE_INTEGER_PATTERN.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function presentCount(state: ChangelogRowImage | null, field: string): number | null {
  const value = state?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function presentText(state: ChangelogRowImage | null, field: string): string | null {
  const value = state?.[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

function countPhrases(state: ChangelogRowImage | null, phrases: ReadonlyArray<readonly [field: string, phrase: (count: number) => string]>): string[] {
  return phrases.flatMap(([field, phrase]) => {
    const count = presentCount(state, field);
    return count === null ? [] : [phrase(count)];
  });
}

function editOperationSuffix(editOperationID: string | null): string {
  return editOperationID === null ? '' : ` (edit #${editOperationID})`;
}

function foreignKeyLabel(column: ForeignKeyColumn, value: unknown, labels: ForeignKeyLabelMap): string {
  if (value === null || value === undefined) return NO_VALUE_LABEL;
  const id = toPositiveInteger(value);
  if (id === null) return String(value);
  return labels[column].get(id) ?? String(id);
}

function describeFileUpload(recordID: string, state: ChangelogRowImage | null): string {
  const fileName = presentText(state, STATE_KEYS.fileName) ?? recordID;
  const isMeasurementShape = state !== null && MEASUREMENT_SHAPE_KEYS.some(field => field in state);

  if (isMeasurementShape) {
    const sourceFormat = presentText(state, STATE_KEYS.sourceFormat);
    const kind = ['measurements', ...(sourceFormat === null ? [] : [sourceFormat])].join(', ');
    const counts = countPhrases(state, [
      [STATE_KEYS.rowCount, count => `${count} rows staged`],
      [STATE_KEYS.droppedCount, count => `${count} dropped`],
      [STATE_KEYS.batchCount, count => `in ${count} chunk(s)`]
    ]);
    return `Uploaded ${fileName} (${kind})${counts.length > 0 ? `: ${counts.join(', ')}` : ''}`;
  }

  const kindParts = [presentText(state, STATE_KEYS.formType), presentText(state, STATE_KEYS.uploadMode)].filter((part): part is string => part !== null);
  const kind = kindParts.length > 0 ? ` (${kindParts.join(', ')})` : '';
  const rowCount = presentCount(state, STATE_KEYS.rowCount);
  const outcomes = countPhrases(state, [
    [STATE_KEYS.insertedCount, count => `${count} inserted`],
    [STATE_KEYS.updatedCount, count => `${count} updated`],
    [STATE_KEYS.skippedCount, count => `${count} skipped`]
  ]);
  const totals = [...(rowCount === null ? [] : [`${rowCount} rows`]), ...(outcomes.length > 0 ? [outcomes.join(', ')] : [])];
  return `Uploaded ${fileName}${kind}${totals.length > 0 ? `: ${totals.join('; ')}` : ''}`;
}

function describeBulkRevision(summary: ChangelogRowImage, editOperationID: string | null): string {
  const counts = countPhrases(summary, [
    [STATE_KEYS.updatedCount, count => `${count} updated`],
    [STATE_KEYS.skippedCount, count => `${count} skipped`],
    [STATE_KEYS.insertedCount, count => `${count} inserted`],
    [STATE_KEYS.deletedDuplicateCount, count => `${count} duplicate(s) removed`],
    [STATE_KEYS.failedRowCount, count => `${count} failed`]
  ]);
  return `Applied a bulk revision${counts.length > 0 ? `: ${counts.join(', ')}` : ''}${editOperationSuffix(editOperationID)}`;
}

function describeUploadRollup(change: Extract<ChangeDescriptor, { kind: 'upload-rollup' }>, countsAreFiltered: boolean): string {
  const file = change.fileID ?? NO_FILE_RECORDED_PHRASE;
  const batch = change.baseBatchID ?? NO_BATCH_RECORDED_PHRASE;
  const suffix = countsAreFiltered ? FILTERED_COUNT_SUFFIX : '';
  if (change.operation === 'DELETE') {
    const originalBatch = change.baseBatchID === null ? batch : `original batch ${batch}`;
    return `Upload pipeline removed ${change.memberCount} measurements originally loaded from ${file} (${originalBatch})${suffix}`;
  }
  const verb = change.operation === 'INSERT' ? 'added' : 'updated';
  const batchPhrase = change.baseBatchID === null ? batch : `batch ${batch}`;
  return `Upload ${file}: ${verb} ${change.memberCount} measurement rows (${batchPhrase})${suffix}`;
}

/**
 * The only source of Description text. A stored reason, if one is ever captured, is read here
 * first and this generated text becomes the fallback.
 */
export function describeChange(change: ChangeDescriptor, context: DescribeChangeContext): string {
  switch (change.kind) {
    case 'field-update': {
      const labels = isForeignKeyColumn(change.column)
        ? ` (${foreignKeyLabel(change.column, change.oldValue, context.labels)} → ${foreignKeyLabel(change.column, change.newValue, context.labels)})`
        : '';
      return `Changed ${change.column} on ${change.table} ${change.primaryKey}${labels}${editOperationSuffix(change.editOperationID)}`;
    }
    case 'record-added':
      return `Added ${change.table} ${change.primaryKey}${editOperationSuffix(change.editOperationID)}`;
    case 'record-deleted':
      return `Deleted ${change.table} ${change.primaryKey}${editOperationSuffix(change.editOperationID)}`;
    case 'prior-state-missing':
      return `Updated ${change.table} ${change.primaryKey}; prior values were not recorded${editOperationSuffix(change.editOperationID)}`;
    case 'new-state-missing':
      return `Updated ${change.table} ${change.primaryKey}; new values were not recorded (legacy log entry)`;
    case 'no-field-values':
      return `${RECORD_VERB_BY_OPERATION[change.operation]} ${change.table} ${change.primaryKey}; no field values were recorded${editOperationSuffix(change.editOperationID)}`;
    case 'images-unavailable':
      return `${change.operation} on ${change.table} ${change.recordID} was recorded; row images are unavailable`;
    case 'bulk-revision':
      return describeBulkRevision(change.summary, change.editOperationID);
    case 'file-upload':
      return describeFileUpload(change.recordID, change.state);
    case 'quadrat-overlap-acknowledgment': {
      const fileName = presentText(change.state, STATE_KEYS.fileName) ?? change.recordID;
      const summaries = change.state?.[STATE_KEYS.summaries];
      const layouts = Array.isArray(summaries) ? ` (${summaries.length} layout(s))` : '';
      return `Acknowledged overlapping quadrats in upload ${fileName}${layouts}`;
    }
    case 'upload-rollup':
      return describeUploadRollup(change, context.countsAreFiltered);
  }
}

function summaryDraft(scope: DraftScope, primaryKey: string, descriptor: ChangeDescriptor): ChangeExportDraft {
  return { ...scope, primaryKey, changedColumn: SUMMARY_COLUMN_MARKER, oldValue: null, newValue: null, descriptor };
}

function expandRecord(operation: ChangeOperationName, scope: DraftScope, record: ChangelogRecord, editOperationID: string | null): ChangeExportDraft[] {
  const identity: RecordIdentity = { table: scope.changedTable, primaryKey: record.primaryKey, editOperationID };

  if (operation === 'UPDATE' && record.oldState !== null && record.newState !== null) {
    return computeDiff(record.oldState, record.newState).map(diff => ({
      ...scope,
      primaryKey: record.primaryKey,
      changedColumn: diff.field,
      oldValue: diff.oldValue,
      newValue: diff.newValue,
      descriptor: { kind: 'field-update', column: diff.field, oldValue: diff.oldValue, newValue: diff.newValue, ...identity }
    }));
  }

  const valuesAreNew = operation === 'INSERT' || (operation === 'UPDATE' && record.oldState === null);
  const image = valuesAreNew ? record.newState : record.oldState;
  const fields = image === null ? [] : recordedFieldNames(image);
  if (image === null || fields.length === 0) {
    return [summaryDraft(scope, record.primaryKey, { kind: 'no-field-values', operation, ...identity })];
  }

  const descriptor: ChangeDescriptor =
    operation === 'INSERT'
      ? { kind: 'record-added', ...identity }
      : operation === 'DELETE'
        ? { kind: 'record-deleted', ...identity }
        : { kind: valuesAreNew ? 'prior-state-missing' : 'new-state-missing', ...identity };

  return fields.map(field => ({
    ...scope,
    primaryKey: record.primaryKey,
    changedColumn: field,
    oldValue: valuesAreNew ? null : image[field],
    newValue: valuesAreNew ? image[field] : null,
    descriptor
  }));
}

/**
 * Turns one source change into its CSV rows (spec §6.2, first matching rule wins). An empty
 * result means the change is suppressed: every record was a paired update with no visible difference.
 */
export function expandChange(change: ExportSourceChange): ChangeExportDraft[] {
  const { records, undecodable } = decodeChangelogRow(change);
  const { editOperationID } = splitEditOperationRecordID(change.recordID);
  const soleNewState = records.length === 1 ? records[0].newState : null;
  const scope: DraftScope = {
    logID: change.changeID,
    changedBy: change.changedBy,
    changedTable: change.tableName,
    changeTime: change.changeTime,
    action: ACTION_BY_OPERATION[change.operation],
    plotID: change.plotID,
    censusID: change.censusID
  };

  if (soleNewState !== null && soleNewState[STATE_KEYS.summaryKind] === BULK_REVISION_SUMMARY_KIND) {
    return [summaryDraft(scope, records[0].primaryKey, { kind: 'bulk-revision', summary: soleNewState, editOperationID })];
  }
  if (change.tableName === FILE_UPLOAD_CHANGELOG_TABLE) {
    return [summaryDraft(scope, change.recordID, { kind: 'file-upload', recordID: change.recordID, state: soleNewState })];
  }
  if (change.tableName === QUADRAT_OVERLAP_ACKNOWLEDGMENT_CHANGELOG_TABLE) {
    return [summaryDraft(scope, change.recordID, { kind: 'quadrat-overlap-acknowledgment', recordID: change.recordID, state: soleNewState })];
  }
  if (undecodable || records.length === 0) {
    return [
      summaryDraft(scope, change.recordID, { kind: 'images-unavailable', operation: change.operation, table: change.tableName, recordID: change.recordID })
    ];
  }
  return records.flatMap(record => expandRecord(change.operation, scope, record, editOperationID));
}

export function buildUploadRollupDraft(group: UploadRollupGroup): ChangeExportDraft {
  return {
    logID: group.logID,
    changedBy: group.changedBy,
    changedTable: group.changedTable,
    primaryKey: group.fileID ?? NO_FILE_RECORDED_KEY,
    changedColumn: SUMMARY_COLUMN_MARKER,
    changeTime: group.changeTime,
    action: ACTION_BY_OPERATION[group.operation],
    oldValue: null,
    newValue: null,
    plotID: group.plotID,
    censusID: group.censusID,
    descriptor: {
      kind: 'upload-rollup',
      operation: group.operation,
      fileID: group.fileID,
      baseBatchID: group.baseBatchID,
      memberCount: group.memberCount
    }
  };
}

/** The distinct positive-integer IDs the field-update rows reference, per labelled column. */
export function collectForeignKeyReferences(drafts: readonly ChangeExportDraft[]): ForeignKeyReferences {
  const references: Record<ForeignKeyColumn, Set<number>> = { SpeciesID: new Set(), QuadratID: new Set() };
  for (const { descriptor } of drafts) {
    if (descriptor.kind !== 'field-update' || !isForeignKeyColumn(descriptor.column)) continue;
    for (const value of [descriptor.oldValue, descriptor.newValue]) {
      const id = toPositiveInteger(value);
      if (id !== null) references[descriptor.column].add(id);
    }
  }
  return { SpeciesID: [...references.SpeciesID], QuadratID: [...references.QuadratID] };
}

/** Oldest first, a blank time before any time, ties by LogID. Array.prototype.sort is stable, so one change's rows keep their order. */
export function compareExportDrafts(a: ChangeExportDraft, b: ChangeExportDraft): number {
  if (a.changeTime !== b.changeTime) {
    if (a.changeTime === null) return -1;
    if (b.changeTime === null) return 1;
    return a.changeTime < b.changeTime ? -1 : 1;
  }
  return a.logID - b.logID;
}

export function formatExportCell(value: unknown): ExportCell {
  if (value === null || value === undefined) return BLANK_CELL;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The thirteen cells of one row, in EXPORT_COLUMNS order. */
export function toExportCells(draft: ChangeExportDraft, context: DescribeChangeContext): ExportCell[] {
  return [
    draft.logID,
    formatExportCell(draft.changedBy),
    draft.changedTable,
    draft.primaryKey,
    draft.changedColumn,
    draft.changeTime === null ? BLANK_CELL : draft.changeTime.slice(0, CHANGE_DATE_LENGTH),
    formatExportCell(draft.changeTime),
    describeChange(draft.descriptor, context),
    draft.action,
    formatExportCell(draft.oldValue),
    formatExportCell(draft.newValue),
    formatExportCell(draft.plotID),
    formatExportCell(draft.censusID)
  ];
}

/** Arrays, not `{ fields, data }`: an empty export must be the header alone with no trailing newline. */
export function serializeChangeExportCsv(rows: readonly ExportCell[][]): string {
  return Papa.unparse([[...EXPORT_COLUMNS], ...rows], { escapeFormulae: FORMULA_LEADING_CELL });
}
