'use client';

import React, { useState } from 'react';
import { Box, Button, Chip, Sheet, Stack, Tab, TabList, TabPanel, Table, Tabs, Typography } from '@mui/joy';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { FileRow } from '@/config/macros/formdetails';

interface MatchedRow {
  csvRow: FileRow;
  coreMeasurementID: number;
  existingValues: Record<string, unknown>;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface NewRow {
  csvRow: FileRow;
  csvIndex: number;
}

interface InvalidRow {
  csvRow: FileRow;
  csvIndex: number;
  reason: string;
}

interface RevisionMatchCounts {
  matched: number;
  matchedWithChanges: number;
  new: number;
  invalid: number;
  total: number;
}

interface UploadRevisionMatchProps {
  matchedRows: MatchedRow[];
  newRows: NewRow[];
  invalidRows: InvalidRow[];
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

export default function UploadRevisionMatch(props: Readonly<UploadRevisionMatchProps>) {
  const { matchedRows, newRows, invalidRows, counts, onApply, handleReturnToStart } = props;

  const [confirmNewRows, setConfirmNewRows] = useState(false);

  const rowsWithChanges = matchedRows.filter(r => Object.keys(r.changes).length > 0);
  const rowsNoChanges = matchedRows.filter(r => Object.keys(r.changes).length === 0);
  const canApply = rowsWithChanges.length > 0 || (confirmNewRows && newRows.length > 0);

  return (
    <Stack spacing={3} sx={{ p: 3 }}>
      <Typography level="h3">Revision Upload Review</Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {rowsWithChanges.length > 0 && (
          <Chip color="success" variant="soft" size="lg">
            {rowsWithChanges.length} rows to update
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
      </Stack>

      <Tabs defaultValue="changes">
        <TabList>
          <Tab value="changes">Changes ({rowsWithChanges.length})</Tab>
          {newRows.length > 0 && <Tab value="new">New Rows ({newRows.length})</Tab>}
          {invalidRows.length > 0 && <Tab value="invalid">Invalid ({invalidRows.length})</Tab>}
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

        {newRows.length > 0 && (
          <TabPanel value="new">
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography level="body-md">
                  These rows have no measurementID and will be inserted as new measurements if confirmed.
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
              <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto', maxHeight: 480 }}>
                <Table stickyHeader hoverRow size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Row #</th>
                      {NEW_ROW_DISPLAY_FIELDS.map(field => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {newRows.map(row => (
                      <tr key={row.csvIndex}>
                        <td>{row.csvIndex + 1}</td>
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
                    <th style={{ width: 140 }}>Measurement ID</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidRows.map(row => (
                    <tr key={row.csvIndex}>
                      <td>{row.csvIndex + 1}</td>
                      <td>{formatValue(row.csvRow['measurementID'])}</td>
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
          Apply {rowsWithChanges.length + (confirmNewRows ? newRows.length : 0)} Updates
        </Button>
      </Stack>
    </Stack>
  );
}
