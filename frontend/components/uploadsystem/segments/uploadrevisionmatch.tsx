'use client';

import React, { useState } from 'react';
import { Alert, Button, Chip, Sheet, Stack, Tab, TabList, TabPanel, Table, Tabs, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { RevisionCollapsedRow, RevisionInvalidRow, RevisionMatchCounts, RevisionMatchedRow, RevisionNewRowCandidate } from '@/config/revisionuploadtypes';
import { BulkEditPlan } from '@/config/editplan/types';
import ImpactSummary from '@/components/editplan/impactsummary';

interface UploadRevisionMatchProps {
  matchedRows: RevisionMatchedRow[];
  newRows: RevisionNewRowCandidate[];
  invalidRows: RevisionInvalidRow[];
  /** Rows collapsed into an earlier same-key row that differed only beyond stored DECIMAL(12,6) precision. See RevisionCollapsedRow. */
  collapsedRows?: RevisionCollapsedRow[];
  counts: RevisionMatchCounts;
  bulkPlan?: BulkEditPlan;
  schema: string;
  plotID: number;
  censusID: number;
  // Pre-flight role warning surfaced by uploadparent at parse time when the
  // CSV contains role-restricted columns (currently spcode for non-admins).
  // null when no warning applies.
  preflightWarning?: string | null;
  setReviewState: (state: ReviewStates) => void;
  onApply: (confirmNewRows: boolean) => void;
  handleReturnToStart: () => Promise<void>;
  /**
   * Re-runs match for the SAME uploaded file (e.g. DB state may have
   * changed since review started), retaining the current uploadAttemptID
   * rather than starting a new upload. Optional: omitted entirely when the
   * caller has nothing to refresh against.
   */
  onRefreshMatch?: () => void;
}

const NEW_ROW_DISPLAY_FIELDS = ['tag', 'stemtag', 'spcode', 'quadrat', 'dbh', 'date'] as const;

const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['spcode', 'tag', 'stemtag', 'quadrat', 'lx', 'ly', 'px', 'py']);

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function isIdentityField(field: string): boolean {
  return IDENTITY_FIELDS.has(field);
}

function hasIdentityChanges(row: RevisionMatchedRow): boolean {
  return Object.keys(row.changes).some(isIdentityField);
}

function formatRowIdentifier(csvRow: RevisionMatchedRow['csvRow'] | RevisionInvalidRow['csvRow']): string {
  const stemID = formatValue(csvRow['stemid']);
  if (stemID !== '—') {
    return stemID;
  }

  const tag = normalizeNullableDisplayValue(csvRow['tag']);
  const stemtag = normalizeNullableDisplayValue(csvRow['stemtag']);
  if (tag && stemtag) {
    return `${tag} / ${stemtag}`;
  }

  return '—';
}

function normalizeNullableDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function hasDuplicateCleanup(row: RevisionMatchedRow): boolean {
  return (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0;
}

export type RevisionTabValue = 'changes' | 'duplicates' | 'new' | 'invalid' | 'collapsed' | 'unchanged';

export interface RevisionRowCounts {
  changes: number;
  duplicates: number;
  newRows: number;
  invalid: number;
  collapsed: number;
  unchanged: number;
}

/**
 * Selects the tab to open the revision review on. Every tab except 'changes' is
 * conditionally rendered (its Tab/TabPanel only exist when that count is > 0), so this
 * must only ever return a tab whose panel actually exists — otherwise MUI Joy's Tabs
 * (uncontrolled, defaultValue read once at mount) locks onto a tab with no visible
 * content and the review screen looks empty. 'changes' renders unconditionally and is
 * therefore the only safe choice for the genuine all-empty case.
 */
export function resolveDefaultTabValue(counts: RevisionRowCounts): RevisionTabValue {
  if (counts.changes > 0) return 'changes';
  if (counts.duplicates > 0) return 'duplicates';
  if (counts.newRows > 0) return 'new';
  if (counts.invalid > 0) return 'invalid';
  if (counts.collapsed > 0) return 'collapsed';
  if (counts.unchanged > 0) return 'unchanged';
  return 'changes';
}

const REVIEW_AND_APPLY_LABEL = 'Review and apply…';
const NEW_ROWS_TAB_EXPLANATION =
  'These rows did not match an existing measurement in the active census and will be inserted as new measurements if you include them when applying.';

export default function UploadRevisionMatch(props: Readonly<UploadRevisionMatchProps>) {
  const { matchedRows, newRows, invalidRows, collapsedRows = [], counts, bulkPlan, preflightWarning, onApply, handleReturnToStart, onRefreshMatch } = props;

  const [includeNewRows, setIncludeNewRows] = useState(false);
  const [impactSummaryOpen, setImpactSummaryOpen] = useState(false);

  const openImpactSummary = () => {
    setIncludeNewRows(false);
    setImpactSummaryOpen(true);
  };

  const rowsWithChanges = matchedRows.filter(r => Object.keys(r.changes).length > 0);
  const rowsWithDuplicateCleanupOnly = matchedRows.filter(r => Object.keys(r.changes).length === 0 && hasDuplicateCleanup(r));
  const rowsNoChanges = matchedRows.filter(r => Object.keys(r.changes).length === 0 && !hasDuplicateCleanup(r));
  const rowsWithIdentityChanges = rowsWithChanges.filter(hasIdentityChanges);
  const stemIdNotFoundCount = newRows.filter(r => r.reason === 'stemid-not-found').length;
  const actionableMatchedRowCount = rowsWithChanges.length + rowsWithDuplicateCleanupOnly.length;

  // Split blocking errors by kind so the banner can describe the actual
  // reason instead of always claiming a species-role block. The previous
  // version showed "species-code changes that require a global or db admin
  // role" any time canApply was false — which fired for completely unrelated
  // failures (TreeStemResolution: missing quadrat, inactive tree, etc.) and
  // misled global users into thinking the role check was wrong.
  const blockingErrors = (bulkPlan?.errors ?? []).filter(error => error.blocking);
  const roleBlockingErrors = blockingErrors.filter(error => error.kind === 'RoleForbiddenField');
  const otherBlockingErrors = blockingErrors.filter(error => error.kind !== 'RoleForbiddenField');
  const planBlocked = bulkPlan?.canApply === false || blockingErrors.length > 0;
  // An invalid-only (or duplicate-only) upload must still be able to Apply:
  // invalidRows are persisted as StemGUID=NULL failed-measurement rows during
  // apply (see app/api/revisionupload/apply/route.ts), so a file consisting
  // entirely of rejected rows needs a path to record that, not a disabled
  // button that silently drops them. rowsWithDuplicateCleanupOnly already
  // counts toward actionableMatchedRowCount.
  const hasRowsToApply = actionableMatchedRowCount > 0 || newRows.length > 0 || invalidRows.length > 0;
  // Without a plan there is no dialog to opt new rows in, so they are never inserted.
  const canApplyWithoutPlan = actionableMatchedRowCount > 0 || invalidRows.length > 0;
  const canApply = !planBlocked && (bulkPlan ? hasRowsToApply : canApplyWithoutPlan);
  const selectedRowCount = actionableMatchedRowCount + (includeNewRows ? newRows.length : 0) + invalidRows.length;
  const applyButtonLabel = bulkPlan
    ? REVIEW_AND_APPLY_LABEL
    : actionableMatchedRowCount > 0
      ? `Apply ${actionableMatchedRowCount} Revisions`
      : invalidRows.length > 0
        ? `Record ${invalidRows.length} Invalid Row${invalidRows.length === 1 ? '' : 's'}`
        : 'Apply 0 Revisions';
  const defaultTabValue = resolveDefaultTabValue({
    changes: rowsWithChanges.length,
    duplicates: rowsWithDuplicateCleanupOnly.length,
    newRows: newRows.length,
    invalid: invalidRows.length,
    collapsed: collapsedRows.length,
    unchanged: rowsNoChanges.length
  });

  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <Typography level="h3">Revision Upload Review</Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {rowsWithChanges.length > 0 && (
          <Chip color="success" variant="soft" size="lg">
            {rowsWithChanges.length} rows to update
          </Chip>
        )}
        {rowsWithDuplicateCleanupOnly.length > 0 && (
          <Chip color="primary" variant="soft" size="lg">
            {rowsWithDuplicateCleanupOnly.length} rows to deduplicate
          </Chip>
        )}
        {rowsNoChanges.length > 0 && (
          <Chip color="neutral" variant="soft" size="lg">
            {rowsNoChanges.length} rows unchanged
          </Chip>
        )}
        {counts.new > 0 && (
          <Chip color="warning" variant="soft" size="lg">
            {counts.new} new rows
          </Chip>
        )}
        {counts.invalid > 0 && (
          <Chip color="danger" variant="soft" size="lg">
            {counts.invalid} invalid rows
          </Chip>
        )}
        {collapsedRows.length > 0 && (
          <Chip color="neutral" variant="soft" size="lg" data-testid="revision-collapsed-chip">
            {collapsedRows.length} {collapsedRows.length === 1 ? 'row' : 'rows'} collapsed (precision-only duplicate)
          </Chip>
        )}
        {rowsWithIdentityChanges.length > 0 && (
          <Chip color="warning" variant="soft" size="lg" data-testid="revision-identity-edit-chip">
            {rowsWithIdentityChanges.length} {rowsWithIdentityChanges.length === 1 ? 'row includes' : 'rows include'} identity edits
          </Chip>
        )}
      </Stack>

      {rowsWithIdentityChanges.length > 0 && (
        <Alert color="warning" variant="soft" data-testid="revision-identity-edit-alert">
          <Stack spacing={0.5}>
            <Typography level="body-sm" fontWeight="lg">
              {rowsWithIdentityChanges.length} {rowsWithIdentityChanges.length === 1 ? 'row edits' : 'rows edit'} identity columns (<code>spcode</code>,{' '}
              <code>tag</code>, <code>stemtag</code>, <code>quadrat</code>, <code>lx</code>, <code>ly</code>, <code>px</code>, <code>py</code>).
            </Typography>
            <Typography level="body-sm">
              These edits will be applied to the matched rows and may propagate to other measurements that share the same tree, stem, or quadrat. Review the
              impact preview before applying to see downstream effects.
            </Typography>
          </Stack>
        </Alert>
      )}

      {preflightWarning ? (
        <Alert color="warning" variant="soft" data-testid="revision-preflight-warning">
          {preflightWarning}
        </Alert>
      ) : null}

      {roleBlockingErrors.length > 0 ? (
        <Alert color="danger" variant="soft" data-testid="revision-role-blocked">
          This revision contains species-code changes that require a global or db admin role.
        </Alert>
      ) : null}

      {otherBlockingErrors.length > 0 ? (
        <Alert color="danger" variant="soft" data-testid="revision-blocking-errors">
          <Stack spacing={0.5}>
            <Typography level="body-sm" fontWeight="lg">
              {otherBlockingErrors.length === 1 ? 'A revision row cannot be applied:' : `${otherBlockingErrors.length} revision rows cannot be applied:`}
            </Typography>
            {otherBlockingErrors.slice(0, 5).map((error, index) => (
              <Typography key={`${error.kind}-${error.rowIndex ?? index}-${index}`} level="body-sm">
                {error.rowIndex !== undefined ? `Row ${error.rowIndex + 1}: ` : ''}
                {error.message}
              </Typography>
            ))}
            {otherBlockingErrors.length > 5 ? (
              <Typography level="body-sm" color="neutral">
                …and {otherBlockingErrors.length - 5} more.
              </Typography>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      <Tabs defaultValue={defaultTabValue}>
        <TabList>
          <Tab value="changes">Changes ({rowsWithChanges.length})</Tab>
          {rowsWithDuplicateCleanupOnly.length > 0 && <Tab value="duplicates">Duplicate Cleanup ({rowsWithDuplicateCleanupOnly.length})</Tab>}
          {newRows.length > 0 && <Tab value="new">New Rows ({newRows.length})</Tab>}
          {invalidRows.length > 0 && <Tab value="invalid">Invalid ({invalidRows.length})</Tab>}
          {collapsedRows.length > 0 && <Tab value="collapsed">Collapsed ({collapsedRows.length})</Tab>}
          {rowsNoChanges.length > 0 && <Tab value="unchanged">Unchanged ({rowsNoChanges.length})</Tab>}
        </TabList>

        <TabPanel value="changes">
          {rowsWithChanges.length === 0 ? (
            <Typography level="body-md" color="neutral" sx={{ py: 2 }}>
              No rows with changes were found.
            </Typography>
          ) : (
            <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
              <Table stickyHeader hoverRow size="sm">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Measurement ID</th>
                    <th style={{ width: 120 }}>Field</th>
                    <th>Current Value</th>
                    <th>New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithChanges.flatMap(row =>
                    Object.entries(row.changes).map(([field, diff]) => (
                      <tr key={`${row.coreMeasurementID}-${field}`}>
                        <td>{row.coreMeasurementID}</td>
                        <td>
                          {isIdentityField(field) ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography level="body-sm">{field}</Typography>
                              <Chip color="warning" variant="soft" size="sm">
                                identity
                              </Chip>
                            </Stack>
                          ) : (
                            field
                          )}
                        </td>
                        <td>{formatValue(diff.from)}</td>
                        <td>
                          <Typography color="success" level="body-sm" fontWeight="lg">
                            {formatValue(diff.to)}
                          </Typography>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Sheet>
          )}
        </TabPanel>

        {rowsWithDuplicateCleanupOnly.length > 0 && (
          <TabPanel value="duplicates">
            <Stack spacing={2}>
              <Typography level="body-md" color="neutral">
                These matched rows keep their existing field values but will remove duplicate measurements from the same stem during apply.
              </Typography>
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
                <Table stickyHeader hoverRow size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: 180 }}>Survivor Measurement ID</th>
                      <th>Duplicate Measurement IDs To Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithDuplicateCleanupOnly.map(row => (
                      <tr key={row.coreMeasurementID}>
                        <td>{row.coreMeasurementID}</td>
                        <td>{(row.duplicateMeasurementIDsToDelete ?? []).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
            </Stack>
          </TabPanel>
        )}

        {newRows.length > 0 && (
          <TabPanel value="new">
            <Stack spacing={2}>
              <Typography level="body-md">{NEW_ROWS_TAB_EXPLANATION}</Typography>
              {stemIdNotFoundCount > 0 && (
                <Alert color="warning" variant="soft">
                  <Stack spacing={0.5}>
                    <Typography level="body-sm" fontWeight="lg">
                      {stemIdNotFoundCount} {stemIdNotFoundCount === 1 ? 'row' : 'rows'} supplied a stemid that was not found in this census.
                    </Typography>
                    <Typography level="body-sm">
                      Those rows will create brand new trees/stems through the standard ingestion pipeline — the supplied stemid will be ignored on insert. If
                      that is not what you intended, cancel and correct the stemid (or remove it to add the row by tag/stemtag).
                    </Typography>
                  </Stack>
                </Alert>
              )}
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
                <Table stickyHeader hoverRow size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Row #</th>
                      <th style={{ width: 180 }}>Why new?</th>
                      {NEW_ROW_DISPLAY_FIELDS.map(field => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {newRows.map(row => (
                      <tr key={row.csvIndex}>
                        <td>{row.csvIndex + 1}</td>
                        <td>
                          {row.reason === 'stemid-not-found' ? (
                            <Chip color="warning" variant="soft" size="sm">
                              stemid {formatValue(row.csvRow['stemid'])} not found
                            </Chip>
                          ) : (
                            <Chip color="neutral" variant="soft" size="sm">
                              no match in census
                            </Chip>
                          )}
                        </td>
                        {NEW_ROW_DISPLAY_FIELDS.map(field => (
                          <td key={field}>{formatValue(row.csvRow[field])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
            </Stack>
          </TabPanel>
        )}

        {invalidRows.length > 0 && (
          <TabPanel value="invalid">
            <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
              <Table stickyHeader hoverRow size="sm">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Row #</th>
                    <th style={{ width: 160 }}>Stem Match Key</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidRows.map(row => (
                    <tr key={row.csvIndex}>
                      <td>{row.csvIndex + 1}</td>
                      <td>{formatRowIdentifier(row.csvRow)}</td>
                      <td>
                        <Typography color="danger" level="body-sm">
                          {row.reason}
                        </Typography>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Sheet>
          </TabPanel>
        )}

        {collapsedRows.length > 0 && (
          <TabPanel value="collapsed">
            <Stack spacing={2}>
              <Typography level="body-md" color="neutral">
                These rows match an earlier row in this upload at the stored measurement precision. The earlier row is kept; see which row below.
              </Typography>
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
                <Table stickyHeader hoverRow size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Row #</th>
                      <th style={{ width: 160 }}>Stem Match Key</th>
                      <th style={{ width: 100 }}>Collapsed Into Row #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collapsedRows.map(row => (
                      <tr key={row.csvIndex}>
                        <td>{row.csvIndex + 1}</td>
                        <td>{formatRowIdentifier(row.csvRow)}</td>
                        <td>{row.collapsedIntoCsvIndex + 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
            </Stack>
          </TabPanel>
        )}

        {rowsNoChanges.length > 0 && (
          <TabPanel value="unchanged">
            <Typography level="body-md" color="neutral" sx={{ py: 2 }}>
              {rowsNoChanges.length} matched {rowsNoChanges.length === 1 ? 'row' : 'rows'} had no field differences and will be skipped during apply.
            </Typography>
          </TabPanel>
        )}
      </Tabs>

      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button variant="outlined" color="neutral" onClick={handleReturnToStart}>
          Cancel
        </Button>
        {onRefreshMatch ? (
          <Button variant="outlined" color="neutral" onClick={onRefreshMatch} data-testid="revision-match-refresh">
            Refresh Matches
          </Button>
        ) : null}
        <Button
          variant="solid"
          color="primary"
          disabled={!canApply}
          onClick={() => (bulkPlan ? openImpactSummary() : onApply(false))}
          data-testid="revision-match-apply"
        >
          {applyButtonLabel}
        </Button>
      </Stack>

      {bulkPlan && impactSummaryOpen ? (
        <ImpactSummary
          bulkPlan={bulkPlan}
          selectedRowCount={selectedRowCount}
          newRowCount={newRows.length}
          includeNewRows={includeNewRows}
          onIncludeNewRowsChange={setIncludeNewRows}
          onConfirm={async () => {
            setImpactSummaryOpen(false);
            onApply(includeNewRows);
          }}
          onCancel={() => setImpactSummaryOpen(false)}
          busy={false}
        />
      ) : null}
    </Stack>
  );
}
