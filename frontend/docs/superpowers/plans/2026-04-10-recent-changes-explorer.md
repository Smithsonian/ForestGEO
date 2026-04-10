# Recent Changes Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat data grid Recent Changes page with a card-based activity feed featuring preset filters, color-coded diffs, batch-grouped inserts, and "load more" pagination.

**Architecture:** New standalone explorer component (`RecentChangesExplorer`) mirroring the `ErrorsExplorer` pattern. Dedicated API endpoints for filtered queries and facets. Pure utility functions for diff computation and batch grouping, unit-tested independently. Page route swaps the old component for the new one.

**Tech Stack:** Next.js 15 (App Router), React 19, MUI Joy UI, TypeScript, mysql2/promise, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-recent-changes-explorer-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `config/recentchangesexplorer.ts` | Types, filter interface, presets, defaults, batch grouping logic |
| `config/changelogdiff.ts` | Pure diff utility for comparing old/new row state |
| `app/api/changes/explorer/_shared.ts` | SQL query builders and shared query logic |
| `app/api/changes/explorer/query/route.ts` | POST endpoint — paginated, filtered changelog query |
| `app/api/changes/explorer/facets/route.ts` | POST endpoint — distinct users, tables, operation counts |
| `components/changes/recentchangesexplorer.tsx` | Main UI component: filters, cards, feed, pagination |
| `app/(hub)/measurementshub/recentchanges/page.tsx` | Page route — swap to new component |

Test files:

| File | What it tests |
|------|--------------|
| `config/changelogdiff.test.ts` | `computeDiff` with various old/new state combinations |
| `config/recentchangesexplorer.test.ts` | `groupIntoBatches` with various INSERT sequences |

---

### Task 1: Config Types, Presets, and Batch Grouping

**Goal:** Create the types module with filter state, presets, request/response interfaces, and the batch grouping pure function.

**Files:**
- Create: `config/recentchangesexplorer.ts`
- Create: `config/recentchangesexplorer.test.ts`

**Acceptance Criteria:**
- [ ] All TypeScript interfaces from the spec are exported
- [ ] Four presets defined with correct operation mappings
- [ ] `groupIntoBatches` groups consecutive INSERTs by tableName + changedBy within 60s
- [ ] `groupIntoBatches` leaves UPDATE and DELETE entries as single items
- [ ] `groupIntoBatches` does not group INSERTs across different tables or users
- [ ] Unit tests cover all grouping edge cases

**Verify:** `npx vitest run config/recentchangesexplorer.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Write the test file for `groupIntoBatches`**

Create `config/recentchangesexplorer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { groupIntoBatches, ChangelogEntry, FeedItem, RECENT_CHANGES_PRESETS, DEFAULT_RECENT_CHANGES_FILTERS } from './recentchangesexplorer';

const BATCH_WINDOW_MS = 60_000;

function makeEntry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    changeID: 1,
    tableName: 'coremeasurements',
    recordID: '100',
    operation: 'INSERT',
    oldRowState: null,
    newRowState: { TreeTag: '1042', StemTag: '1' },
    changeTimestamp: '2026-04-09T14:30:00.000Z',
    changedBy: 'mason@si.edu',
    ...overrides
  };
}

