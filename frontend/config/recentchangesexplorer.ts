import { FILE_UPLOAD_CHANGELOG_TABLE, type ChangelogRecord } from '@/config/changelogdecode';

export const CHANGE_OPERATIONS = ['all', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export interface RecentChangesFilters {
  operation: ChangeOperation;
  changedBy: string;
  tableName: string;
  quickSearch: string;
  /** Calendar day `YYYY-MM-DD` of the stored ChangeTimestamp; blank means no bound. */
  changedFrom: string;
  changedTo: string;
  presetId?: string;
}

/** What the server filters on; presetId only drives chip highlighting on the client. */
export type RecentChangesServerFilters = Omit<RecentChangesFilters, 'presetId'>;

/** A preset says nothing about dates, so a preset click keeps the date range (#592 D9). */
export type RecentChangesPresetFilters = Pick<RecentChangesFilters, 'operation' | 'changedBy' | 'tableName' | 'quickSearch'>;

export function isDateRangeInverted(changedFrom: string, changedTo: string): boolean {
  return changedFrom !== '' && changedTo !== '' && changedFrom > changedTo;
}

export interface ChangelogEntry {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Populated only when the change holds exactly one record; `records` is the full picture. */
  oldRowState: Record<string, unknown> | null;
  newRowState: Record<string, unknown> | null;
  records: ChangelogRecord[];
  changeTimestamp: string;
  changedBy: string | null;
}

export interface BatchInsertGroup {
  type: 'batch';
  tableName: string;
  changedBy: string | null;
  timestamp: string;
  count: number;
  entries: ChangelogEntry[];
}

export type FeedItem = { type: 'single'; entry: ChangelogEntry } | BatchInsertGroup;

export interface RecentChangesQueryResponse {
  items: FeedItem[];
  totalItems: number;
  summary: RecentChangesSummary;
  hasMore: boolean;
}

export interface RecentChangesSummary {
  total: number;
  updates: number;
  inserts: number;
  deletes: number;
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface RecentChangesFacetsResponse {
  users: FacetOption[];
  tables: FacetOption[];
  operationCounts: {
    INSERT: number;
    UPDATE: number;
    DELETE: number;
  };
}

export const DEFAULT_RECENT_CHANGES_FILTERS: RecentChangesFilters = {
  operation: 'all',
  changedBy: '',
  tableName: '',
  quickSearch: '',
  changedFrom: '',
  changedTo: '',
  presetId: 'all_changes'
};

export const RECENT_CHANGES_PRESETS = [
  {
    id: 'all_changes',
    label: 'All Changes',
    filters: { operation: 'all', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesPresetFilters
  },
  {
    id: 'measurement_updates',
    label: 'Measurement Updates',
    filters: { operation: 'UPDATE', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesPresetFilters
  },
  {
    id: 'deletions',
    label: 'Deletions',
    filters: { operation: 'DELETE', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesPresetFilters
  },
  {
    id: 'uploads',
    label: 'Uploads',
    filters: { operation: 'INSERT', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesPresetFilters
  }
] as const;

const BATCH_WINDOW_MS = 60_000;

// file_upload rows are already per-file aggregates; batching them would hide which file is which behind a row count.
const TABLES_EXCLUDED_FROM_BATCHING = new Set([FILE_UPLOAD_CHANGELOG_TABLE]);

export function groupIntoBatches(entries: ChangelogEntry[]): FeedItem[] {
  if (entries.length === 0) return [];

  const items: FeedItem[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];

    if (current.operation !== 'INSERT' || TABLES_EXCLUDED_FROM_BATCHING.has(current.tableName)) {
      items.push({ type: 'single', entry: current });
      i++;
      continue;
    }

    const batchEntries: ChangelogEntry[] = [current];
    let j = i + 1;

    while (j < entries.length) {
      const next = entries[j];
      const prev = batchEntries[batchEntries.length - 1];

      if (next.operation !== 'INSERT' || next.tableName !== current.tableName || next.changedBy !== current.changedBy) {
        break;
      }

      const timeDiff = Math.abs(new Date(next.changeTimestamp).getTime() - new Date(prev.changeTimestamp).getTime());
      if (timeDiff > BATCH_WINDOW_MS) {
        break;
      }

      batchEntries.push(next);
      j++;
    }

    if (batchEntries.length === 1) {
      items.push({ type: 'single', entry: current });
    } else {
      items.push({
        type: 'batch',
        tableName: current.tableName,
        changedBy: current.changedBy,
        timestamp: current.changeTimestamp,
        count: batchEntries.length,
        entries: batchEntries
      });
    }

    i = j;
  }

  return items;
}

export const KEY_FIELDS_BY_TABLE: Record<string, string[]> = {
  // coremeasurements only has the ingestion pipeline's Raw* columns, not resolved-entity columns like TreeTag/SpeciesCode.
  coremeasurements: ['RawTreeTag', 'RawStemTag', 'RawSpCode', 'RawQuadrat', 'MeasuredDBH'],
  species: ['SpeciesCode', 'Family', 'Genus'],
  stems: ['StemTag', 'TreeID', 'QuadratID', 'LocalX', 'LocalY'],
  trees: ['TreeTag', 'SpeciesID', 'SubSpeciesID'],
  quadrats: ['QuadratName', 'DimensionX', 'DimensionY', 'Area']
};

const MAX_FALLBACK_FIELDS = 5;
const ID_FIELD_SUFFIXES = ['ID', 'Id', 'id'];

export function getKeyFields(tableName: string, rowState: Record<string, unknown>): string[] {
  const known = KEY_FIELDS_BY_TABLE[tableName];
  if (known) {
    return known.filter(field => field in rowState);
  }
  return Object.keys(rowState)
    .filter(key => !ID_FIELD_SUFFIXES.some(suffix => key.endsWith(suffix)))
    .slice(0, MAX_FALLBACK_FIELDS);
}
