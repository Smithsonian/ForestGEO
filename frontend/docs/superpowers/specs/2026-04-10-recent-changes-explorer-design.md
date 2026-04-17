# Recent Changes Explorer — Design Spec

## Goal

Replace the current Recent Changes page (flat MUI DataGrid with raw JSON dumps) with a streamlined, card-based activity feed that makes it immediately obvious what changed, by whom, and when. Mirror the View Errors page's filter pattern so researchers have a consistent experience across the measurement hub.

## Scope

- New `RecentChangesExplorer` component replacing `IsolatedUnifiedChangelogDataGrid`
- New config/types module mirroring `config/errorsexplorer.ts`
- New dedicated API endpoints (query + facets) mirroring the errors explorer API pattern
- New diff utility for computing field-level changes between old/new row state
- Page route update (minimal — swap the rendered component)

Out of scope: changes to the `unifiedchangelog` table schema, triggers, or stored procedures.

## Data Source

The existing `unifiedchangelog` table, which is already populated by MySQL triggers. Key fields:

| Field | Type | Usage |
|-------|------|-------|
| `changeID` | int (PK) | Unique identifier |
| `tableName` | varchar(64) | Which table was changed |
| `recordID` | varchar(255) | The affected record's ID |
| `operation` | enum('INSERT','UPDATE','DELETE') | Change type |
| `oldRowState` | json | Full row before change (null for INSERT) |
| `newRowState` | json | Full row after change (null for DELETE) |
| `changeTimestamp` | datetime | When the change occurred |
| `changedBy` | varchar(64) | User email |
| `plotID` | int | Associated plot (null for global changes) |
| `censusID` | int | Associated census (null for global changes) |

## Scoping

Changes are scoped to the **current plot** (not census). The query filters by `plotID = ? OR plotID IS NULL` to include both plot-specific and global changes.

## Component Architecture

### Files

| File | Purpose |
|------|---------|
| `config/recentchangesexplorer.ts` | Types, filter interface, presets, defaults |
| `config/changelogdiff.ts` | Pure diff utility: `computeDiff(oldRowState, newRowState) → DiffEntry[]` |
| `components/changes/recentchangesexplorer.tsx` | Main component: filter state, data fetching, card rendering |
| `app/api/changes/explorer/query/route.ts` | POST endpoint — paginated, filtered changelog query with batch grouping |
| `app/api/changes/explorer/facets/route.ts` | POST endpoint — distinct users, tables, operation counts |
| `app/api/changes/explorer/_shared.ts` | Shared query-building logic |
| `app/(hub)/measurementshub/recentchanges/page.tsx` | Page route — renders `RecentChangesExplorer` |

### Filter State

```typescript
type ChangeOperation = 'all' | 'INSERT' | 'UPDATE' | 'DELETE';

interface RecentChangesFilters {
  operation: ChangeOperation;
  changedBy: string;       // empty string = all users
  tableName: string;       // empty string = all tables
  quickSearch: string;
  presetId?: string;
}
```

### Presets

| Preset | Label | Filter |
|--------|-------|--------|
| `all_changes` | All Changes | `operation: 'all'` |
| `measurement_updates` | Measurement Updates | `operation: 'UPDATE'` |
| `deletions` | Deletions | `operation: 'DELETE'` |
| `uploads` | Uploads | `operation: 'INSERT'` |

Selecting a preset sets `operation` and clears `changedBy`, `tableName`, `quickSearch`. Manually changing any dropdown or search field clears `presetId`.

### Query Request/Response

```typescript
interface RecentChangesQueryRequest {
  schema: string;
  plotID: number;
  page: number;
  pageSize: number;
  filters: RecentChangesFilters;
}

interface ChangelogEntry {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRowState: Record<string, unknown> | null;
  newRowState: Record<string, unknown> | null;
  changeTimestamp: string;
  changedBy: string;
}

// For batch-grouped INSERTs
interface BatchInsertGroup {
  type: 'batch';
  tableName: string;
  changedBy: string;
  timestamp: string;        // earliest timestamp in batch
  count: number;
  entries: ChangelogEntry[];  // individual rows, loaded on expand
}

// A feed item is either a single change or a batch group
type FeedItem =
  | { type: 'single'; entry: ChangelogEntry }
  | BatchInsertGroup;

interface RecentChangesQueryResponse {
  items: FeedItem[];
  totalItems: number;
  summary: RecentChangesSummary;
  hasMore: boolean;
}

interface RecentChangesSummary {
  total: number;
  updates: number;
  inserts: number;
  deletes: number;
}
```

### Facets Response

```typescript
interface RecentChangesFacetsResponse {
  users: Array<{ value: string; count: number }>;
  tables: Array<{ value: string; count: number }>;
  operationCounts: {
    INSERT: number;
    UPDATE: number;
    DELETE: number;
  };
}
```

## UI Layout

Top to bottom:

