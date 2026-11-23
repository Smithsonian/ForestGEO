'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
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
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
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
  CHANGE_DATE_ZONE_LABEL,
  isDateRangeInverted,
  NO_DATE_BOUND,
  ChangelogEntry,
  BatchInsertGroup,
  getKeyFields
} from '@/config/recentchangesexplorer';
import { computeDiff, DiffEntry, recordedFieldNames } from '@/config/changelogdiff';
import {
  BULK_REVISION_CHANGELOG_TABLE,
  FILE_UPLOAD_CHANGELOG_TABLE,
  SUMMARY_CHANGELOG_TABLES,
  type ChangelogRecord,
  type ChangelogRowImage
} from '@/config/changelogdecode';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';
import { CHANGE_QUICK_SEARCH_MAX_LENGTH, EARLIEST_FILTER_DATE_YEAR, LATEST_FILTER_DATE_YEAR, isFilterableDate } from '@/lib/changes/explorerrequest';
import { changeExportFailureMessage, CHANGE_EXPORT_FAILURE_MESSAGES, ChangeExportRequestError, postRecentChangesExport } from '@/lib/changes/explorertransport';
import moment from 'moment';

const DEFAULT_PAGE_SIZE = 25;
const UNKNOWN_USER_LABEL = 'unknown';
const ROW_IMAGES_NOT_RECORDED_TEXT = 'Row images were not recorded for this change';
const ROW_IMAGES_NOT_RECORDED_LINE = "row added, but the older change log didn't save its values";
const PRIOR_VALUES_NOT_RECORDED_CAPTION = 'Prior values were not recorded';
const NEW_VALUES_NOT_RECORDED_CAPTION = 'New values were not recorded';
const NO_FIELD_VALUES_RECORDED_TEXT = 'No field values were recorded';
const NEW_ROW_FALLBACK = 'New row';
const REMOVED_ROW_FALLBACK = 'Removed row';
const INSERT_LINE_COLOR = '#6ee77a';
const DELETE_LINE_COLOR = '#f87171';
const RECORD_PANEL_SX = { backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' } as const;

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

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

export function summarizeChange(entry: Pick<ChangelogEntry, 'operation' | 'tableName' | 'oldRowState' | 'newRowState' | 'recordID'>): string {
  const filename = entry.newRowState?.filename ?? entry.newRowState?.fileName ?? entry.newRowState?.name;
  const tableLabel = entry.tableName.replace(/_/g, ' ');
  const singularTableLabel: Record<string, string> = {
    attributes: 'attribute',
    measurements: 'measurement',
    quadrats: 'quadrat',
    stems: 'stem',
    trees: 'tree',
    users: 'user'
  };
  const objectLabel = singularTableLabel[tableLabel] ?? tableLabel;
  // bulk-revision-apply rows are summaries (see projectBulkRevisionRow), not a real table.
  if (entry.tableName === BULK_REVISION_CHANGELOG_TABLE) return 'Applied a bulk revision';
  if (entry.operation === 'INSERT' && entry.tableName === FILE_UPLOAD_CHANGELOG_TABLE) return filename ? `Uploaded ${filename}` : 'Uploaded a file';
  if (entry.operation === 'UPDATE' && /measurement/i.test(entry.tableName)) return 'Updated a measurement record';
  if (entry.operation === 'DELETE') return `Deleted a ${objectLabel}`;
  if (entry.operation === 'INSERT') return `Added a ${objectLabel}`;
  return `Changed ${tableLabel}`;
}

function displayName(value: string | null): string {
  if (value === null) return UNKNOWN_USER_LABEL;
  return value.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
}

function keyFieldsLine(tableName: string, image: ChangelogRowImage | null): string {
  if (image === null) return '';
  return getKeyFields(tableName, image)
    .map(field => `${field}: ${formatDiffValue(image[field])}`)
    .join(', ');
}

function hasNoRowImage(entry: ChangelogEntry): boolean {
  return entry.records.length === 0 && !SUMMARY_CHANGELOG_TABLES.has(entry.tableName);
}

function RowImagesNotRecorded() {
  return (
    <Typography level="body-sm" sx={{ color: 'neutral.500', fontStyle: 'italic' }}>
      {ROW_IMAGES_NOT_RECORDED_TEXT}
    </Typography>
  );
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
    <details>
      <summary>Details</summary>
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
            <Typography sx={{ color: 'text.tertiary', fontFamily: 'inherit', fontSize: 'inherit' }}>→</Typography>
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
    </details>
  );
}

