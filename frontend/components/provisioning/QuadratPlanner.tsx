'use client';

import React, { useMemo } from 'react';
import { Alert, Box, Checkbox, FormControl, FormHelperText, FormLabel, Input, Radio, RadioGroup, Stack, Typography } from '@mui/joy';
import type { ProvisioningPlotInput, QuadratConfig } from '@/lib/provisioning/types';
import { generateGrid } from '@/lib/provisioning/grid-generator';
import { parseQuadratCsv } from '@/lib/provisioning/csv-parser';
import {
  acknowledgmentCoversLayout,
  buildQuadratOverlapAcknowledgment,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
  validateQuadratCollectionDetailed
} from '@/lib/provisioning/quadrat-collection-validation';

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
  plot: ProvisioningPlotInput;
  showErrors?: boolean;
}

function GridModePanel({
  value,
  onChange,
  plot
}: {
  value: QuadratConfig & { mode: 'grid' };
  onChange: (next: QuadratConfig) => void;
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
  rowCount,
  blockingIssues,
  overlapIssues,
  overlapAcknowledged,
  onOverlapAcknowledgedChange
}: {
  rowCount: number;
  blockingIssues: CsvValidationIssue[];
  overlapIssues: CsvValidationIssue[];
  overlapAcknowledged: boolean;
  onOverlapAcknowledgedChange: (acknowledged: boolean) => void;
}) {
  return (
    <Stack spacing={1}>
      {blockingIssues.length === 0 && overlapIssues.length === 0 && (
        <Alert color="success" size="sm" aria-label="CSV load success">
          Loaded {rowCount} quadrats (no errors)
        </Alert>
      )}

      {blockingIssues.length > 0 && (
        <>
          <Alert color="danger" size="sm">
            {blockingIssues.length} validation {blockingIssues.length === 1 ? 'error' : 'errors'} found
          </Alert>
          <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
            {blockingIssues.map((issue, idx) => (
              <Typography key={idx} component="li" level="body-sm" color="danger">
                {issue.message}
              </Typography>
            ))}
          </Stack>
        </>
      )}

      {overlapIssues.length > 0 && (
        <>
          {/* Overlaps are warn-and-acknowledge, never a hard error: surveyed quadrat footprints
              can genuinely overlap, so the admin confirms rather than being refused. */}
          <Alert color="warning" size="sm" aria-label="CSV overlap warning">
            Overlapping quadrat footprints detected. Overlaps can be genuine field measurements; confirm below to proceed with them.
          </Alert>
          <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
            {overlapIssues.map((issue, idx) => (
              <Typography key={idx} component="li" level="body-sm" color="warning">
                {issue.message}
              </Typography>
            ))}
          </Stack>
          {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- Joy UI Checkbox `label` prop renders an associated <label> at runtime; the linter just doesn't parse the component */}
          <Checkbox
            label={QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT}
            slotProps={{ input: { 'aria-label': 'Acknowledge quadrat overlaps' } }}
            checked={overlapAcknowledged}
            onChange={event => onOverlapAcknowledgedChange(event.target.checked)}
          />
        </>
      )}
    </Stack>
  );
}

export default function QuadratPlanner({ value, onChange, plot, showErrors = false }: QuadratPlannerProps) {
  const [csvParseErrors, setCsvParseErrors] = React.useState<Array<{ rowNumber: number; message: string }>>([]);

  const csvRows = value.mode === 'csv' ? value.rows : null;

  // CSV-mode aggregate validation issues used to surface a top-level error banner
  // when the wizard signals showErrors=true (e.g. user clicked Next on an invalid step).
  const csvValidation = useMemo(() => {
    if (value.mode !== 'csv' || !csvRows) return null;
    return validateQuadratCollectionDetailed(csvRows, plot);
  }, [value.mode, csvRows, plot]);
  const csvBlockingIssues = useMemo<CsvValidationIssue[]>(
    () => csvValidation?.fatalIssues.map(issue => ({ quadratName: issue.quadratName, message: issue.message })) ?? [],
    [csvValidation]
  );
  const csvOverlapIssues = useMemo<CsvValidationIssue[]>(
    () => csvValidation?.overlapSummary?.pairs.map(pair => ({ quadratName: '(layout)', message: pair.message })) ?? [],
    [csvValidation]
  );
  const overlapAcknowledged =
    value.mode === 'csv' &&
    csvValidation?.overlapSummary !== null &&
    csvValidation?.overlapSummary !== undefined &&
    acknowledgmentCoversLayout(value.overlapAcknowledgment, csvValidation.overlapSummary.layoutSignature);
  // Blocking issues always block; overlap issues block only until acknowledged.
  const unresolvedIssueCount = csvBlockingIssues.length + (overlapAcknowledged ? 0 : csvOverlapIssues.length);

  function setOverlapAcknowledged(acknowledged: boolean) {
    if (value.mode !== 'csv') return;
    const { overlapAcknowledgment: _dropped, ...rest } = value;
    const layoutSignature = csvValidation?.overlapSummary?.layoutSignature;
    onChange(acknowledged && layoutSignature ? { ...rest, overlapAcknowledgment: buildQuadratOverlapAcknowledgment([layoutSignature]) } : rest);
  }

  const csvIsEmpty = value.mode === 'csv' && value.rows.length === 0 && csvParseErrors.length === 0;

  async function handleFileSelected(file: File) {
    try {
      const content = await file.text();
      const { rows, errors: parseErrors } = parseQuadratCsv(content);
      setCsvParseErrors(parseErrors);
      onChange({ mode: 'csv', rows });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setCsvParseErrors([{ rowNumber: 1, message: `Could not read CSV file: ${message}` }]);
      onChange({ mode: 'csv', rows: [] });
    }
  }

  function switchMode(newMode: 'grid' | 'csv' | 'none') {
    setCsvParseErrors([]);
    if (newMode === 'grid') {
      onChange({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: NAMING_PATTERN_SEQUENTIAL });
    } else if (newMode === 'csv') {
      onChange({ mode: 'csv', rows: [] });
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

      {showErrors && unresolvedIssueCount > 0 && (
        <Alert color="danger" variant="soft" size="sm" aria-label="CSV validation summary">
          {unresolvedIssueCount} validation issue{unresolvedIssueCount === 1 ? '' : 's'} in CSV — review and re-upload, or acknowledge overlaps below.
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
          with — and duplicate — your uploaded quadrats.
        </Alert>
      )}

      {value.mode === 'csv' && (
        <Stack spacing={2}>
          <FormControl>
            <FormLabel htmlFor="csv-file-input">Upload Quadrat CSV</FormLabel>
            <FormHelperText>
              Required columns: quadratName, startX, startY, dimensionX, dimensionY. startX/startY must be each quadrat&apos;s south-west (lower-left) corner,
              measured from the plot&apos;s south-west origin.
            </FormHelperText>
            <input
              id="csv-file-input"
              aria-label="Upload Quadrat CSV"
              type="file"
              accept=".csv,text/csv"
              style={{ marginTop: 8 }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
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

          {csvParseErrors.length === 0 && csvRows && csvRows.length > 0 && (
            <CsvResultSummary
              rowCount={csvRows.length}
              blockingIssues={csvBlockingIssues}
              overlapIssues={csvOverlapIssues}
              overlapAcknowledged={overlapAcknowledged}
              onOverlapAcknowledgedChange={setOverlapAcknowledged}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
