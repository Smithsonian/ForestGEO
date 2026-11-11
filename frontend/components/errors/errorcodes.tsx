'use client';

import React, { useState } from 'react';
import { Autocomplete, Chip, Stack, Typography } from '@mui/joy';
import { GridRenderEditCellParams } from '@mui/x-data-grid';
import { ContradictionType, ErrorComparisonContext, ErrorExplorerRow } from '@/config/errorsexplorer';

export function renderPreviewCell(value: string | null | undefined, lines = 2) {
  const displayValue = value && value.trim().length > 0 ? value : '—';

  return (
    <Typography
      level="body-sm"
      title={displayValue}
      sx={{
        width: '100%',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: lines,
        whiteSpace: 'normal',
        textAlign: 'left',
        lineHeight: 1.35
      }}
    >
      {displayValue}
    </Typography>
  );
}

export function getDisplayedContradictionTypes(row: Pick<ErrorExplorerRow, 'contradictionTypes' | 'contradictionType'>): ContradictionType[] {
  if (row.contradictionTypes.length > 0) {
    return row.contradictionTypes;
  }
  return row.contradictionType ? [row.contradictionType] : [];
}

type CodesRow = Pick<ErrorExplorerRow, 'attributes' | 'rawCodes'>;

function normalizeCodeValue(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseCodesString(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(/[;,]/)
    .map(code => code.trim())
    .filter(Boolean);
}

export function joinCodesArray(codes: unknown): string {
  if (!Array.isArray(codes)) {
    return '';
  }

  return Array.from(new Set((codes as string[]).map(code => code.trim()).filter(Boolean))).join(';');
}

export function getUploadedCodesValue(row?: Partial<CodesRow> | null): string {
  const rawCodes = normalizeCodeValue(row?.rawCodes);
  return rawCodes || normalizeCodeValue(row?.attributes);
}

export function getMaterializedCodesValue(row?: Partial<CodesRow> | null): string {
  return normalizeCodeValue(row?.attributes);
}

export function formatOptionalMeasurement(value: number | null | undefined): string {
  return value == null ? '' : Number(value).toFixed(2);
}

export function formatErrorComparison(comparison: ErrorComparisonContext, currentHOM: number | null | undefined): string {
  if (comparison.priorCensusID == null && comparison.priorDBH == null && comparison.priorHOM == null) return 'Comparison unavailable';
  return (
    `Prior census ${comparison.priorCensusID ?? '—'}: DBH ${comparison.priorDBH ?? '—'}, HOM ${comparison.priorHOM ?? '—'}` +
    (comparison.priorHOM != null && currentHOM != null && comparison.homChanged ? ' (HOM changed)' : '')
  );
}

export function hasCodesMismatch(row?: Partial<CodesRow> | null): boolean {
  const uploadedCodes = joinCodesArray(parseCodesString(getUploadedCodesValue(row)));
  const materializedCodes = joinCodesArray(parseCodesString(getMaterializedCodesValue(row)));

  return uploadedCodes.length > 0 && uploadedCodes !== materializedCodes;
}

export function getCodesMismatchMessage(row?: Partial<CodesRow> | null): string {
  if (!hasCodesMismatch(row)) {
    return '';
  }

  return getMaterializedCodesValue(row) ? 'Some uploaded codes were not materialized.' : 'No valid codes were materialized. Check invalid codes or delimiters.';
}

export function renderCodesChips(codesValue: string, emptyLabel = '—') {
  const codes = parseCodesString(codesValue);
  if (codes.length === 0) {
    return <Typography level="body-sm">{emptyLabel}</Typography>;
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', py: 0.5 }}>
      {codes.map((code, index) => (
        <Chip key={`${code}-${index}`} size="sm" variant="soft">
          {code}
        </Chip>
      ))}
    </Stack>
  );
}

export function CodesEditCell({ params, options }: { params: GridRenderEditCellParams<ErrorExplorerRow, string>; options: string[] }) {
  // Local state, not row-edit state: row mode saves every editable field, so
  // a valueGetter/valueSetter here would mutate Attributes on unrelated edits.
  const [selectedCodes, setSelectedCodes] = useState(() => parseCodesString(getUploadedCodesValue(params.row)));

  return (
    <Autocomplete
      sx={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
      multiple
      freeSolo
      autoHighlight
      clearOnBlur={false}
      options={options}
      value={selectedCodes}
      isOptionEqualToValue={(option, value) => option === value}
      onChange={(_event, next) => {
        setSelectedCodes(next);
        void params.api.setEditCellValue({
          id: params.id,
          field: params.field,
          value: joinCodesArray(next)
        });
      }}
    />
  );
}