/** One line per record. The primary key labels a line only when the change holds several records. */
function RecordLines({ entry, side, sign, color, fallback }: { entry: ChangelogEntry; side: 'old' | 'new'; sign: '+' | '-'; color: string; fallback: string }) {
  const lines =
    entry.records.length === 0
      ? [`${sign} ${fallback}`]
      : entry.records.map(record => {
          const keyLabel = entry.records.length > 1 ? `${record.primaryKey} · ` : '';
          const fields = keyFieldsLine(entry.tableName, side === 'new' ? record.newState : record.oldState);
          return `${sign} ${keyLabel}${fields || fallback}`;
        });

  return (
    <Box sx={RECORD_PANEL_SX}>
      {lines.map((line, index) => (
        <Typography key={`${entry.changeID}-${index}`} sx={{ color, fontFamily: 'inherit', fontSize: 'inherit' }}>
          {line}
        </Typography>
      ))}
    </Box>
  );
}

function InsertSummary({ entry }: { entry: ChangelogEntry }) {
  if (hasNoRowImage(entry)) return <RowImagesNotRecorded />;
  return <RecordLines entry={entry} side="new" sign="+" color={INSERT_LINE_COLOR} fallback={NEW_ROW_FALLBACK} />;
}

function DeleteSummary({ entry }: { entry: ChangelogEntry }) {
  if (hasNoRowImage(entry)) return <RowImagesNotRecorded />;
  return <RecordLines entry={entry} side="old" sign="-" color={DELETE_LINE_COLOR} fallback={REMOVED_ROW_FALLBACK} />;
}

/** One record of an UPDATE. A record with one side missing says which, matching the CSV Description (#592 D12). */
function UpdateRecordBlock({ record, showPrimaryKey }: { record: ChangelogRecord; showPrimaryKey: boolean }) {
  const diffs = useMemo(() => {
    if (record.oldState !== null && record.newState !== null) return computeDiff(record.oldState, record.newState);
    const recordedImage = record.oldState ?? record.newState;
    if (recordedImage === null) return [];
    return recordedFieldNames(recordedImage).map(field => ({ field, oldValue: record.oldState?.[field], newValue: record.newState?.[field] }));
  }, [record.oldState, record.newState]);
  const missingSideCaption = record.oldState === null ? PRIOR_VALUES_NOT_RECORDED_CAPTION : record.newState === null ? NEW_VALUES_NOT_RECORDED_CAPTION : null;
  const recordedImage = record.oldState === null ? record.newState : record.oldState;
  const hasNoRecordedField = missingSideCaption !== null && (recordedImage === null || recordedFieldNames(recordedImage).length === 0);

  return (
    <Stack spacing={0.5}>
      {showPrimaryKey && (
        <Typography level="body-xs" sx={{ fontFamily: 'monospace', color: 'neutral.400' }}>
          {record.primaryKey}
        </Typography>
      )}
      {missingSideCaption && (
        <Typography level="body-xs" sx={{ color: 'warning.300' }}>
          {missingSideCaption}
        </Typography>
      )}
      {hasNoRecordedField ? (
        <Typography level="body-sm" sx={{ color: 'neutral.500', fontStyle: 'italic' }}>
          {NO_FIELD_VALUES_RECORDED_TEXT}
        </Typography>
      ) : (
        <DiffBlock diffs={diffs} />
      )}
    </Stack>
  );
}

