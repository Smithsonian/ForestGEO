'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Stack, Table, Typography } from '@mui/joy';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import { CONTRADICTION_LABELS, CONTRADICTION_REASONS, type ErrorExplorerRow, type RelatedContradictionRow } from '@/config/errorsexplorer';

type ComparableRow = {
  coreMeasurementID: number;
  treeTag?: string | null;
  stemTag?: string | null;
  speciesCode?: string | null;
  quadratName?: string | null;
  measurementDate?: string | null;
  measuredDBH?: number | null;
  measuredHOM?: number | null;
  stemLocalX?: number | null;
  stemLocalY?: number | null;
  description?: string | null;
  primaryErrorMessage?: string | null;
  uploadFileID?: string | null;
  uploadBatchID?: string | null;
  errorCount?: number;
  errorMessages?: string[];
};

interface ComparisonFieldDefinition {
  key: keyof ComparableRow;
  label: string;
  showFor: 'all' | 'same_batch_conflict';
  format?: 'decimal';
}

const COMPARISON_FIELDS: ComparisonFieldDefinition[] = [
  { key: 'treeTag', label: 'Tree tag', showFor: 'all' },
  { key: 'stemTag', label: 'Stem tag', showFor: 'all' },
  { key: 'speciesCode', label: 'Species', showFor: 'all' },
  { key: 'quadratName', label: 'Quadrat', showFor: 'all' },
  { key: 'measurementDate', label: 'Date', showFor: 'all' },
  { key: 'stemLocalX', label: 'X', showFor: 'all', format: 'decimal' },
  { key: 'stemLocalY', label: 'Y', showFor: 'all', format: 'decimal' },
  { key: 'measuredDBH', label: 'DBH', showFor: 'all', format: 'decimal' },
  { key: 'measuredHOM', label: 'HOM', showFor: 'all', format: 'decimal' },
  { key: 'uploadBatchID', label: 'Upload batch', showFor: 'same_batch_conflict' }
];

function formatComparisonValue(value: ComparableRow[keyof ComparableRow], format?: ComparisonFieldDefinition['format']): string {
  if (value === null || value === undefined || value === '') {
    return 'No value';
  }
  if (format === 'decimal') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric.toFixed(2);
    }
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'No value';
  }
  return String(value);
}

function normalizeComparisonValue(value: ComparableRow[keyof ComparableRow]): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return value.toFixed(6);
  }
  if (Array.isArray(value)) {
    return value.join('|');
  }
  return String(value).trim();
}

function valuesDiffer(left: ComparableRow[keyof ComparableRow], right: ComparableRow[keyof ComparableRow]) {
  return normalizeComparisonValue(left) !== normalizeComparisonValue(right);
}

function buildIdentityLabel(row: ComparableRow) {
  const parts = [row.treeTag, row.stemTag].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : `Row ${row.coreMeasurementID}`;
}

