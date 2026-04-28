import type { MeasurementsSummaryRDS } from '@/config/sqlrdsdefinitions/views';

export type ErrorExplorerSource = 'all' | 'validation' | 'ingestion';
export type ContradictionType = 'duplicate_tag_stem' | 'same_batch_conflict';

export const CONTRADICTION_LABELS: Record<ContradictionType, string> = {
  duplicate_tag_stem: 'Duplicate tag/stem',
  same_batch_conflict: 'Same-batch conflict'
};

export const CONTRADICTION_REASONS: Record<ContradictionType, string> = {
  duplicate_tag_stem: 'These rows share the same tree and stem tags within the active census and should be reviewed together.',
  same_batch_conflict: 'These rows came from the same upload batch, share a tree tag, and disagree on species.'
};

export interface ErrorFacetOption {
  value: string;
  count: number;
}

export interface ErrorExplorerFilters {
  source: ErrorExplorerSource;
  exactMessages: string[];
  affectedFields: string[];
  contradictionOnly: boolean;
  contradictionTypes: ContradictionType[];
  quickSearch: string;
  presetId?: string;
}

export interface ErrorExplorerQueryRequest {
  schema: string;
  plotID: number;
  censusID: number;
  page: number;
  pageSize: number;
  filters: ErrorExplorerFilters;
}

export interface ErrorDetailRecord {
  source: Exclude<ErrorExplorerSource, 'all'>;
  code: string;
  message: string;
  fields: string[];
  procedureName?: string | null;
}

export interface ErrorExplorerRow extends MeasurementsSummaryRDS {
  id: number;
  primaryErrorMessage: string;
  errorMessages: string[];
  errorSources: Array<Exclude<ErrorExplorerSource, 'all'>>;
  errorFields: string[];
  errorCodes: string[];
  errorCount: number;
  hasContradiction: boolean;
  contradictionTypes: ContradictionType[];
  contradictionType: ContradictionType | null;
  contradictionGroupKey: string | null;
  relatedMeasurementIDs: number[];
  uploadFileID?: string | null;
  uploadBatchID?: string | null;
  // Authoritative failure flag derived from coremeasurements.StemGUID — must be
  // computed server-side because measurementssummary.StemGUID can drift stale.
  isFailedRow: boolean;
}

export interface ErrorExplorerSummary {
  total: number;
  validation: number;
  ingestion: number;
  contradictions: number;
  duplicateTagStem: number;
  sameBatchConflict: number;
}

export interface ErrorExplorerQueryResponse {
  rows: ErrorExplorerRow[];
  totalRows: number;
  summary: ErrorExplorerSummary;
}

export interface ErrorExplorerFacetsResponse {
  messages: ErrorFacetOption[];
  fields: ErrorFacetOption[];
  sourceCounts: {
    validation: number;
    ingestion: number;
  };
  contradictionCounts: {
    duplicateTagStem: number;
    sameBatchConflict: number;
  };
}

export interface RelatedContradictionRow {
  coreMeasurementID: number;
  treeTag?: string;
  stemTag?: string;
  speciesCode?: string;
  quadratName?: string;
  measurementDate?: string | null;
  measuredDBH?: number | null;
  measuredHOM?: number | null;
  stemLocalX?: number | null;
  stemLocalY?: number | null;
  description?: string | null;
  uploadFileID?: string | null;
  uploadBatchID?: string | null;
  primaryErrorMessage?: string;
  errorCount?: number;
  errorMessages?: string[];
}

export interface ErrorExplorerDetailsResponse {
  row: ErrorExplorerRow | null;
  allErrors: ErrorDetailRecord[];
  relatedRows: RelatedContradictionRow[];
}

export const DEFAULT_ERROR_EXPLORER_FILTERS: ErrorExplorerFilters = {
  source: 'all',
  exactMessages: [],
  affectedFields: [],
  contradictionOnly: false,
  contradictionTypes: [],
  quickSearch: '',
  presetId: 'all_errors'
};

export const ERROR_EXPLORER_PRESETS = [
  {
    id: 'all_errors',
    label: 'All Errors',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'validation_only',
    label: 'Validation Only',
    filters: {
      source: 'validation',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'ingestion_only',
    label: 'Ingestion Only',
    filters: {
      source: 'ingestion',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'contradictions',
    label: 'Contradictions',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'duplicate_tag_stem',
    label: 'Duplicate Tag/Stem',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: ['duplicate_tag_stem'],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'same_batch_conflict',
    label: 'Same-Batch Conflicts',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: ['same_batch_conflict'],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  }
] as const;

export const INGESTION_ERROR_FIELD_MAP: Record<string, string[]> = {
  MISSING_FIELD_TREETAG: ['treeTag'],
  MISSING_FIELD_STEMTAG: ['stemTag'],
  MISSING_FIELD_SPECIESCODE: ['speciesCode'],
  MISSING_FIELD_QUADRATNAME: ['quadratName'],
  MISSING_FIELD_DATE: ['measurementDate'],
  INVALID_QUADRAT: ['quadratName'],
  INVALID_SPECIES: ['speciesCode'],
  QUADRAT_MISMATCH: ['quadratName'],
  COORDINATE_DRIFT: ['stemLocalX', 'stemLocalY'],
  DUPLICATE_ENTRY: ['treeTag', 'stemTag'],
  DUPLICATE_TAG_CONFLICT: ['treeTag', 'stemTag'],
  DUPLICATE_TAG_CONFLICT_EXISTING: ['treeTag', 'stemTag'],
  NEGATIVE_DBH: ['measuredDBH'],
  NEGATIVE_HOM: ['measuredHOM'],
  MISSING_FIELD_COORDINATES: ['stemLocalX', 'stemLocalY'],
  INVALID_COORDINATE: ['stemLocalX', 'stemLocalY'],
  FIELD_TOO_LONG: [],
  MISSING_MEASUREMENT_DATA: ['measuredDBH', 'measuredHOM'],
  SQL_EXCEPTION: [],
  SAME_BATCH_SPECIES_CONFLICT: ['treeTag', 'speciesCode']
};

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)));
}

export function dedupeNumbers(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))));
}
