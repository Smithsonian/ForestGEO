'use client';

import React, { useMemo } from 'react';
import { Alert, Box, FormControl, FormHelperText, FormLabel, Input, Radio, RadioGroup, Stack, Typography } from '@mui/joy';
import type { ProvisioningInput, QuadratConfig, QuadratCsvRow } from '@/lib/provisioning/types';
import { generateGrid } from '@/lib/provisioning/grid-generator';
import { parseQuadratCsv } from '@/lib/provisioning/csv-parser';
import { findFirstOverlap } from '@/lib/provisioning/geometry';

const QUADRAT_SIZE_MIN = 1;
const QUADRAT_SIZE_MAX = 10_000;

const NAMING_PATTERN_SEQUENTIAL = 'sequential' as const;
const NAMING_PATTERN_ROW_COL = 'row-col' as const;

interface CsvValidationIssue {
  quadratName: string;
  message: string;
}

export interface QuadratPlannerProps {
  value: QuadratConfig;
  onChange: (next: QuadratConfig) => void;
  plot: ProvisioningInput['plot'];
  showErrors?: boolean;
}

function collectBoundsIssues(rows: QuadratCsvRow[], plot: ProvisioningInput['plot']): CsvValidationIssue[] {
  const issues: CsvValidationIssue[] = [];

  for (const row of rows) {
    if (row.startX < 0 || row.startY < 0) {
      issues.push({ quadratName: row.quadratName, message: 'has negative start coordinates' });
      continue;
    }
    if (row.startX + row.dimensionX > plot.dimensionX) {
      issues.push({ quadratName: row.quadratName, message: 'extends past plot dimensionX' });
      continue;
    }
    if (row.startY + row.dimensionY > plot.dimensionY) {
      issues.push({ quadratName: row.quadratName, message: 'extends past plot dimensionY' });
      continue;
    }
  }

  return issues;
}