describe('groupIntoBatches', () => {
  it('returns empty array for empty input', () => {
    expect(groupIntoBatches([])).toEqual([]);
  });

  it('wraps a single UPDATE as a single item', () => {
    const entry = makeEntry({ operation: 'UPDATE', oldRowState: { MeasuredDBH: 12 }, newRowState: { MeasuredDBH: 14 } });
    const result = groupIntoBatches([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
    expect((result[0] as Extract<FeedItem, { type: 'single' }>).entry).toEqual(entry);
  });

  it('wraps a single DELETE as a single item', () => {
    const entry = makeEntry({ operation: 'DELETE', oldRowState: { StemTag: '3' }, newRowState: null });
    const result = groupIntoBatches([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
  });

  it('groups consecutive INSERTs with same table + user within 60s', () => {
    const entries = [
      makeEntry({ changeID: 1, changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, changeTimestamp: '2026-04-09T14:30:10.000Z', recordID: '101' }),
      makeEntry({ changeID: 3, changeTimestamp: '2026-04-09T14:30:20.000Z', recordID: '102' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('batch');
    const batch = result[0] as Extract<FeedItem, { type: 'batch' }>;
    expect(batch.count).toBe(3);
    expect(batch.tableName).toBe('coremeasurements');
    expect(batch.changedBy).toBe('mason@si.edu');
    expect(batch.entries).toHaveLength(3);
  });

  it('splits INSERTs into separate batches when time gap exceeds 60s', () => {
    const entries = [
      makeEntry({ changeID: 1, changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, changeTimestamp: '2026-04-09T14:32:00.000Z', recordID: '101' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
    expect(result.every(item => item.type === 'single')).toBe(true);
  });

  it('does not group INSERTs from different tables', () => {
    const entries = [
      makeEntry({ changeID: 1, tableName: 'coremeasurements' }),
      makeEntry({ changeID: 2, tableName: 'species', recordID: '200', changeTimestamp: '2026-04-09T14:30:05.000Z' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
    expect(result.every(item => item.type === 'single')).toBe(true);
  });

  it('does not group INSERTs from different users', () => {
    const entries = [
      makeEntry({ changeID: 1, changedBy: 'mason@si.edu' }),
      makeEntry({ changeID: 2, changedBy: 'jdoe@si.edu', recordID: '101', changeTimestamp: '2026-04-09T14:30:05.000Z' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(2);
  });

  it('handles mixed operations: groups INSERTs but keeps UPDATE/DELETE separate', () => {
    const entries = [
      makeEntry({ changeID: 1, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:00.000Z' }),
      makeEntry({ changeID: 2, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:05.000Z', recordID: '101' }),
      makeEntry({ changeID: 3, operation: 'UPDATE', changeTimestamp: '2026-04-09T14:30:10.000Z', recordID: '102', oldRowState: { MeasuredDBH: 10 }, newRowState: { MeasuredDBH: 12 } }),
      makeEntry({ changeID: 4, operation: 'INSERT', changeTimestamp: '2026-04-09T14:30:15.000Z', recordID: '103' })
    ];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('batch');
    expect((result[0] as Extract<FeedItem, { type: 'batch' }>).count).toBe(2);
    expect(result[1].type).toBe('single');
    expect((result[1] as Extract<FeedItem, { type: 'single' }>).entry.operation).toBe('UPDATE');
    expect(result[2].type).toBe('single');
  });

  it('treats a single INSERT as a single item, not a batch of 1', () => {
    const entries = [makeEntry({ changeID: 1 })];
    const result = groupIntoBatches(entries);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
  });
});

describe('RECENT_CHANGES_PRESETS', () => {
  it('has four presets with correct IDs', () => {
    const ids = RECENT_CHANGES_PRESETS.map(p => p.id);
    expect(ids).toEqual(['all_changes', 'measurement_updates', 'deletions', 'uploads']);
  });

  it('all_changes preset uses operation all', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'all_changes')!;
    expect(preset.filters.operation).toBe('all');
  });

  it('measurement_updates preset uses operation UPDATE', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'measurement_updates')!;
    expect(preset.filters.operation).toBe('UPDATE');
  });

  it('deletions preset uses operation DELETE', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'deletions')!;
    expect(preset.filters.operation).toBe('DELETE');
  });

  it('uploads preset uses operation INSERT', () => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === 'uploads')!;
    expect(preset.filters.operation).toBe('INSERT');
  });
});

describe('DEFAULT_RECENT_CHANGES_FILTERS', () => {
  it('defaults to all_changes preset', () => {
    expect(DEFAULT_RECENT_CHANGES_FILTERS.presetId).toBe('all_changes');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.operation).toBe('all');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.changedBy).toBe('');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.tableName).toBe('');
    expect(DEFAULT_RECENT_CHANGES_FILTERS.quickSearch).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run config/recentchangesexplorer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the config module**

Create `config/recentchangesexplorer.ts`:

```typescript
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

      if (
        next.operation !== 'INSERT' ||
        next.tableName !== current.tableName ||
        next.changedBy !== current.changedBy
      ) {
        break;
      }

      const timeDiff = Math.abs(
        new Date(next.changeTimestamp).getTime() - new Date(prev.changeTimestamp).getTime()
      );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run config/recentchangesexplorer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add config/recentchangesexplorer.ts config/recentchangesexplorer.test.ts
git commit -m "Add config types, presets, and batch grouping for Recent Changes Explorer"
```

---

### Task 2: Diff Utility

**Goal:** Create the pure diff function that compares old/new row state and returns only changed fields.

**Files:**
- Create: `config/changelogdiff.ts`
- Create: `config/changelogdiff.test.ts`

**Acceptance Criteria:**
- [ ] `computeDiff` returns only fields that differ between old and new state
- [ ] Internal/metadata fields are excluded from diff output
- [ ] Results are sorted by field name
- [ ] Handles null inputs gracefully (INSERT = no old, DELETE = no new)
- [ ] Uses JSON.stringify for deep comparison of nested values
- [ ] Unit tests cover: basic diff, no changes, null states, excluded fields, nested objects

**Verify:** `npx vitest run config/changelogdiff.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Write the test file**

Create `config/changelogdiff.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeDiff, DiffEntry } from './changelogdiff';

describe('computeDiff', () => {
  it('returns empty array when both states are null', () => {
    expect(computeDiff(null, null)).toEqual([]);
  });

  it('returns empty array when both states are identical', () => {
    const state = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, TreeTag: '1042' };
    expect(computeDiff(state, { ...state })).toEqual([]);
  });

  it('returns changed fields only', () => {
    const oldState = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, TreeTag: '1042' };
    const newState = { MeasuredDBH: 14.2, MeasuredHOM: 1.3, TreeTag: '1042' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }
    ]);
  });

  it('returns multiple changed fields sorted alphabetically', () => {
    const oldState = { MeasuredDBH: 12.5, MeasuredHOM: 1.3, SpeciesCode: 'OECOSP' };
    const newState = { MeasuredDBH: 14.2, MeasuredHOM: 1.5, SpeciesCode: 'OECOSP' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 },
      { field: 'MeasuredHOM', oldValue: 1.3, newValue: 1.5 }
    ]);
  });

  it('excludes internal metadata fields', () => {
    const oldState = { id: 1, changeID: 100, plotID: 5, censusID: 2, MeasuredDBH: 12.5 };
    const newState = { id: 2, changeID: 101, plotID: 5, censusID: 3, MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }
    ]);
  });

  it('detects field added in new state', () => {
    const oldState = { TreeTag: '1042' };
    const newState = { TreeTag: '1042', MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: undefined, newValue: 14.2 }
    ]);
  });

  it('detects field removed in new state', () => {
    const oldState = { TreeTag: '1042', MeasuredDBH: 12.5 };
    const newState = { TreeTag: '1042' };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: undefined }
    ]);
  });

  it('uses deep comparison for nested objects', () => {
    const oldState = { UserDefinedFields: { custom1: 'a', custom2: 'b' } };
    const newState = { UserDefinedFields: { custom1: 'a', custom2: 'c' } };
    const result = computeDiff(oldState, newState);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('UserDefinedFields');
  });

  it('treats null and undefined as different from a value', () => {
    const oldState = { MeasuredDBH: null };
    const newState = { MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: null, newValue: 14.2 }
    ]);
  });

  it('excludes timestamp fields like CreatedAt, UpdatedAt', () => {
    const oldState = { CreatedAt: '2026-01-01', UpdatedAt: '2026-01-01', MeasuredDBH: 12.5 };
    const newState = { CreatedAt: '2026-01-01', UpdatedAt: '2026-04-09', MeasuredDBH: 14.2 };
    const result = computeDiff(oldState, newState);

    expect(result).toEqual([
      { field: 'MeasuredDBH', oldValue: 12.5, newValue: 14.2 }
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run config/changelogdiff.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the diff utility**

Create `config/changelogdiff.ts`:

```typescript
export interface DiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

const EXCLUDED_FIELDS = new Set([
  'id',
  'changeID',
  'plotID',
  'censusID',
  'PlotID',
  'CensusID',
  'ChangeID',
  'CreatedAt',
  'UpdatedAt',
  'createdAt',
  'updatedAt'
]);

export function computeDiff(
  oldRowState: Record<string, unknown> | null,
  newRowState: Record<string, unknown> | null
): DiffEntry[] {
  if (!oldRowState && !newRowState) return [];

  const oldObj = oldRowState ?? {};
  const newObj = newRowState ?? {};
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const diffs: DiffEntry[] = [];

  for (const key of allKeys) {
    if (EXCLUDED_FIELDS.has(key)) continue;

    const oldVal = oldObj[key];
    const newVal = newObj[key];

    const oldSerialized = JSON.stringify(oldVal);
    const newSerialized = JSON.stringify(newVal);

    if (oldSerialized !== newSerialized) {
      diffs.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs.sort((a, b) => a.field.localeCompare(b.field));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run config/changelogdiff.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add config/changelogdiff.ts config/changelogdiff.test.ts
git commit -m "Add changelog diff utility for computing field-level changes"
```

---

### Task 3: API Shared Query Logic

**Goal:** Create the shared module with SQL query builders and the query/facets execution functions.

**Files:**
- Create: `app/api/changes/explorer/_shared.ts`

**Acceptance Criteria:**
- [ ] Uses `safeFormatQuery` for all schema interpolation (matching errors explorer pattern)
- [ ] Query filters by plotID (not censusID)
- [ ] Supports operation, changedBy, tableName, and quickSearch filters
- [ ] Returns raw `ChangelogEntry[]` rows for the query endpoint to batch-group
- [ ] Facets query returns distinct users, tables, and operation counts
- [ ] Follows the `ConnectionManager` + `executeQuery` pattern from errors explorer

**Verify:** TypeScript compiles: `npx tsc --noEmit app/api/changes/explorer/_shared.ts` (or verified in Task 5 integration)

**Steps:**

- [ ] **Step 1: Create the shared module**

Create `app/api/changes/explorer/_shared.ts`:

```typescript
import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import {
  ChangelogEntry,
  RecentChangesFilters,
  RecentChangesFacetsResponse,
  RecentChangesSummary,
  FacetOption,
  groupIntoBatches,
  FeedItem,
  RecentChangesQueryResponse
} from '@/config/recentchangesexplorer';

type ExplorerConnection = ReturnType<typeof ConnectionManager.getInstance>;

interface RawChangelogRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: string | Record<string, unknown> | null;
  NewRowState: string | Record<string, unknown> | null;
  ChangeTimestamp: string | Date;
  ChangedBy: string;
}

function parseJsonField(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toChangelogEntry(row: RawChangelogRow): ChangelogEntry {
  return {
    changeID: row.ChangeID,
    tableName: row.TableName,
    recordID: row.RecordID,
    operation: row.Operation,
    oldRowState: parseJsonField(row.OldRowState),
    newRowState: parseJsonField(row.NewRowState),
    changeTimestamp: row.ChangeTimestamp instanceof Date
      ? row.ChangeTimestamp.toISOString()
      : row.ChangeTimestamp,
    changedBy: row.ChangedBy
  };
}

function buildWhereClause(filters: RecentChangesFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = ['(uc.PlotID = ? OR uc.PlotID IS NULL)'];
  const params: unknown[] = [];

  if (filters.operation !== 'all') {
    conditions.push('uc.Operation = ?');
    params.push(filters.operation);
  }

  if (filters.changedBy) {
    conditions.push('uc.ChangedBy = ?');
    params.push(filters.changedBy);
  }

  if (filters.tableName) {
    conditions.push('uc.TableName = ?');
    params.push(filters.tableName);
  }

  if (filters.quickSearch) {
    const searchPattern = `%${filters.quickSearch}%`;
    conditions.push(
      '(uc.RecordID LIKE ? OR uc.TableName LIKE ? OR uc.ChangedBy LIKE ? OR CAST(uc.OldRowState AS CHAR) LIKE ? OR CAST(uc.NewRowState AS CHAR) LIKE ?)'
    );
    params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  return { clause: conditions.join(' AND '), params };
}

function buildChangelogQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT uc.ChangeID, uc.TableName, uc.RecordID, uc.Operation,
            uc.OldRowState, uc.NewRowState, uc.ChangeTimestamp, uc.ChangedBy
     FROM ??.unifiedchangelog uc`
  );
}

function buildCountQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT COUNT(*) AS total FROM ??.unifiedchangelog uc`
  );
}

function buildSummaryQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT uc.Operation, COUNT(*) AS cnt
     FROM ??.unifiedchangelog uc`
  );
}

function buildFacetsUsersQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT uc.ChangedBy AS value, COUNT(*) AS cnt
     FROM ??.unifiedchangelog uc`
  );
}

function buildFacetsTablesQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT uc.TableName AS value, COUNT(*) AS cnt
     FROM ??.unifiedchangelog uc`
  );
}

export async function queryRecentChanges(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  page: number,
  pageSize: number,
  filters: RecentChangesFilters
): Promise<RecentChangesQueryResponse> {
  const { clause, params } = buildWhereClause(filters);
  const plotParams = [plotID];
  const allWhereParams = [...plotParams, ...params];

  const baseQuery = buildChangelogQuery(schema);
  const dataQuery = `${baseQuery} WHERE ${clause} ORDER BY uc.ChangeTimestamp DESC LIMIT ?, ?`;
  const offset = page * pageSize;
  const dataParams = [...allWhereParams, offset, pageSize + 1];

  const countQuery = `${buildCountQuery(schema)} WHERE ${clause}`;

  const summaryQuery = `${buildSummaryQuery(schema)} WHERE ${clause} GROUP BY uc.Operation`;

  const [rawRows, countResult, summaryResult] = await Promise.all([
    connectionManager.executeQuery(dataQuery, dataParams) as Promise<RawChangelogRow[]>,
    connectionManager.executeQuery(countQuery, allWhereParams) as Promise<Array<{ total: number }>>,
    connectionManager.executeQuery(summaryQuery, allWhereParams) as Promise<Array<{ Operation: string; cnt: number }>>
  ]);

  const hasMore = rawRows.length > pageSize;
  const trimmedRows = hasMore ? rawRows.slice(0, pageSize) : rawRows;
  const entries = trimmedRows.map(toChangelogEntry);
  const items = groupIntoBatches(entries);

  const totalItems = countResult[0]?.total ?? 0;

  const summaryMap = new Map(summaryResult.map(row => [row.Operation, Number(row.cnt)]));
  const summary: RecentChangesSummary = {
    total: totalItems,
    updates: summaryMap.get('UPDATE') ?? 0,
    inserts: summaryMap.get('INSERT') ?? 0,
    deletes: summaryMap.get('DELETE') ?? 0
  };

  return { items, totalItems, summary, hasMore };
}