function ComparisonSummaryCard({ title, row, color }: { title: string; row: ComparableRow; color: 'primary' | 'warning' }) {
  return (
    <Card size="sm" variant="soft" color={color} sx={{ flex: 1, minWidth: 0 }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography level="title-sm">{title}</Typography>
            <Typography level="body-sm" fontWeight="lg">
              {buildIdentityLabel(row)}
            </Typography>
          </Stack>
          <Chip size="sm" variant="solid" color={color}>
            ID {row.coreMeasurementID}
          </Chip>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {row.speciesCode && (
            <Chip size="sm" variant="soft">
              {row.speciesCode}
            </Chip>
          )}
          {row.quadratName && (
            <Chip size="sm" variant="soft">
              {row.quadratName}
            </Chip>
          )}
          {row.measurementDate && (
            <Chip size="sm" variant="soft">
              {row.measurementDate}
            </Chip>
          )}
          {typeof row.errorCount === 'number' && (
            <Chip size="sm" variant="soft">
              {row.errorCount} error{row.errorCount === 1 ? '' : 's'}
            </Chip>
          )}
        </Stack>

        <Typography level="body-sm" sx={{ minHeight: 40 }}>
          {row.primaryErrorMessage || row.description || 'No additional summary available.'}
        </Typography>
      </Stack>
    </Card>
  );
}

export default function ContradictionComparisonPanel({
  selectedRow,
  relatedRows,
  onInspectRow
}: {
  selectedRow: ErrorExplorerRow;
  relatedRows: RelatedContradictionRow[];
  onInspectRow: (measurementID: number) => void;
}) {
  const [comparisonMeasurementID, setComparisonMeasurementID] = useState<number | null>(null);

  useEffect(() => {
    if (relatedRows.length === 0) {
      setComparisonMeasurementID(null);
      return;
    }

    if (!comparisonMeasurementID || !relatedRows.some(row => row.coreMeasurementID === comparisonMeasurementID)) {
      setComparisonMeasurementID(relatedRows[0].coreMeasurementID);
    }
  }, [comparisonMeasurementID, relatedRows, selectedRow.coreMeasurementID]);

  const comparisonRow = useMemo(() => {
    if (relatedRows.length === 0) return null;
    return relatedRows.find(row => row.coreMeasurementID === comparisonMeasurementID) ?? relatedRows[0];
  }, [comparisonMeasurementID, relatedRows]);

  const selectedComparisonRow = useMemo<ComparableRow>(
    () => ({
      coreMeasurementID: Number(selectedRow.coreMeasurementID),
      treeTag: selectedRow.treeTag,
      stemTag: selectedRow.stemTag,
      speciesCode: selectedRow.speciesCode,
      quadratName: selectedRow.quadratName,
      measurementDate: selectedRow.measurementDate ?? null,
      measuredDBH: selectedRow.measuredDBH ?? null,
      measuredHOM: selectedRow.measuredHOM ?? null,
      stemLocalX: selectedRow.stemLocalX ?? null,
      stemLocalY: selectedRow.stemLocalY ?? null,
      description: selectedRow.description ?? null,
      primaryErrorMessage: selectedRow.primaryErrorMessage,
      uploadFileID: selectedRow.uploadFileID ?? null,
      uploadBatchID: selectedRow.uploadBatchID ?? null,
      errorCount: selectedRow.errorCount,
      errorMessages: selectedRow.errorMessages
    }),
    [selectedRow]
  );

  const activeContradictionType = selectedRow.contradictionType ?? selectedRow.contradictionTypes[0] ?? null;

  const visibleFields = useMemo(
    () => COMPARISON_FIELDS.filter(field => field.showFor === 'all' || activeContradictionType === field.showFor),
    [activeContradictionType]
  );

  if (!selectedRow.hasContradiction || !comparisonRow || !activeContradictionType) {
    return null;
  }

  return (
    <Stack spacing={1.25}>
      <Stack spacing={0.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography level="title-sm">Contradiction Comparison</Typography>
          <Chip size="sm" color="warning" startDecorator={<CallSplitIcon />}>
            {CONTRADICTION_LABELS[activeContradictionType]}
          </Chip>
        </Stack>
        <Typography level="body-sm">{CONTRADICTION_REASONS[activeContradictionType]}</Typography>
      </Stack>

      {relatedRows.length > 1 && (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {relatedRows.map(row => (
            <Chip
              key={row.coreMeasurementID}
              size="sm"
              variant={row.coreMeasurementID === comparisonRow.coreMeasurementID ? 'solid' : 'soft'}
              color={row.coreMeasurementID === comparisonRow.coreMeasurementID ? 'warning' : 'neutral'}
              role="button"
              tabIndex={0}
              onClick={() => setComparisonMeasurementID(row.coreMeasurementID)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setComparisonMeasurementID(row.coreMeasurementID);
                }
              }}
              sx={{ cursor: 'pointer' }}
            >
              {buildIdentityLabel(row)}
            </Chip>
          ))}
        </Stack>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <ComparisonSummaryCard title="Selected row" row={selectedComparisonRow} color="primary" />
        <ComparisonSummaryCard title="Linked row" row={comparisonRow} color="warning" />
      </Stack>

      <Table size="sm" variant="outlined" sx={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Field</th>
            <th style={{ width: '29%' }}>Selected row</th>
            <th style={{ width: '29%' }}>Linked row</th>
            <th style={{ width: '16%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleFields.map(field => {
            const different = valuesDiffer(selectedComparisonRow[field.key], comparisonRow[field.key]);
            return (
              <tr key={field.key} aria-label={`${field.label} comparison`} style={different ? { backgroundColor: 'rgba(217, 119, 6, 0.08)' } : undefined}>
                <td>
                  <Typography level="body-sm" fontWeight="lg">
                    {field.label}
                  </Typography>
                </td>
                <td>
                  <Typography level="body-sm">{formatComparisonValue(selectedComparisonRow[field.key], field.format)}</Typography>
                </td>
                <td>
                  <Typography level="body-sm">{formatComparisonValue(comparisonRow[field.key], field.format)}</Typography>
                </td>
                <td>
                  <Chip size="sm" color={different ? 'warning' : 'neutral'} variant={different ? 'solid' : 'soft'}>
                    {different ? 'Different' : 'Match'}
                  </Chip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Card size="sm" variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="title-sm">Selected row notes</Typography>
          <Typography level="body-sm" sx={{ mt: 0.5 }}>
            {selectedComparisonRow.description || 'No row description.'}
          </Typography>
        </Card>
        <Card size="sm" variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="title-sm">Linked row notes</Typography>
          <Typography level="body-sm" sx={{ mt: 0.5 }}>
            {comparisonRow.description || 'No row description.'}
          </Typography>
        </Card>
      </Stack>

      {comparisonRow.errorMessages && comparisonRow.errorMessages.length > 0 && (
        <Stack spacing={0.75}>
          <Typography level="title-sm">Linked row errors</Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {comparisonRow.errorMessages.map(message => (
              <Chip key={`${comparisonRow.coreMeasurementID}-${message}`} size="sm" variant="soft" color="warning">
                {message}
              </Chip>
            ))}
          </Stack>
        </Stack>
      )}

      <Button size="sm" variant="soft" color="warning" onClick={() => onInspectRow(comparisonRow.coreMeasurementID)}>
        Open linked row details
      </Button>
    </Stack>
  );
}
