'use client';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  Stack,
  Typography
} from '@mui/joy';
import type { FileWithPath } from 'react-dropzone';
import type { ArcgisMappingRequiredResponse, ArcgisImportReference, ArcgisPreflightResponse, TransformSummary, TransformWarning } from '@/lib/arcgis/types';
import { PREFLIGHT_STATUS_MAPPING_REQUIRED } from '@/lib/arcgis/types';
import { warningsToCsv } from '@/lib/arcgis/diagnostics-csv';
import { arcgisHelpHeaders } from '@/lib/arcgis/schema';
import ailogger from '@/ailogger';
import ColumnMappingDialog from './columnmappingdialog';
import { isColumnMappingShape, seedMapping } from '@/lib/column-mapping/mapping';
import { SourceFormat } from '@/config/macros/formdetails';
import type { ArcgisSourceMetadata, ColumnMapping } from '@/lib/column-mapping/types';

const EXPECTED_COLUMNS = arcgisHelpHeaders();

function ExpectedColumns() {
  return (
    <AccordionGroup sx={{ mt: 2 }}>
      <Accordion>
        <AccordionSummary>
          <Typography level="title-sm">Expected columns ({EXPECTED_COLUMNS.length})</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <List size="sm">
            {EXPECTED_COLUMNS.map(column => (
              <ListItem key={column.label}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="sm" variant="soft" color={column.category === 'required' ? 'primary' : 'neutral'}>
                    {column.category === 'required' ? 'required' : 'optional'}
                  </Chip>
                  <Typography level="body-sm">
                    <strong>{column.label}</strong>
                    {column.explanation ? ` — ${column.explanation}` : ''}
                  </Typography>
                </Stack>
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>
    </AccordionGroup>
  );
}

const DIAGNOSTICS_FILENAME = 'arcgis-diagnostics.csv';

function downloadWarningsCsv(warnings: TransformWarning[]) {
  const csv = warningsToCsv(warnings);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = DIAGNOSTICS_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

interface UploadArcgisPreflightProps {
  acceptedFiles: FileWithPath[];
  schema: string;
  plotID: number;
  censusID: number;
  onProceed: (importSession: ArcgisImportReference) => void;
  onBack: () => void;
  onError: (error: Error) => void;
}

const SUMMARY_FIELDS: { key: keyof TransformSummary; label: string }[] = [
  { key: 'totalRows', label: 'Rows to transform' },
  { key: 'treesTransformed', label: 'Trees (primary stems)' },
  { key: 'stemsJoined', label: 'Stems joined to a parent' },
  { key: 'blankQuadratCount', label: 'Blank quadrat labels (passed through)' },
  { key: 'tagMismatchCount', label: 'Stem/parent tag mismatches (parent wins)' },
  { key: 'orphanStemsEmitted', label: 'Stems with no matching parent (emitted)' },
  { key: 'duplicateTreeTags', label: 'Duplicate tree tags' },
  { key: 'duplicateGlobalIds', label: 'Duplicate GlobalIDs' },
  { key: 'missingRequired', label: 'Rows missing a required field (will fail validation)' }
];

export function ArcgisPreflightSummary({ summary, warnings, onProceed }: { summary: TransformSummary; warnings: TransformWarning[]; onProceed: () => void }) {
  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardContent>
        <Typography level="title-lg">ArcGIS workbook pre-flight</Typography>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {SUMMARY_FIELDS.map(field => (
            <Typography key={field.key} level="body-sm">
              {field.label}: <strong>{summary[field.key]}</strong>
            </Typography>
          ))}
        </Stack>
        {warnings.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography level="title-sm">Warnings ({warnings.length})</Typography>
              <Button size="sm" variant="outlined" onClick={() => downloadWarningsCsv(warnings)}>
                Download diagnostics (CSV)
              </Button>
            </Stack>
            <List size="sm" sx={{ maxHeight: 240, overflow: 'auto' }}>
              {warnings.slice(0, 200).map((w, i) => (
                <ListItem key={`${w.type}-${w.globalId ?? 'none'}-${i}`}>
                  <Typography level="body-xs">{w.message}</Typography>
                </ListItem>
              ))}
            </List>
            {warnings.length > 200 && <Typography level="body-xs">…and {warnings.length - 200} more.</Typography>}
          </Box>
        )}
        <ExpectedColumns />
        <Box sx={{ mt: 2 }}>
          <Button onClick={onProceed}>Proceed with import</Button>
        </Box>
      </CardContent>
    </Card>
  );
}

type PreflightUiState =
  | { phase: 'preflighting' }
  | { phase: 'recoverableError'; message: string }
  | { phase: 'mappingNeeded'; meta: ArcgisSourceMetadata; mapping: ColumnMapping; serverError: string | null; dialogOpen: boolean }
  | { phase: 'ready'; result: ArcgisPreflightResponse };

type PreflightAction =
  | { type: 'RESET' }
  | { type: 'RECOVERABLE_ERROR'; message: string }
  | { type: 'MAPPING_REQUIRED'; meta: ArcgisSourceMetadata; mapping: ColumnMapping; serverError: string | null }
  | { type: 'SUCCEEDED'; result: ArcgisPreflightResponse }
  | { type: 'DIALOG_OPENED' }
  | { type: 'DIALOG_CLOSED' }
  | { type: 'MAPPING_APPLIED'; mapping: ColumnMapping };

function preflightReducer(state: PreflightUiState, action: PreflightAction): PreflightUiState {
  switch (action.type) {
    case 'RESET':
      return { phase: 'preflighting' };
    case 'RECOVERABLE_ERROR':
      return { phase: 'recoverableError', message: action.message };
    case 'MAPPING_REQUIRED':
      return { phase: 'mappingNeeded', meta: action.meta, mapping: action.mapping, serverError: action.serverError, dialogOpen: true };
    case 'SUCCEEDED':
      return { phase: 'ready', result: action.result };
    case 'DIALOG_OPENED':
      return state.phase === 'mappingNeeded' ? { ...state, dialogOpen: true } : state;
    case 'DIALOG_CLOSED':
      return state.phase === 'mappingNeeded' ? { ...state, dialogOpen: false } : state;
    case 'MAPPING_APPLIED':
      return state.phase === 'mappingNeeded' ? { ...state, mapping: action.mapping, dialogOpen: false } : state;
  }
}

export default function UploadArcgisPreflight({ acceptedFiles, schema, plotID, censusID, onProceed, onBack, onError }: Readonly<UploadArcgisPreflightProps>) {
  const [ui, dispatch] = useReducer(preflightReducer, { phase: 'preflighting' });
  // onError is read through a ref so runPreflight's identity (and therefore the preflight effect)
  // is insulated from parents that pass a fresh inline callback on every render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const abortRef = useRef<AbortController | null>(null);

  const runPreflight = useCallback(
    async (mappingArg?: ColumnMapping) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const file = acceptedFiles[0];
      try {
        const formData = new FormData();
        formData.append('file', file as File);
        formData.append('schema', schema);
        formData.append('plotID', String(plotID));
        formData.append('censusID', String(censusID));
        if (mappingArg) formData.append('mapping', JSON.stringify(mappingArg));

        const response = await fetch('/api/arcgis/preflight', {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ArcgisPreflightResponse> &
          Partial<ArcgisMappingRequiredResponse> & {
            error?: string;
          };
        if (controller.signal.aborted) return;

        if (!response.ok) {
          const message = payload.error || `ArcGIS pre-flight failed with HTTP ${response.status}`;
          if ([400, 413, 422].includes(response.status)) {
            dispatch({ type: 'RECOVERABLE_ERROR', message });
            return;
          }
          throw new Error(message);
        }

        if (payload.status === PREFLIGHT_STATUS_MAPPING_REQUIRED && Array.isArray(payload.sheets)) {
          const meta: ArcgisSourceMetadata = { format: SourceFormat.arcgis_xlsx, sheets: payload.sheets };
          // Prefer the SERVER's echoed mapping over the one we submitted: on the stale path the
          // server returns a freshly seeded mapping with a corrected header signature, and reusing
          // our own submitted mapping would re-trip the stale gate on every resubmission.
          dispatch({
            type: 'MAPPING_REQUIRED',
            meta,
            mapping: isColumnMappingShape(payload.mapping) ? payload.mapping : (mappingArg ?? seedMapping(meta)),
            serverError: typeof payload.error === 'string' ? payload.error : null
          });
          return;
        }

        if (!payload.importSessionId || !payload.fileName || typeof payload.rowCount !== 'number' || !payload.summary || !Array.isArray(payload.warnings)) {
          throw new Error('ArcGIS pre-flight returned an incomplete import session response.');
        }

        dispatch({ type: 'SUCCEEDED', result: payload as ArcgisPreflightResponse });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        const wrapped = error instanceof Error ? error : new Error(String(error));
        ailogger.error('ArcGIS pre-flight failed:', wrapped);
        onErrorRef.current(wrapped);
      }
    },
    [acceptedFiles, schema, plotID, censusID]
  );

  useEffect(() => {
    dispatch({ type: 'RESET' });
    const file = acceptedFiles[0];
    if (!file) {
      dispatch({ type: 'RECOVERABLE_ERROR', message: 'No file provided for the ArcGIS import.' });
      return;
    }
    if (acceptedFiles.length > 1) {
      dispatch({
        type: 'RECOVERABLE_ERROR',
        message: `ArcGIS import accepts exactly one workbook, but ${acceptedFiles.length} files were provided. Remove the extra file(s) and try again.`
      });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      dispatch({ type: 'RECOVERABLE_ERROR', message: 'ArcGIS import requires a single .xlsx workbook.' });
      return;
    }
    if (!schema || !plotID || !censusID) {
      dispatch({ type: 'RECOVERABLE_ERROR', message: 'ArcGIS import requires an active site, plot, and census selection.' });
      return;
    }
    void runPreflight();
    return () => abortRef.current?.abort();
  }, [acceptedFiles, schema, plotID, censusID, runPreflight]);

  if (ui.phase === 'recoverableError') {
    return (
      <Alert color="danger" variant="soft" sx={{ width: '100%' }}>
        <Stack spacing={1}>
          <Typography level="body-sm">{ui.message}</Typography>
          <Box>
            <Button size="sm" variant="outlined" color="danger" onClick={onBack}>
              Back to file selection
            </Button>
          </Box>
        </Stack>
      </Alert>
    );
  }
  if (ui.phase === 'mappingNeeded') {
    return (
      <>
        <Alert data-testid="arcgis-mapping-required" color="warning" variant="soft" sx={{ width: '100%' }}>
          <Stack spacing={1}>
            <Typography level="body-sm">
              The workbook columns do not match the expected ArcGIS schema. Map your columns (and pick the trees/stems sheets) to continue.
            </Typography>
            {ui.serverError && (
              <Typography level="body-sm" color="danger">
                {ui.serverError}
              </Typography>
            )}
            <Stack direction="row" spacing={1}>
              <Button data-testid="arcgis-open-mapping" size="sm" onClick={() => dispatch({ type: 'DIALOG_OPENED' })}>
                Map columns
              </Button>
              <Button size="sm" variant="outlined" color="neutral" onClick={onBack}>
                Back to file selection
              </Button>
            </Stack>
          </Stack>
        </Alert>
        <ColumnMappingDialog
          open={ui.dialogOpen}
          format={SourceFormat.arcgis_xlsx}
          fileName={acceptedFiles[0]?.name}
          metadata={ui.meta}
          mapping={ui.mapping}
          serverError={ui.serverError ?? undefined}
          onApply={m => {
            dispatch({ type: 'MAPPING_APPLIED', mapping: m });
            void runPreflight(m);
          }}
          onClose={() => dispatch({ type: 'DIALOG_CLOSED' })}
        />
      </>
    );
  }
  if (ui.phase === 'preflighting') {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size="sm" />
        <Typography level="body-sm">Preparing the ArcGIS workbook pre-flight…</Typography>
      </Stack>
    );
  }
  return (
    <ArcgisPreflightSummary
      summary={ui.result.summary}
      warnings={ui.result.warnings}
      onProceed={() => onProceed({ importSessionId: ui.result.importSessionId, fileName: ui.result.fileName, rowCount: ui.result.rowCount })}
    />
  );
}