function GridModePanel({
  value,
  onChange,
  plot
}: {
  value: QuadratConfig & { mode: 'grid' };
  onChange: (next: QuadratConfig) => void;
  plot: ProvisioningInput['plot'];
}) {
  let previewContent: React.ReactNode;
  try {
    const generatedQuadrats = generateGrid(plot, value);
    const cols = plot.dimensionX / value.quadratSizeX;
    const rows = plot.dimensionY / value.quadratSizeY;
    previewContent = (
      <Typography level="body-sm" color="success" aria-label="Grid preview">
        Will create {generatedQuadrats.length} quadrats ({rows} rows × {cols} cols of {value.quadratSizeX}×{value.quadratSizeY})
      </Typography>
    );
  } catch {
    previewContent = (
      <Alert color="danger" size="sm" aria-label="Divisibility error">
        Plot dimensions ({plot.dimensionX}×{plot.dimensionY}) are not divisible by quadrat size ({value.quadratSizeX}×{value.quadratSizeY}). Use CSV mode for
        irregular grids.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="quadrat-size-x-input">Quadrat Size X (m)</FormLabel>
          <Input
            id="quadrat-size-x-input"
            aria-label="Quadrat Size X"
            type="number"
            value={value.quadratSizeX}
            onChange={e => onChange({ ...value, quadratSizeX: Number(e.target.value) })}
            slotProps={{ input: { min: QUADRAT_SIZE_MIN, max: QUADRAT_SIZE_MAX, step: 1 } }}
          />
        </FormControl>

        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="quadrat-size-y-input">Quadrat Size Y (m)</FormLabel>
          <Input
            id="quadrat-size-y-input"
            aria-label="Quadrat Size Y"
            type="number"
            value={value.quadratSizeY}
            onChange={e => onChange({ ...value, quadratSizeY: Number(e.target.value) })}
            slotProps={{ input: { min: QUADRAT_SIZE_MIN, max: QUADRAT_SIZE_MAX, step: 1 } }}
          />
        </FormControl>
      </Stack>

      <FormControl>
        <FormLabel htmlFor="naming-pattern-group">Naming Pattern</FormLabel>
        <RadioGroup
          id="naming-pattern-group"
          aria-label="Naming Pattern"
          value={value.namingPattern}
          onChange={e => onChange({ ...value, namingPattern: e.target.value as typeof value.namingPattern })}
          orientation="horizontal"
        >
          <Radio value={NAMING_PATTERN_SEQUENTIAL} label="Sequential (Q0001, Q0002…)" aria-label="Sequential naming pattern" />
          <Radio value={NAMING_PATTERN_ROW_COL} label="Row-Col (1-1, 1-2…)" aria-label="Row-column naming pattern" />
        </RadioGroup>
      </FormControl>

      <Box>{previewContent}</Box>
    </Stack>
  );
}

function CsvResultSummary({ rows, plot, overlap }: { rows: QuadratCsvRow[]; plot: ProvisioningInput['plot']; overlap: [QuadratCsvRow, QuadratCsvRow] | null }) {
  const validationIssues = collectBoundsIssues(rows, plot);
  if (overlap) {
    validationIssues.push({
      quadratName: overlap[0].quadratName,
      message: `overlaps with "${overlap[1].quadratName}"`
    });
  }

  if (validationIssues.length === 0) {
    return (
      <Alert color="success" size="sm" aria-label="CSV load success">
        Loaded {rows.length} quadrats (no errors)
      </Alert>
    );
  }

  return (
    <Stack spacing={1}>
      <Alert color="danger" size="sm">
        {validationIssues.length} validation {validationIssues.length === 1 ? 'error' : 'errors'} found
      </Alert>
      <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
        {validationIssues.map((issue, idx) => (
          <Typography key={idx} component="li" level="body-sm" color="danger">
            &quot;{issue.quadratName}&quot;: {issue.message}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}

export default function QuadratPlanner({ value, onChange, plot, showErrors = false }: QuadratPlannerProps) {
  const [csvParseErrors, setCsvParseErrors] = React.useState<Array<{ rowNumber: number; message: string }>>([]);

  const csvRows = value.mode === 'csv' ? value.rows : null;
  const overlap = useMemo(() => (csvRows ? findFirstOverlap(csvRows) : null), [csvRows]);

  // CSV-mode aggregate validation issues used to surface a top-level error banner
  // when the wizard signals showErrors=true (e.g. user clicked Next on an invalid step).
  const csvValidationIssues = useMemo(() => {
    if (value.mode !== 'csv') return [];
    const issues = collectBoundsIssues(value.rows, plot);
    if (overlap) {
      issues.push({ quadratName: overlap[0].quadratName, message: `overlaps with "${overlap[1].quadratName}"` });
    }
    return issues;
  }, [value, plot, overlap]);

  const csvIsEmpty = value.mode === 'csv' && value.rows.length === 0 && csvParseErrors.length === 0;

  function handleFileSelected(file: File) {
    file.text().then(content => {
      const { rows, errors: parseErrors } = parseQuadratCsv(content);
      setCsvParseErrors(parseErrors);
      onChange({ mode: 'csv', rows });
    });
  }

  function switchMode(newMode: 'grid' | 'csv') {
    setCsvParseErrors([]);
    if (newMode === 'grid') {
      onChange({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: NAMING_PATTERN_SEQUENTIAL });
    } else {
      onChange({ mode: 'csv', rows: [] });
    }
  }

  return (
    <Stack spacing={3}>
      <Typography level="title-md">Quadrat Configuration</Typography>

      {showErrors && value.mode === 'csv' && csvIsEmpty && (
        <Alert color="danger" variant="soft" size="sm" aria-label="CSV required">
          Upload a quadrat CSV before continuing.
        </Alert>
      )}

      {showErrors && csvValidationIssues.length > 0 && (
        <Alert color="danger" variant="soft" size="sm" aria-label="CSV validation summary">
          {csvValidationIssues.length} validation issue{csvValidationIssues.length === 1 ? '' : 's'} in CSV — review and re-upload.
        </Alert>
      )}

      <FormControl>
        <FormLabel htmlFor="quadrat-mode-group">Mode</FormLabel>
        <RadioGroup
          id="quadrat-mode-group"
          aria-label="Quadrat Mode"
          value={value.mode}
          onChange={e => switchMode(e.target.value as 'grid' | 'csv')}
          orientation="horizontal"
        >
          <Radio value="grid" label="Grid (auto-generate)" aria-label="Grid mode: auto-generate quadrats" />
          <Radio value="csv" label="CSV (upload custom layout)" aria-label="CSV mode: upload custom quadrat layout" />
        </RadioGroup>
      </FormControl>

      {value.mode === 'grid' && <GridModePanel value={value} onChange={onChange} plot={plot} />}

      {value.mode === 'csv' && (
        <Stack spacing={2}>
          <FormControl>
            <FormLabel htmlFor="csv-file-input">Upload Quadrat CSV</FormLabel>
            <FormHelperText>Required columns: quadratName, startX, startY, dimensionX, dimensionY</FormHelperText>
            <input
              id="csv-file-input"
              aria-label="Upload Quadrat CSV"
              type="file"
              accept=".csv,text/csv"
              style={{ marginTop: 8 }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
          </FormControl>

          {csvParseErrors.length > 0 && (
            <Stack spacing={1}>
              <Alert color="danger" size="sm">
                {csvParseErrors.length} parse {csvParseErrors.length === 1 ? 'error' : 'errors'} in uploaded file
              </Alert>
              <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
                {csvParseErrors.map((err, idx) => (
                  <Typography key={idx} component="li" level="body-sm" color="danger">
                    Row {err.rowNumber}: {err.message}
                  </Typography>
                ))}
              </Stack>
            </Stack>
          )}

          {csvParseErrors.length === 0 && value.rows.length > 0 && <CsvResultSummary rows={value.rows} plot={plot} overlap={overlap} />}
        </Stack>
      )}
    </Stack>
  );
}
