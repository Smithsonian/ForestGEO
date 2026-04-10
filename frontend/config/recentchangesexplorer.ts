export type ChangeOperation = 'all' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface RecentChangesFilters {
  operation: ChangeOperation;
  changedBy: string;
  tableName: string;
  quickSearch: string;
  presetId?: string;
}

export interface RecentChangesQueryRequest {
  schema: string;
  plotID: number;
  page: number;
  pageSize: number;
  filters: RecentChangesFilters;
}

export interface ChangelogEntry {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRowState: Record<string, unknown> | null;
  newRowState: Record<string, unknown> | null;
  changeTimestamp: string;
  changedBy: string;
}

export interface BatchInsertGroup {
  type: 'batch';
  tableName: string;
  changedBy: string;
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
  presetId: 'all_changes'
};

export const RECENT_CHANGES_PRESETS = [
  {
    id: 'all_changes',
    label: 'All Changes',
    filters: { operation: 'all', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesFilters
  },
  {
    id: 'measurement_updates',
    label: 'Measurement Updates',
    filters: { operation: 'UPDATE', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesFilters
  },
  {
    id: 'deletions',
    label: 'Deletions',
    filters: { operation: 'DELETE', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesFilters
  },
  {
    id: 'uploads',
    label: 'Uploads',
    filters: { operation: 'INSERT', changedBy: '', tableName: '', quickSearch: '' } satisfies RecentChangesFilters
  }
] as const;

const BATCH_WINDOW_MS = 60_000;

export function groupIntoBatches(entries: ChangelogEntry[]): FeedItem[] {
  if (entries.length === 0) return [];

  const items: FeedItem[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];

    if (current.operation !== 'INSERT') {
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
  coremeasurements: ['TreeTag', 'StemTag', 'SpeciesCode', 'QuadratName', 'MeasuredDBH'],
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