export async function queryRecentChangesFacets(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number
): Promise<RecentChangesFacetsResponse> {
  const plotCondition = '(uc.PlotID = ? OR uc.PlotID IS NULL)';
  const plotParams = [plotID];

  const usersQuery = `${buildFacetsUsersQuery(schema)} WHERE ${plotCondition} GROUP BY uc.ChangedBy ORDER BY cnt DESC`;
  const tablesQuery = `${buildFacetsTablesQuery(schema)} WHERE ${plotCondition} GROUP BY uc.TableName ORDER BY cnt DESC`;
  const operationQuery = `${buildSummaryQuery(schema)} WHERE ${plotCondition} GROUP BY uc.Operation`;

  const [usersResult, tablesResult, operationResult] = await Promise.all([
    connectionManager.executeQuery(usersQuery, plotParams) as Promise<Array<{ value: string; cnt: number }>>,
    connectionManager.executeQuery(tablesQuery, plotParams) as Promise<Array<{ value: string; cnt: number }>>,
    connectionManager.executeQuery(operationQuery, plotParams) as Promise<Array<{ Operation: string; cnt: number }>>
  ]);

  const toFacetOptions = (rows: Array<{ value: string; cnt: number }>): FacetOption[] =>
    rows.map(row => ({ value: row.value, count: Number(row.cnt) }));

  const operationMap = new Map(operationResult.map(row => [row.Operation, Number(row.cnt)]));

  return {
    users: toFacetOptions(usersResult),
    tables: toFacetOptions(tablesResult),
    operationCounts: {
      INSERT: operationMap.get('INSERT') ?? 0,
      UPDATE: operationMap.get('UPDATE') ?? 0,
      DELETE: operationMap.get('DELETE') ?? 0
    }
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/changes/explorer/_shared.ts
git commit -m "Add shared query logic for Recent Changes Explorer API"
```

---

### Task 4: API Route Endpoints

**Goal:** Create the query and facets POST endpoints following the errors explorer route pattern.

**Files:**
- Create: `app/api/changes/explorer/query/route.ts`
- Create: `app/api/changes/explorer/facets/route.ts`

**Acceptance Criteria:**
- [ ] Both endpoints validate schema with `isValidSchema`
- [ ] Both require plotID
- [ ] Query endpoint parses request body with safe defaults
- [ ] Facets endpoint returns user/table/operation facets
- [ ] Both use `ConnectionManager.getInstance()` with `closeConnection()` in finally
- [ ] Both return proper HTTP status codes from `HTTPResponses`

**Verify:** `npx tsc --noEmit` succeeds for both route files

**Steps:**

- [ ] **Step 1: Create the query route**

Create `app/api/changes/explorer/query/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_RECENT_CHANGES_FILTERS, RecentChangesQueryRequest } from '@/config/recentchangesexplorer';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { queryRecentChanges } from '../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function parseRequest(body: Partial<RecentChangesQueryRequest>): RecentChangesQueryRequest {
  return {
    schema: body.schema ?? '',
    plotID: Number(body.plotID ?? 0),
    page: Math.max(0, Number(body.page ?? 0)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Number(body.pageSize ?? DEFAULT_PAGE_SIZE))),
    filters: {
      ...DEFAULT_RECENT_CHANGES_FILTERS,
      ...body.filters
    }
  };
}

