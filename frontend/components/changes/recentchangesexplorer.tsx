'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, Chip, FormControl, FormLabel, Input, Option, Select, Sheet, Skeleton, Stack, Typography } from '@mui/joy';
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
          <Typography sx={{ color: 'neutral.500', minWidth: 130, fontFamily: 'inherit', fontSize: 'inherit' }}>{diff.field}</Typography>
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
      <Typography sx={{ color: '#6ee77a', fontFamily: 'inherit', fontSize: 'inherit' }}>+ {display || 'New row'}</Typography>
    </Box>
  );
}

function DeleteSummary({ entry }: { entry: ChangelogEntry }) {
  const fields = entry.oldRowState ? getKeyFields(entry.tableName, entry.oldRowState) : [];
  const display = fields.map(f => `${f}: ${formatDiffValue(entry.oldRowState?.[f])}`).join(', ');

  return (
    <Box sx={{ backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' }}>
      <Typography sx={{ color: '#f87171', fontFamily: 'inherit', fontSize: 'inherit' }}>- {display || 'Removed row'}</Typography>
    </Box>
  );
}

function CardHeader({
  operation,
  tableName,
  recordID,
  changedBy,
  timestamp
}: {
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
            <Typography level="body-xs" sx={{ color: 'neutral.500' }}>
              Record #{recordID}
            </Typography>
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
            <Chip size="sm" variant="soft" color="success">
              INSERT
            </Chip>
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
  const [_loadingFacets, setLoadingFacets] = useState(false);
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

  const fetchItems = useCallback(
    async (pageNum: number, append: boolean) => {
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
    },
    [currentSite?.schemaName, currentPlot?.plotID, filters]
  );

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
        <Typography level="body-sm">Review all changes made to data within this plot, filter by operation type, user, or table.</Typography>
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
                onChange={(_event, value) => updateFilters(prev => ({ ...prev, changedBy: value ?? '', presetId: undefined }))}
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
                onChange={(_event, value) => updateFilters(prev => ({ ...prev, tableName: value ?? '', presetId: undefined }))}
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
                aria-label="Quick Search"
                value={filters.quickSearch}
                onChange={event => updateFilters(prev => ({ ...prev, quickSearch: event.target.value, presetId: undefined }))}
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
          {items.map(item => (
            <FeedItemCard key={item.type === 'batch' ? `batch-${item.timestamp}-${item.tableName}` : `single-${item.entry.changeID}`} item={item} />
          ))}

          {hasMore && (
            <Button variant="outlined" color="neutral" onClick={handleLoadMore} loading={loadingMore} sx={{ alignSelf: 'center' }}>
              Load more changes
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