function CardHeader({ entry }: { entry: ChangelogEntry }) {
  const time = formatRelativeTime(entry.changeTimestamp);

  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip size="sm" variant="soft" color={OPERATION_COLORS[entry.operation]}>
          {entry.operation}
        </Chip>
        <Typography level="title-sm">{summarizeChange(entry)}</Typography>
        <Typography level="body-xs" sx={{ color: 'neutral.500' }}>
          {entry.tableName}
        </Typography>
        <Typography level="body-xs" sx={{ color: 'neutral.500', fontFamily: 'monospace' }}>
          #{entry.changeID}
        </Typography>
      </Stack>
      <Typography level="body-xs" sx={{ color: 'neutral.500' }} title={time.full}>
        {displayName(entry.changedBy)} · {time.relative}
      </Typography>
    </Stack>
  );
}

/** NewRowState here is a summary object, not a row snapshot (see projectBulkRevisionRow); render counts directly, never a diff. */
function BulkRevisionSummaryCard({ entry }: { entry: ChangelogEntry }) {
  const summary = entry.newRowState ?? {};
  const updatedCount = typeof summary.updatedCount === 'number' ? summary.updatedCount : 0;
  const skippedCount = typeof summary.skippedCount === 'number' ? summary.skippedCount : 0;
  const insertedCount = typeof summary.insertedCount === 'number' ? summary.insertedCount : 0;
  const deletedDuplicateCount = typeof summary.deletedDuplicateCount === 'number' ? summary.deletedDuplicateCount : 0;
  // Older summaries predate failedRowCount; only render it when the field is actually present, never default it to 0.
  const failedRowCount = typeof summary.failedRowCount === 'number' ? summary.failedRowCount : null;
  const failedRowCountSuffix = failedRowCount === null ? '' : `, ${failedRowCount} failed`;
  const summaryText = `Bulk revision applied: ${updatedCount} updated, ${skippedCount} skipped, ${insertedCount} inserted, ${deletedDuplicateCount} duplicate(s) removed${failedRowCountSuffix}`;

  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'primary.500' }}>
      <Stack spacing={1.25}>
        <CardHeader entry={entry} />
        <Box sx={{ backgroundColor: 'neutral.900', borderRadius: '6px', p: 1.5, fontFamily: 'monospace', fontSize: '12px' }}>
          <Typography sx={{ color: 'neutral.400', fontFamily: 'inherit', fontSize: 'inherit' }}>{summaryText}</Typography>
        </Box>
      </Stack>
    </Sheet>
  );
}

function UpdateCard({ entry }: { entry: ChangelogEntry }) {
  // computeDiff must never run against a summary object (see BulkRevisionSummaryCard).
  if (entry.newRowState?.summaryKind === BULK_REVISION_SUMMARY_KIND) {
    return <BulkRevisionSummaryCard entry={entry} />;
  }

  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'primary.500' }}>
      <Stack spacing={1.25}>
        <CardHeader entry={entry} />
        {hasNoRowImage(entry) && <RowImagesNotRecorded />}
        {entry.records.length === 0 && !hasNoRowImage(entry) && <DiffBlock diffs={[]} />}
        {entry.records.map((record, index) => (
          <UpdateRecordBlock key={`${entry.changeID}-${index}`} record={record} showPrimaryKey={entry.records.length > 1} />
        ))}
      </Stack>
    </Sheet>
  );
}

function SingleInsertCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <Sheet variant="outlined" sx={{ p: 1.75, borderRadius: 'md', borderLeft: '3px solid', borderLeftColor: 'success.500' }}>
      <Stack spacing={1.25}>
        <CardHeader entry={entry} />
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
            <Typography sx={{ color: 'text.tertiary' }}>·</Typography>
            <Typography level="body-sm" sx={{ color: 'success.400', fontWeight: 500 }}>
              {batch.count} rows uploaded
            </Typography>
          </Stack>
          <Typography level="body-xs" sx={{ color: 'neutral.500' }} title={formatRelativeTime(batch.timestamp).full}>
            {displayName(batch.changedBy)} · {formatRelativeTime(batch.timestamp).relative}
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
          <Box sx={RECORD_PANEL_SX}>
            {batch.entries.flatMap(entry => {
              const lines =
                entry.records.length === 0
                  ? [`#${entry.changeID} — ${ROW_IMAGES_NOT_RECORDED_LINE}`]
                  : entry.records.map(record => `#${entry.changeID} + ${keyFieldsLine(batch.tableName, record.newState) || NEW_ROW_FALLBACK}`);
              return lines.map((line, index) => (
                <Typography key={`${entry.changeID}-${index}`} sx={{ color: INSERT_LINE_COLOR, fontFamily: 'inherit', fontSize: 'inherit', mb: 0.5 }}>
                  {line}
                </Typography>
              ));
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
        <CardHeader entry={entry} />
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

const DATE_RANGE_INVERTED_MESSAGE = 'From must be on or before To.';
const EARLIEST_FILTER_DATE = `${EARLIEST_FILTER_DATE_YEAR}-01-01`;
const LATEST_FILTER_DATE = `${LATEST_FILTER_DATE_YEAR}-12-31`;
const UNFILTERABLE_DATE_MESSAGE = `Enter a date between ${EARLIEST_FILTER_DATE} and ${LATEST_FILTER_DATE}.`;
const CHANGED_FROM_CONTROL_ID = 'changes-explorer-changed-from';
const CHANGED_TO_CONTROL_ID = 'changes-explorer-changed-to';
const CHANGED_FROM_HELPER_TEXT_ID = `${CHANGED_FROM_CONTROL_ID}-helper-text`;
const DATE_RANGE_HELPER_TEXT_ID = `${CHANGED_TO_CONTROL_ID}-helper-text`;
const CHANGED_FROM_LABEL = `From (${CHANGE_DATE_ZONE_LABEL})`;
const CHANGED_TO_LABEL = `To (${CHANGE_DATE_ZONE_LABEL})`;
const EXPORT_BUTTON_LABEL = 'Export CSV';
const EXPORTING_INDICATOR_LABEL = 'Exporting change log';

function scopeKey(schemaName: string, plotID: number): string {
  return `${schemaName}:${plotID}`;
}

function isUnfilterableDateBound(value: string): boolean {
  return value !== NO_DATE_BOUND && !isFilterableDate(value);
}

export default function RecentChangesExplorer() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const facetsAbortRef = useRef<AbortController | null>(null);
  const itemsAbortRef = useRef<AbortController | null>(null);
  const facetsRequestRef = useRef(0);
  const itemsRequestRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportRequestRef = useRef(0);
  const loadedScopeRef = useRef<string | null>(null);

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
  const [exporting, setExporting] = useState(false);
  // Kept apart from errorMessage: a list refresh clears that one, and must not wipe an export failure.
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  const updateFilters = useCallback((updater: (prev: RecentChangesFilters) => RecentChangesFilters) => {
    setFilters(prev => updater(prev));
    setPage(0);
  }, []);

  const handlePresetClick = useCallback((presetId: string) => {
    const preset = RECENT_CHANGES_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    // A preset says nothing about dates, so the date range carries over (#592 D9).
    setFilters(prev => ({ ...preset.filters, changedFrom: prev.changedFrom, changedTo: prev.changedTo, presetId }));
    setPage(0);
  }, []);

  const fetchFacets = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID) return;
    facetsAbortRef.current?.abort();
    const controller = new AbortController();
    facetsAbortRef.current = controller;
    const requestID = ++facetsRequestRef.current;
    setLoadingFacets(true);
    try {
      const response = await fetch('/api/changes/explorer/facets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: currentSite.schemaName, plotID: currentPlot.plotID }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Facets request failed: ${response.status}`);
      const data: RecentChangesFacetsResponse = await response.json();
      if (facetsRequestRef.current !== requestID || controller.signal.aborted) return;
      setFacets(data);
    } catch (error) {
      if (isAbortError(error)) return;
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
    } finally {
      if (facetsRequestRef.current === requestID) {
        setLoadingFacets(false);
        if (facetsAbortRef.current === controller) {
          facetsAbortRef.current = null;
        }
      }
    }
  }, [currentSite?.schemaName, currentPlot?.plotID]);

  const changedFromUnfilterable = isUnfilterableDateBound(filters.changedFrom);
  const changedToUnfilterable = isUnfilterableDateBound(filters.changedTo);
  const dateRangeInverted = !changedFromUnfilterable && !changedToUnfilterable && isDateRangeInverted(filters.changedFrom, filters.changedTo);
  const dateFiltersUnsendable = changedFromUnfilterable || changedToUnfilterable || dateRangeInverted;

  const fetchItems = useCallback(
    async (pageNum: number, append: boolean) => {
      if (!currentSite?.schemaName || !currentPlot?.plotID) return;
      itemsAbortRef.current?.abort();
      const requestedScope = scopeKey(currentSite.schemaName, currentPlot.plotID);
      if (dateFiltersUnsendable) {
        if (loadedScopeRef.current !== null && loadedScopeRef.current !== requestedScope) {
          loadedScopeRef.current = null;
          setItems([]);
          setSummary(DEFAULT_SUMMARY);
          setHasMore(false);
          setErrorMessage(null);
          setLoading(false);
          setLoadingMore(false);
        }
        return;
      }
      const controller = new AbortController();
      itemsAbortRef.current = controller;
      const requestID = ++itemsRequestRef.current;
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
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Query request failed: ${response.status}`);
        const data: RecentChangesQueryResponse = await response.json();
        if (itemsRequestRef.current !== requestID || controller.signal.aborted) return;

        if (append) {
          setItems(prev => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }
        setSummary(data.summary);
        setHasMore(data.hasMore);
        loadedScopeRef.current = requestedScope;
      } catch (error) {
        if (isAbortError(error)) return;
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMessage(msg);
      } finally {
        if (itemsRequestRef.current === requestID) {
          setLoading(false);
          setLoadingMore(false);
          if (itemsAbortRef.current === controller) {
            itemsAbortRef.current = null;
          }
        }
      }
    },
    [currentSite?.schemaName, currentPlot?.plotID, filters, dateFiltersUnsendable]
  );

  const handleExport = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || dateFiltersUnsendable) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    const requestID = ++exportRequestRef.current;
    setExporting(true);
    setExportErrorMessage(null);
    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;

    try {
      const { blob, filename } = await postRecentChangesExport({ schema: currentSite.schemaName, plotID: currentPlot.plotID }, filters, controller.signal);
      if (exportRequestRef.current !== requestID || controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error: unknown) {
      if (isAbortError(error) || exportRequestRef.current !== requestID) return;
      setExportErrorMessage(error instanceof ChangeExportRequestError ? changeExportFailureMessage(error) : CHANGE_EXPORT_FAILURE_MESSAGES.generic);
    } finally {
      anchor?.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (exportRequestRef.current === requestID) {
        setExporting(false);
        if (exportAbortRef.current === controller) {
          exportAbortRef.current = null;
        }
      }
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, filters, dateFiltersUnsendable]);

  // An export belongs to the site and plot it was started for: leaving them, or the page, discards it.
  // The abort only drops the client's result; the server finishes its read.
  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      exportRequestRef.current += 1;
      setExporting(false);
      setExportErrorMessage(null);
    };
  }, [currentSite?.schemaName, currentPlot?.plotID]);

  useEffect(() => {
    return () => {
      facetsAbortRef.current?.abort();
      itemsAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetchFacets();
  }, [fetchFacets]);

  useEffect(() => {
    setPage(0);
    fetchItems(0, false);
  }, [fetchItems]);

  const handleLoadMore = useCallback(() => {
    if (loading || loadingMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchItems(nextPage, true);
  }, [page, fetchItems, loading, loadingMore]);

  if (!currentSite?.schemaName || !currentPlot?.plotID) {
    return (
      <Stack spacing={2} sx={{ width: '100%' }}>
        <Alert color="warning">Please select a site and plot to view recent changes.</Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Stack spacing={1}>
        <Typography level="body-sm">Review all changes made to data within this plot, filter by operation type, user, or table.</Typography>
      </Stack>

      {errorMessage && (
        <Alert color="danger" startDecorator={<ReportProblemOutlinedIcon />}>
          {errorMessage}
        </Alert>
      )}

      {exportErrorMessage && (
        <Alert color="danger" startDecorator={<ReportProblemOutlinedIcon />} data-testid="recent-changes-export-alert">
          {exportErrorMessage}
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
                slotProps={{ input: { maxLength: CHANGE_QUICK_SEARCH_MAX_LENGTH } }}
                value={filters.quickSearch}
                onChange={event => updateFilters(prev => ({ ...prev, quickSearch: event.target.value, presetId: undefined }))}
                placeholder="Search records, tags, users..."
              />
            </FormControl>
          </Stack>

          {/* Date range */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'flex-start' } }}>
            <FormControl id={CHANGED_FROM_CONTROL_ID} sx={{ minWidth: 190 }} error={changedFromUnfilterable || dateRangeInverted}>
              <FormLabel htmlFor={CHANGED_FROM_CONTROL_ID}>{CHANGED_FROM_LABEL}</FormLabel>
              <Input
                id={CHANGED_FROM_CONTROL_ID}
                type="date"
                aria-label={CHANGED_FROM_LABEL}
                value={filters.changedFrom}
                slotProps={{
                  input: {
                    min: EARLIEST_FILTER_DATE,
                    max: LATEST_FILTER_DATE,
                    'aria-invalid': changedFromUnfilterable || dateRangeInverted,
                    'aria-describedby': changedFromUnfilterable ? CHANGED_FROM_HELPER_TEXT_ID : dateRangeInverted ? DATE_RANGE_HELPER_TEXT_ID : undefined
                  }
                }}
                onChange={event => updateFilters(prev => ({ ...prev, changedFrom: event.target.value }))}
              />
              {changedFromUnfilterable && <FormHelperText>{UNFILTERABLE_DATE_MESSAGE}</FormHelperText>}
            </FormControl>

            <FormControl id={CHANGED_TO_CONTROL_ID} sx={{ minWidth: 190 }} error={changedToUnfilterable || dateRangeInverted}>
              <FormLabel htmlFor={CHANGED_TO_CONTROL_ID}>{CHANGED_TO_LABEL}</FormLabel>
              <Input
                id={CHANGED_TO_CONTROL_ID}
                type="date"
                aria-label={CHANGED_TO_LABEL}
                value={filters.changedTo}
                slotProps={{ input: { min: EARLIEST_FILTER_DATE, max: LATEST_FILTER_DATE, 'aria-invalid': changedToUnfilterable || dateRangeInverted } }}
                onChange={event => updateFilters(prev => ({ ...prev, changedTo: event.target.value }))}
              />
              {changedToUnfilterable && <FormHelperText>{UNFILTERABLE_DATE_MESSAGE}</FormHelperText>}
              {dateRangeInverted && <FormHelperText>{DATE_RANGE_INVERTED_MESSAGE}</FormHelperText>}
            </FormControl>

            <Button
              variant="outlined"
              color="neutral"
              startDecorator={<FileDownloadOutlinedIcon />}
              onClick={handleExport}
              loading={exporting}
              loadingIndicator={<CircularProgress color="neutral" thickness={3} aria-label={EXPORTING_INDICATOR_LABEL} />}
              aria-busy={exporting}
              disabled={dateFiltersUnsendable}
              sx={{ alignSelf: { xs: 'flex-start', md: 'flex-end' } }}
            >
              {EXPORT_BUTTON_LABEL}
            </Button>
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
