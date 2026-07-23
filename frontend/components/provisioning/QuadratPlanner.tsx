'use client';

import React, { useMemo } from 'react';
import { Alert, Box, FormControl, FormHelperText, FormLabel, Input, Radio, RadioGroup, Stack, Typography } from '@mui/joy';
import type { ProvisioningPlotInput, QuadratRequestConfig, QuadratCsvRow, QuadratReferenceCorner } from '@/lib/provisioning/types';
import { generateGrid } from '@/lib/provisioning/grid-generator';
import { parseQuadratCsv } from '@/lib/provisioning/csv-parser';
import { collectQuadratBoundsIssues, findFirstOverlap } from '@/lib/provisioning/geometry';
import { DEFAULT_REFERENCE_CORNER, getReferenceCornerLabel, normalizeToSouthwest } from '@/lib/provisioning/coordinate-reference-corner';
import ReferenceCornerSelect from './ReferenceCornerSelect';

const QUADRAT_SIZE_MIN = 1;
const QUADRAT_SIZE_MAX = 10_000;

const NAMING_PATTERN_SEQUENTIAL = 'sequential' as const;
const NAMING_PATTERN_ROW_COL = 'row-col' as const;

interface CsvValidationIssue {
  quadratName: string;
  message: string;
}

export interface QuadratPlannerProps {
  value: QuadratRequestConfig;
  onChange: (next: QuadratRequestConfig) => void;
  plot: ProvisioningPlotInput;
  showErrors?: boolean;
}

function collectBoundsIssues(rows: QuadratCsvRow[], plot: ProvisioningPlotInput): CsvValidationIssue[] {
  return collectQuadratBoundsIssues(rows, plot).map(issue => ({ quadratName: issue.quadratName, message: issue.message }));
}

function GridModePanel({
  value,
  onChange,
  plot
}: {
  value: QuadratRequestConfig & { mode: 'grid' };
  onChange: (next: QuadratRequestConfig) => void;
  plot: ProvisioningPlotInput;
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
          <FormLabel htmlFor="quadrat-size-x-input">Quadrat Size X ({plot.defaultDimensionUnits})</FormLabel>
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
          <FormLabel htmlFor="quadrat-size-y-input">Quadrat Size Y ({plot.defaultDimensionUnits})</FormLabel>
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

function CsvResultSummary({
  rows,
  plot,
  overlap,
  referenceCornerLabel
}: {
  rows: QuadratCsvRow[];
  plot: ProvisioningPlotInput;
  overlap: [QuadratCsvRow, QuadratCsvRow] | null;
  referenceCornerLabel: string;
}) {
  const validationIssues = collectBoundsIssues(rows, plot);
  if (overlap) {
    validationIssues.push({
      quadratName: overlap[0].quadratName,
      message: `Quadrat "${overlap[0].quadratName}" overlaps with "${overlap[1].quadratName}"`
    });
  }

  if (validationIssues.length === 0) {
    return (
      <Alert color="success" size="sm" aria-label="CSV load success">
        Loaded {rows.length} quadrats (no errors), read as {referenceCornerLabel}
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
            {issue.message}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}

export default function QuadratPlanner({ value, onChange, plot, showErrors = false }: QuadratPlannerProps) {
  const [csvParseErrors, setCsvParseErrors] = React.useState<Array<{ rowNumber: number; message: string }>>([]);

  const csvRows = value.mode === 'csv' ? value.rows : null;
  const referenceCorner: QuadratReferenceCorner = value.mode === 'csv' ? value.coordinateReferenceCorner : DEFAULT_REFERENCE_CORNER;
  const referenceCornerLabel = getReferenceCornerLabel(referenceCorner);

  // Rows in canonical south-west coordinates, re-derived whenever the declared reference
  // corner changes — so switching the selector re-evaluates bounds/overlap without a re-upload.
  const normalizedRows = useMemo(() => (csvRows ? csvRows.map(row => normalizeToSouthwest(row, referenceCorner)) : null), [csvRows, referenceCorner]);
  const overlap = useMemo(() => (normalizedRows ? findFirstOverlap(normalizedRows) : null), [normalizedRows]);

  // CSV-mode aggregate validation issues used to surface a top-level error banner
  // when the wizard signals showErrors=true (e.g. user clicked Next on an invalid step).
  const csvValidationIssues = useMemo(() => {
    if (value.mode !== 'csv' || !normalizedRows) return [];
    const issues = collectBoundsIssues(normalizedRows, plot);
    if (overlap) {
      issues.push({ quadratName: overlap[0].quadratName, message: `Quadrat "${overlap[0].quadratName}" overlaps with "${overlap[1].quadratName}"` });
    }
    return issues;
  }, [value.mode, normalizedRows, plot, overlap]);

  const csvIsEmpty = value.mode === 'csv' && value.rows.length === 0 && csvParseErrors.length === 0;

  function handleFileSelected(file: File) {
    file.text().then(content => {
      const { rows, errors: parseErrors } = parseQuadratCsv(content);
      setCsvParseErrors(parseErrors);
      onChange({ mode: 'csv', rows, coordinateReferenceCorner: referenceCorner });
    });
  }

  function switchMode(newMode: 'grid' | 'csv' | 'none') {
    setCsvParseErrors([]);
    if (newMode === 'grid') {
      onChange({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: NAMING_PATTERN_SEQUENTIAL });
    } else if (newMode === 'csv') {
      onChange({ mode: 'csv', rows: [], coordinateReferenceCorner: DEFAULT_REFERENCE_CORNER });
    } else {
      onChange({ mode: 'none' });
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
          onChange={e => switchMode(e.target.value as 'grid' | 'csv' | 'none')}
          orientation="horizontal"
        >
          <Radio value="grid" label="Grid (auto-generate)" aria-label="Grid mode: auto-generate quadrats" />
          <Radio value="csv" label="CSV (upload custom layout)" aria-label="CSV mode: upload custom quadrat layout" />
          <Radio value="none" label="None (add later)" aria-label="None mode: create no quadrats now" />
        </RadioGroup>
      </FormControl>

      {value.mode === 'grid' && <GridModePanel value={value} onChange={onChange} plot={plot} />}

      {value.mode === 'none' && (
        <Alert color="neutral" variant="soft" size="sm" aria-label="No quadrats will be created">
          No quadrats will be created now. Upload the real quadrat list later from the Quadrats page. This avoids seeding a placeholder grid that would coexist
          with — and duplicate — your uploaded quadrats. The Quadrats page currently assumes every row&apos;s StartX/StartY identifies the south-west
          (lower-left) corner, so if your file uses a different corner, use CSV mode here instead.
        </Alert>
      )}

      {value.mode === 'csv' && (
        <Stack spacing={2}>
          <ReferenceCornerSelect
            id="reference-corner-input"
            value={referenceCorner}
            onChange={newCorner => onChange({ ...value, coordinateReferenceCorner: newCorner })}
            helperText="Coordinates are stored relative to the plot's lower-left origin. Choosing a different corner converts the uploaded coordinates on import — it does not move the plot."
          />

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

          {csvParseErrors.length === 0 && normalizedRows && normalizedRows.length > 0 && (
            <CsvResultSummary rows={normalizedRows} plot={plot} overlap={overlap} referenceCornerLabel={referenceCornerLabel} />
          )}
        </Stack>
      )}
    </Stack>
  );
}