export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const body = parseRequest(await request.json());
    if (!isValidSchema(body.schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!body.plotID) {
      return NextResponse.json({ error: 'plotID is required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await queryRecentChanges(
      connectionManager,
      body.schema,
      body.plotID,
      body.page,
      body.pageSize,
      body.filters
    );
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error querying recent changes explorer:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
```

- [ ] **Step 2: Create the facets route**

Create `app/api/changes/explorer/facets/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { queryRecentChangesFacets } from '../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

interface FacetsRequestBody {
  schema?: string;
  plotID?: number;
}

export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const body: FacetsRequestBody = await request.json();
    const schema = body.schema ?? '';
    const plotID = Number(body.plotID ?? 0);

    if (!isValidSchema(schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!plotID) {
      return NextResponse.json({ error: 'plotID is required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await queryRecentChangesFacets(connectionManager, schema, plotID);
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error loading recent changes facets:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/changes/explorer/query/route.ts app/api/changes/explorer/facets/route.ts
git commit -m "Add query and facets API routes for Recent Changes Explorer"
```

---

### Task 5: RecentChangesExplorer Component

**Goal:** Build the main UI component with filter panel, card feed, and load-more pagination.

**Files:**
- Create: `components/changes/recentchangesexplorer.tsx`

**Acceptance Criteria:**
- [ ] Summary cards show total, updates, uploads, deletions with correct colors
- [ ] Preset chips toggle correctly (solid when selected, soft when not)
- [ ] Changed By and Table dropdowns populated from facets API
- [ ] Quick search filters results
- [ ] UPDATE cards show color-coded diff (red strikethrough old, green new)
- [ ] INSERT batch cards show count with expand/collapse toggle
- [ ] DELETE cards show removed fields in red
- [ ] "Load more" button appends next page
- [ ] Filter changes reset to page 0
- [ ] Loading state shows skeleton/spinner
- [ ] Empty state shows friendly message
- [ ] Error state shows Alert

**Verify:** `npx next build` succeeds (no compile errors); manual testing against running app

**Steps:**

- [ ] **Step 1: Create the component**

Create `components/changes/recentchangesexplorer.tsx`:

```typescript
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  FormControl,
  FormLabel,
  Input,
  Option,
  Select,
  Sheet,
  Skeleton,
  Stack,
  Typography
} from '@mui/joy';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import {
  DEFAULT_RECENT_CHANGES_FILTERS,
  FeedItem,
  RecentChangesFilters,
  RecentChangesFacetsResponse,
  RecentChangesQueryResponse,
  RecentChangesSummary,
  RECENT_CHANGES_PRESETS,
  ChangelogEntry,
  BatchInsertGroup,
  getKeyFields
} from '@/config/recentchangesexplorer';
import { computeDiff, DiffEntry } from '@/config/changelogdiff';
import moment from 'moment';

const DEFAULT_PAGE_SIZE = 25;

const OPERATION_COLORS = {
  INSERT: 'success',
  UPDATE: 'primary',
  DELETE: 'danger'
} as const;

const DEFAULT_SUMMARY: RecentChangesSummary = {
  total: 0,
  updates: 0,
  inserts: 0,
  deletes: 0
};

const DEFAULT_FACETS: RecentChangesFacetsResponse = {
  users: [],
  tables: [],
  operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 }
};

function formatRelativeTime(timestamp: string): { relative: string; full: string } {
  const m = moment(timestamp);
  return {
    relative: m.fromNow(),
    full: m.format('dddd, MMMM Do YYYY, hh:mm:ss a')
  };
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DiffBlock({ diffs }: { diffs: DiffEntry[] }) {
  if (diffs.length === 0) {
    return (
      <Typography level="body-sm" sx={{ color: 'neutral.500', fontStyle: 'italic' }}>
        No visible changes
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: 'neutral.900',
        borderRadius: '6px',
        p: 1.5,
        fontFamily: 'monospace',
        fontSize: '12px'
      }}
    >
      {diffs.map(diff => (
        <Stack key={diff.field} direction="row" spacing={1.5} sx={{ mb: 0.5, alignItems: 'center' }}>
          <Typography sx={{ color: 'neutral.500', minWidth: 130, fontFamily: 'inherit', fontSize: 'inherit' }}>
            {diff.field}
          </Typography>
          <Box
            component="span"
            sx={{
              backgroundColor: 'rgba(248, 113, 113, 0.15)',
              color: '#f87171',
              px: 0.75,
              borderRadius: '3px',
              textDecoration: 'line-through',
              fontFamily: 'inherit',
              fontSize: 'inherit'
            }}
          >
            {formatDiffValue(diff.oldValue)}
          </Box>
          <Typography sx={{ color: 'neutral.600', fontFamily: 'inherit', fontSize: 'inherit' }}>→</Typography>
          <Box
            component="span"
            sx={{
              backgroundColor: 'rgba(110, 231, 122, 0.15)',
              color: '#6ee77a',
              px: 0.75,
              borderRadius: '3px',
              fontFamily: 'inherit',
              fontSize: 'inherit'
            }}
          >
            {formatDiffValue(diff.newValue)}
          </Box>
        </Stack>
      ))}
    </Box>
  );
}

function InsertSummary({ entry }: { entry: ChangelogEntry }) {
  const fields = entry.newRowState ? getKeyFields(entry.tableName, entry.newRowState) : [];
  const display = fields.map(f => `${f}: ${formatDiffValue(entry.newRowState?.[f])}`).join(', ');

  return (
    <Box sx={{ backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' }}>
      <Typography sx={{ color: '#6ee77a', fontFamily: 'inherit', fontSize: 'inherit' }}>
        + {display || 'New row'}
      </Typography>
    </Box>
  );
}

function DeleteSummary({ entry }: { entry: ChangelogEntry }) {
  const fields = entry.oldRowState ? getKeyFields(entry.tableName, entry.oldRowState) : [];
  const display = fields.map(f => `${f}: ${formatDiffValue(entry.oldRowState?.[f])}`).join(', ');

  return (
    <Box sx={{ backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' }}>
      <Typography sx={{ color: '#f87171', fontFamily: 'inherit', fontSize: 'inherit' }}>
        - {display || 'Removed row'}
      </Typography>
    </Box>
  );
}

function CardHeader({ operation, tableName, recordID, changedBy, timestamp }: {
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  tableName: string;
  recordID?: string;
  changedBy: string;
  timestamp: string;
}) {
  const time = formatRelativeTime(timestamp);

  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip size="sm" variant="soft" color={OPERATION_COLORS[operation]}>
          {operation}
        </Chip>
        <Typography level="title-sm">{tableName}</Typography>
        {recordID && (
          <>
            <Typography sx={{ color: 'neutral.600' }}>·</Typography>
            <Typography level="body-xs" sx={{ color: 'neutral.500' }}>Record #{recordID}</Typography>
          </>
        )}
      </Stack>
      <Typography level="body-xs" sx={{ color: 'neutral.500' }} title={time.full}>
        {changedBy} · {time.relative}
      </Typography>
    </Stack>
  );
}

function UpdateCard({ entry }: { entry: ChangelogEntry }) {
  const diffs = useMemo(() => computeDiff(entry.oldRowState, entry.newRowState), [entry.oldRowState, entry.newRowState]);

  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'primary.500' }}>
      <Stack spacing={1.25}>
        <CardHeader operation="UPDATE" tableName={entry.tableName} recordID={entry.recordID} changedBy={entry.changedBy} timestamp={entry.changeTimestamp} />
        <DiffBlock diffs={diffs} />
      </Stack>
    </Sheet>
  );
}

function SingleInsertCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'success.500' }}>
      <Stack spacing={1.25}>
        <CardHeader operation="INSERT" tableName={entry.tableName} recordID={entry.recordID} changedBy={entry.changedBy} timestamp={entry.changeTimestamp} />
        <InsertSummary entry={entry} />
      </Stack>
    </Sheet>
  );
}

function BatchInsertCard({ batch }: { batch: BatchInsertGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'success.500' }}>
      <Stack spacing={1.25}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Chip size="sm" variant="soft" color="success">INSERT</Chip>
            <Typography level="title-sm">{batch.tableName}</Typography>
            <Typography sx={{ color: 'neutral.600' }}>·</Typography>
            <Typography level="body-sm" sx={{ color: 'success.500', fontWeight: 500 }}>
              {batch.count} rows uploaded
            </Typography>
          </Stack>
          <Typography level="body-xs" sx={{ color: 'neutral.500' }} title={formatRelativeTime(batch.timestamp).full}>
            {batch.changedBy} · {formatRelativeTime(batch.timestamp).relative}
          </Typography>
        </Stack>

        <Button
          variant="plain"
          size="sm"
          onClick={() => setExpanded(prev => !prev)}
          startDecorator={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ alignSelf: 'flex-start', color: 'neutral.500' }}
        >
          {expanded ? 'Hide uploaded records' : 'Show uploaded records'}
        </Button>

        {expanded && (
          <Box sx={{ backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' }}>
            {batch.entries.map(entry => {
              const fields = entry.newRowState ? getKeyFields(batch.tableName, entry.newRowState) : [];
              const display = fields.map(f => `${f}: ${formatDiffValue(entry.newRowState?.[f])}`).join(', ');
              return (
                <Typography key={entry.changeID} sx={{ color: '#6ee77a', fontFamily: 'inherit', fontSize: 'inherit', mb: 0.5 }}>
                  + {display || 'New row'}
                </Typography>
              );
            })}
          </Box>
        )}
      </Stack>
    </Sheet>
  );
}

function DeleteCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'danger.500' }}>
      <Stack spacing={1.25}>
        <CardHeader operation="DELETE" tableName={entry.tableName} recordID={entry.recordID} changedBy={entry.changedBy} timestamp={entry.changeTimestamp} />
        <DeleteSummary entry={entry} />
      </Stack>
    </Sheet>
  );
}

function FeedItemCard({ item }: { item: FeedItem }) {
  if (item.type === 'batch') {
    return <BatchInsertCard batch={item} />;
  }
  const { entry } = item;
  switch (entry.operation) {
    case 'UPDATE':
      return <UpdateCard entry={entry} />;
    case 'DELETE':
      return <DeleteCard entry={entry} />;
    case 'INSERT':
      return <SingleInsertCard entry={entry} />;
  }
}

export default function RecentChangesExplorer() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();

  const [filters, setFilters] = useState<RecentChangesFilters>(DEFAULT_RECENT_CHANGES_FILTERS);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [summary, setSummary] = useState<RecentChangesSummary>(DEFAULT_SUMMARY);
  const [facets, setFacets] = useState<RecentChangesFacetsResponse>(DEFAULT_FACETS);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingFacets, setLoadingFacets] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateFilters = useCallback((updater: (prev: RecentChangesFilters) => RecentChangesFilters) => {
    setFilters(prev => updater(prev));
    setPage(0);
  }, []);

  const handlePresetClick = useCallback((presetId: string) => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setFilters({ ...preset.filters, presetId });
    setPage(0);
  }, []);

  const fetchFacets = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;
    setLoadingFacets(true);
    try {
      const response = await fetch('/api/changes/explorer/facets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: currentSite.schemaName, plotID: currentPlot.plotID })
      });
      if (!response.ok) throw new Error(`Facets request failed: ${response.status}`);
      const data: RecentChangesFacetsResponse = await response.json();
      setFacets(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
    } finally {
      setLoadingFacets(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID]);

  const fetchItems = useCallback(async (pageNum: number, append: boolean) => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const response = await fetch('/api/changes/explorer/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: currentSite.schemaName,
          plotID: currentPlot.plotID,
          page: pageNum,
          pageSize: DEFAULT_PAGE_SIZE,
          filters
        })
      });
      if (!response.ok) throw new Error(`Query request failed: ${response.status}`);
      const data: RecentChangesQueryResponse = await response.json();

      if (append) {
        setItems(prev => [...prev, ...data.items]);
      } else {
        setItems(data.items);
      }
      setSummary(data.summary);
      setHasMore(data.hasMore);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, filters]);

  useEffect(() => {
    fetchFacets();
  }, [fetchFacets]);

  useEffect(() => {
    fetchItems(0, false);
  }, [fetchItems]);

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchItems(nextPage, true);
  }, [page, fetchItems]);

  if (!currentSite?.schemaName || !currentPlot?.plotID) {
    return (
      <Stack spacing={2} sx={{ width: '100%' }}>
        <Typography level="h2">Recent Changes</Typography>
        <Alert color="warning">Please select a site and plot to view recent changes.</Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Stack spacing={1}>
        <Typography level="h2">Recent Changes</Typography>
        <Typography level="body-sm">
          Review all changes made to data within this plot, filter by operation type, user, or table.
        </Typography>
      </Stack>

      {errorMessage && (
        <Alert color="danger" startDecorator={<ReportProblemOutlinedIcon />}>
          {errorMessage}
        </Alert>
      )}

      {/* Summary Cards */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <Card variant="soft" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Total Changes</Typography>
          <Typography level="h3">{summary.total}</Typography>
        </Card>
        <Card variant="soft" color="primary" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Updates</Typography>
          <Typography level="h3">{summary.updates}</Typography>
        </Card>
        <Card variant="soft" color="success" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Uploads</Typography>
          <Typography level="h3">{summary.inserts}</Typography>
        </Card>
        <Card variant="soft" color="danger" sx={{ minWidth: 140 }}>
          <Typography level="body-xs">Deletions</Typography>
          <Typography level="h3">{summary.deletes}</Typography>
        </Card>
      </Stack>

      {/* Filter Panel */}
      <Sheet variant="outlined" sx={{ p: 2, borderRadius: 'md' }}>
        <Stack spacing={2}>
          {/* Preset chips */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flexWrap: 'wrap' }}>
            {RECENT_CHANGES_PRESETS.map(preset => (
              <Chip
                key={preset.id}
                variant={filters.presetId === preset.id ? 'solid' : 'soft'}
                color={filters.presetId === preset.id ? 'primary' : 'neutral'}
                role="button"
                tabIndex={0}
                onClick={() => handlePresetClick(preset.id)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePresetClick(preset.id);
                  }
                }}
                sx={{ cursor: 'pointer' }}
              >
                {preset.label}
              </Chip>
            ))}
          </Stack>

          {/* Dropdowns + search */}
          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1.5}>
            <FormControl sx={{ minWidth: 200 }}>
              <FormLabel htmlFor="changes-explorer-changed-by">Changed By</FormLabel>
              <Select
                id="changes-explorer-changed-by"
                value={filters.changedBy}
                onChange={(_event, value) =>
                  updateFilters(prev => ({ ...prev, changedBy: value ?? '', presetId: undefined }))
                }
              >
                <Option value="">All users</Option>
                {facets.users.map(user => (
                  <Option key={user.value} value={user.value}>
                    {user.value} ({user.count})
                  </Option>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 200 }}>
              <FormLabel htmlFor="changes-explorer-table">Table</FormLabel>
              <Select
                id="changes-explorer-table"
                value={filters.tableName}
                onChange={(_event, value) =>
                  updateFilters(prev => ({ ...prev, tableName: value ?? '', presetId: undefined }))
                }
              >
                <Option value="">All tables</Option>
                {facets.tables.map(table => (
                  <Option key={table.value} value={table.value}>
                    {table.value} ({table.count})
                  </Option>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 220, flex: 1 }}>
              <FormLabel htmlFor="changes-explorer-quick-search">Quick Search</FormLabel>
              <Input
                id="changes-explorer-quick-search"
                value={filters.quickSearch}
                onChange={event =>
                  updateFilters(prev => ({ ...prev, quickSearch: event.target.value, presetId: undefined }))
                }
                placeholder="Search records, tags, users..."
              />
            </FormControl>
          </Stack>
        </Stack>
      </Sheet>

      {/* Card Feed */}
      {loading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={100} sx={{ borderRadius: 'md' }} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Sheet variant="soft" sx={{ p: 4, borderRadius: 'md', textAlign: 'center' }}>
          <Typography level="body-lg" sx={{ color: 'neutral.500' }}>
            No changes found
          </Typography>
          <Typography level="body-sm" sx={{ color: 'neutral.400', mt: 1 }}>
            Try adjusting your filters or selecting a different preset.
          </Typography>
        </Sheet>
      ) : (
        <Stack spacing={1.5}>
          {items.map((item, index) => (
            <FeedItemCard key={item.type === 'batch' ? `batch-${item.timestamp}-${item.tableName}` : `single-${item.entry.changeID}`} item={item} />
          ))}

          {hasMore && (
            <Button
              variant="outlined"
              color="neutral"
              onClick={handleLoadMore}
              loading={loadingMore}
              sx={{ alignSelf: 'center' }}
            >
              Load more changes
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/changes/recentchangesexplorer.tsx
git commit -m "Add RecentChangesExplorer component with card feed and filters"
```

---

### Task 6: Page Route Swap and Cleanup

**Goal:** Update the page route to render the new component and remove the old imports.

**Files:**
- Modify: `app/(hub)/measurementshub/recentchanges/page.tsx`

**Acceptance Criteria:**
- [ ] Page renders `RecentChangesExplorer` instead of `IsolatedUnifiedChangelogDataGrid`
- [ ] Old `RenderGridFormExplanations` import removed
- [ ] `next build` succeeds

**Verify:** `npx next build` → build succeeds with no errors

**Steps:**

- [ ] **Step 1: Update the page route**

Replace the contents of `app/(hub)/measurementshub/recentchanges/page.tsx` with:

```typescript
'use client';

import RecentChangesExplorer from '@/components/changes/recentchangesexplorer';

export default function RecentChangesPage() {
  return <RecentChangesExplorer />;
}
```

- [ ] **Step 2: Verify the build**

Run: `npx next build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add app/(hub)/measurementshub/recentchanges/page.tsx
git commit -m "Swap Recent Changes page to use new RecentChangesExplorer component"
```

---

### Task 7: Build Verification and Manual Testing

**Goal:** Verify the full feature works end-to-end: build, unit tests, and manual smoke test.

**Files:**
- No new files — verification only

**Acceptance Criteria:**
- [ ] All unit tests pass (`npx vitest run config/changelogdiff.test.ts config/recentchangesexplorer.test.ts`)
- [ ] `npx next build` succeeds
- [ ] Manual test: page loads, summary cards populate, presets filter correctly, UPDATE cards show diffs, batch INSERTs group, "Load more" works

**Verify:**
```bash
npx vitest run config/changelogdiff.test.ts config/recentchangesexplorer.test.ts
npx next build
```
→ All pass, build succeeds

**Steps:**

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run config/changelogdiff.test.ts config/recentchangesexplorer.test.ts`
Expected: All tests pass

- [ ] **Step 2: Run full build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Navigate to the Recent Changes page. Verify:
1. Summary cards show counts
2. Clicking presets filters the feed
3. UPDATE cards show color-coded diffs
4. Batch INSERTs are grouped with expand/collapse
5. DELETE cards show red summary
6. "Load more" appends results
7. Changed By and Table dropdowns populate and filter

- [ ] **Step 4: Fix any issues found**

Address any build errors, TypeScript issues, or rendering problems.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -u
git commit -m "Fix issues found during build verification"
```