1. **Header**: "Recent Changes" title + subtitle
2. **Summary cards** (horizontal row): Total Changes (neutral), Updates (blue/primary), Uploads (green/success), Deletions (red/danger)
3. **Filter panel** (Sheet, outlined):
   - Row 1: Preset chips — All Changes, Measurement Updates, Deletions, Uploads. MUI Joy `Chip` with `variant: solid/soft`, `color: primary/neutral` toggle. Same pattern as `errorsexplorer.tsx` lines 738-758.
   - Row 2: Changed By `Select`, Table `Select`, Quick Search `Input`. All in a responsive `Stack direction={{ xs: 'column', xl: 'row' }}`.
4. **Card feed** (vertical `Stack`): Feed items rendered as cards
5. **Load more button** at bottom (when `hasMore` is true)

## Card Designs

All cards share:
- `Sheet` or `Box` with `border-left: 3px solid {operationColor}`
- Header row: operation badge (`Chip`), table name, record ID, right-aligned user + relative timestamp (full date in title/tooltip)

### UPDATE Card

- Diff block below header in monospace
- Only fields that differ between `oldRowState` and `newRowState`
- Each diff row: `FieldName  oldValue → newValue`
- Old value: red background, strikethrough
- New value: green background
- If zero differences found: "No visible changes"

### INSERT Card — Batch Grouped

Batch grouping logic: consecutive INSERT entries with the same `tableName` + `changedBy` within a 60-second window are grouped into a single `BatchInsertGroup`.

- Collapsed state: "N rows uploaded" with expand toggle ("Show uploaded records")
- Expanded state: list of inserted records showing key identifying fields per table type:
  - `coremeasurements`: TreeTag, StemTag, SpeciesCode, QuadratName, MeasuredDBH
  - `species`: SpeciesCode, Family, Genus
  - `stems`: StemTag, TreeID, QuadratID, LocalX, LocalY
  - Other tables: first 5 non-ID fields from the newRowState
- Each line prefixed with `+` in green

### INSERT Card — Single

For one-off inserts not part of a batch:
- Same as expanded batch but with just one record
- Shows key identifying fields in green, prefixed with `+`

### DELETE Card

- Red summary of the deleted row's key identifying fields
- Same field selection logic as INSERT but prefixed with `-` in red

## Diff Utility

`config/changelogdiff.ts`:

```typescript
interface DiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function computeDiff(
  oldRowState: Record<string, unknown> | null,
  newRowState: Record<string, unknown> | null
): DiffEntry[]
```

- Compares each key present in either object
- Returns entries only where values differ (using JSON.stringify for deep comparison)
- Excludes internal/metadata fields: `id`, `changeID`, `plotID`, `censusID`, timestamps that are auto-managed
- Sorts results by field name for stable ordering

## API Layer

### `POST /api/changes/explorer/query`

SQL query structure:
```sql
SELECT ChangeID, TableName, RecordID, Operation,
       OldRowState, NewRowState, ChangeTimestamp, ChangedBy
FROM {schema}.unifiedchangelog
WHERE (PlotID = ? OR PlotID IS NULL)
  AND (Operation = ? OR ? = 'all')       -- operation filter
  AND (ChangedBy = ? OR ? = '')           -- changedBy filter
  AND (TableName = ? OR ? = '')           -- tableName filter
  AND (RecordID LIKE ? OR TableName LIKE ? OR ChangedBy LIKE ?
       OR CAST(OldRowState AS CHAR) LIKE ? OR CAST(NewRowState AS CHAR) LIKE ?
       OR ? = '')                          -- quickSearch: empty = no filter
ORDER BY ChangeTimestamp DESC
LIMIT ?, ?
```

Batch grouping is performed in the API layer after fetching raw rows. The API fetches `pageSize + 1` rows to determine `hasMore`, then groups consecutive INSERTs with matching `tableName` + `changedBy` within a 60-second window.

### `POST /api/changes/explorer/facets`

Returns distinct values with counts, filtered by the current plot:
```sql
-- Users
SELECT ChangedBy, COUNT(*) as cnt
FROM {schema}.unifiedchangelog
WHERE (PlotID = ? OR PlotID IS NULL)
GROUP BY ChangedBy

-- Tables
SELECT TableName, COUNT(*) as cnt
FROM {schema}.unifiedchangelog
WHERE (PlotID = ? OR PlotID IS NULL)
GROUP BY TableName

-- Operation counts
SELECT Operation, COUNT(*) as cnt
FROM {schema}.unifiedchangelog
WHERE (PlotID = ? OR PlotID IS NULL)
GROUP BY Operation
```

## Pagination

- "Load more" button appends the next page of results to the existing feed
- Default page size: 25 items
- State tracks current page number, increments on "Load more" click
- Filter changes reset to page 0 and replace the feed
- `hasMore` flag from API controls button visibility

## Error Handling

- Loading state: skeleton cards while fetching
- API error: `Alert` component with error message (same pattern as errors explorer)
- Empty state: friendly message "No changes found" with suggestion to adjust filters
- Invalid JSON in oldRowState/newRowState: show "Unable to parse change data" in the diff block

## Testing Considerations

- `computeDiff` is a pure function — unit testable with various old/new state combinations
- Batch grouping logic should be extracted into a pure function for unit testing
- Integration tests should verify the query endpoint returns correctly filtered/paginated results against the local MySQL test database
