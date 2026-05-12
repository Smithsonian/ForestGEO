'use client';

import React from 'react';
import { Alert, Box, FormControl, FormHelperText, FormLabel, Input, Radio, RadioGroup, Stack, Typography } from '@mui/joy';
import type { ProvisioningInput, QuadratConfig, QuadratCsvRow } from '@/lib/provisioning/types';
import { generateGrid } from '@/lib/provisioning/grid-generator';
import { parseQuadratCsv } from '@/lib/provisioning/csv-parser';
import { rectsOverlap } from '@/lib/provisioning/steps/validate-inputs';

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

function validateCsvRows(rows: QuadratCsvRow[], plot: ProvisioningInput['plot']): CsvValidationIssue[] {
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

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rectsOverlap(rows[i], rows[j])) {
        issues.push({
          quadratName: rows[i].quadratName,
          message: `overlaps with "${rows[j].quadratName}"`
        });
      }
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
        <FormLabel>Naming Pattern</FormLabel>
        <RadioGroup
          aria-label="Naming Pattern"
          value={value.namingPattern}
          onChange={e => onChange({ ...value, namingPattern: e.target.value as typeof value.namingPattern })}
          orientation="horizontal"
        >
          <Radio value={NAMING_PATTERN_SEQUENTIAL} label="Sequential (Q0001, Q0002…)" />
          <Radio value={NAMING_PATTERN_ROW_COL} label="Row-Col (1-1, 1-2…)" />
        </RadioGroup>
      </FormControl>

      <Box>{previewContent}</Box>
    </Stack>
  );
}

function CsvResultSummary({ rows, plot }: { rows: QuadratCsvRow[]; plot: ProvisioningInput['plot'] }) {
  const validationIssues = validateCsvRows(rows, plot);

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

export default function QuadratPlanner({ value, onChange, plot }: QuadratPlannerProps) {
  const [csvParseErrors, setCsvParseErrors] = React.useState<Array<{ rowNumber: number; message: string }>>([]);

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

      <FormControl>
        <FormLabel>Mode</FormLabel>
        <RadioGroup aria-label="Quadrat Mode" value={value.mode} onChange={e => switchMode(e.target.value as 'grid' | 'csv')} orientation="horizontal">
          <Radio value="grid" label="Grid (auto-generate)" />
          <Radio value="csv" label="CSV (upload custom layout)" />
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

          {csvParseErrors.length === 0 && value.rows.length > 0 && <CsvResultSummary rows={value.rows} plot={plot} />}
        </Stack>
      )}
    </Stack>
  );
}
