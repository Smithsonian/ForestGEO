'use client';

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Sheet, Stack, Tab, TabList, TabPanel, Table, Tabs, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { RevisionInvalidRow, RevisionMatchCounts, RevisionMatchedRow, RevisionNewRowCandidate } from '@/config/revisionuploadtypes';

interface UploadRevisionMatchProps {
  matchedRows: RevisionMatchedRow[];
  newRows: RevisionNewRowCandidate[];
  invalidRows: RevisionInvalidRow[];
  counts: RevisionMatchCounts;
  schema: string;
  plotID: number;
  censusID: number;
  setReviewState: (state: ReviewStates) => void;
  onApply: (confirmNewRows: boolean) => void;
  handleReturnToStart: () => Promise<void>;
}

const NEW_ROW_DISPLAY_FIELDS = ['tag', 'stemtag', 'spcode', 'quadrat', 'dbh', 'date'] as const;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
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

function hasIgnoredEdits(row: RevisionMatchedRow): boolean {
  return row.ignoredEdits !== undefined && Object.keys(row.ignoredEdits).length > 0;
}

export default function UploadRevisionMatch(props: Readonly<UploadRevisionMatchProps>) {
  const { matchedRows, newRows, invalidRows, counts, onApply, handleReturnToStart } = props;

  const [confirmNewRows, setConfirmNewRows] = useState(false);

  const rowsWithChanges = matchedRows.filter(r => Object.keys(r.changes).length > 0);
  const rowsWithDuplicateCleanupOnly = matchedRows.filter(r => Object.keys(r.changes).length === 0 && hasDuplicateCleanup(r));
  const rowsNoChanges = matchedRows.filter(r => Object.keys(r.changes).length === 0 && !hasDuplicateCleanup(r) && !hasIgnoredEdits(r));
  const rowsWithIgnoredEdits = matchedRows.filter(r => hasIgnoredEdits(r));
  const stemIdNotFoundCount = newRows.filter(r => r.reason === 'stemid-not-found').length;
  const actionableMatchedRowCount = rowsWithChanges.length + rowsWithDuplicateCleanupOnly.length;
  const canApply = actionableMatchedRowCount > 0 || (confirmNewRows && newRows.length > 0);
  const defaultTabValue = rowsWithChanges.length > 0 ? 'changes' : rowsWithDuplicateCleanupOnly.length > 0 ? 'duplicates' : 'changes';

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
        {rowsWithIgnoredEdits.length > 0 && (
          <Chip color="warning" variant="soft" size="lg">
            {rowsWithIgnoredEdits.length} {rowsWithIgnoredEdits.length === 1 ? 'row' : 'rows'} with ignored edits
          </Chip>
        )}
      </Stack>

      {rowsWithIgnoredEdits.length > 0 && (
        <Alert color="warning" variant="soft">
          <Stack spacing={0.5}>
            <Typography level="body-sm" fontWeight="lg">
              {rowsWithIgnoredEdits.length} {rowsWithIgnoredEdits.length === 1 ? 'row has' : 'rows have'} edits on columns that revision upload cannot update in
              this phase.
            </Typography>
            <Typography level="body-sm">
              Fields like <code>spcode</code>, <code>quadrat</code>, <code>lx</code>, <code>ly</code>, <code>tag</code>, and <code>stemtag</code> are used for
              matching but are not written back. See the &ldquo;Ignored Edits&rdquo; tab for details. If you need to change these values, use the appropriate
              upload type (species, quadrats, stems) or the data grid editor instead.
            </Typography>
          </Stack>
        </Alert>
      )}

      <Tabs defaultValue={defaultTabValue}>
        <TabList>
          <Tab value="changes">Changes ({rowsWithChanges.length})</Tab>
          {rowsWithDuplicateCleanupOnly.length > 0 && <Tab value="duplicates">Duplicate Cleanup ({rowsWithDuplicateCleanupOnly.length})</Tab>}
          {newRows.length > 0 && <Tab value="new">New Rows ({newRows.length})</Tab>}
          {invalidRows.length > 0 && <Tab value="invalid">Invalid ({invalidRows.length})</Tab>}
          {rowsWithIgnoredEdits.length > 0 && <Tab value="ignored">Ignored Edits ({rowsWithIgnoredEdits.length})</Tab>}
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
                        <td>{field}</td>
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography level="body-md">
                  These rows did not match an existing measurement in the active census and will be inserted as new measurements if confirmed.
                </Typography>
                <Button
                  size="sm"
                  variant={confirmNewRows ? 'solid' : 'outlined'}
                  color={confirmNewRows ? 'success' : 'neutral'}
                  onClick={() => setConfirmNewRows(prev => !prev)}
                >
                  {confirmNewRows ? 'New rows confirmed' : 'Confirm new row insertion'}
                </Button>
              </Box>
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

        {rowsWithIgnoredEdits.length > 0 && (
          <TabPanel value="ignored">
            <Stack spacing={2}>
              <Typography level="body-md" color="neutral">
                These rows had edits on columns that revision upload does not write back. The edits will not be applied.
              </Typography>
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
                <Table stickyHeader hoverRow size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Measurement ID</th>
                      <th style={{ width: 120 }}>Field</th>
                      <th>Current Value (DB)</th>
                      <th>Ignored Edit (CSV)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithIgnoredEdits.flatMap(row =>
                      Object.entries(row.ignoredEdits ?? {}).map(([field, diff]) => (
                        <tr key={`${row.coreMeasurementID}-ignored-${field}`}>
                          <td>{row.coreMeasurementID}</td>
                          <td>{field}</td>
                          <td>{formatValue(diff.from)}</td>
                          <td>
                            <Typography color="warning" level="body-sm" fontWeight="lg">
                              {formatValue(diff.to)}
                            </Typography>
                          </td>
                        </tr>
                      ))
                    )}
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
        <Button variant="solid" color="primary" disabled={!canApply} onClick={() => onApply(confirmNewRows)}>
          Apply {actionableMatchedRowCount + (confirmNewRows ? newRows.length : 0)} Revisions
        </Button>
      </Stack>
    </Stack>
  );
}
