'use client';
import React, { useEffect, useState } from 'react';
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
import type { ArcgisImportReference, ArcgisPreflightResponse, TransformSummary, TransformWarning } from '@/lib/arcgis/types';
import { warningsToCsv } from '@/lib/arcgis/diagnostics-csv';
import { arcgisHelpHeaders } from '@/lib/arcgis/schema';
import ailogger from '@/ailogger';

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

export default function UploadArcgisPreflight({ acceptedFiles, schema, plotID, censusID, onProceed, onBack, onError }: Readonly<UploadArcgisPreflightProps>) {
  const [result, setResult] = useState<ArcgisPreflightResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setResult(null);
      setErrorMessage(null);
      const file = acceptedFiles[0];
      if (!file) {
        setErrorMessage('No file provided for the ArcGIS import.');
        return;
      }
      if (acceptedFiles.length > 1) {
        setErrorMessage(`ArcGIS import accepts exactly one workbook, but ${acceptedFiles.length} files were provided. Remove the extra file(s) and try again.`);
        return;
      }
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setErrorMessage('ArcGIS import requires a single .xlsx workbook.');
        return;
      }
      if (!schema || !plotID || !censusID) {
        setErrorMessage('ArcGIS import requires an active site, plot, and census selection.');
        return;
      }

      try {
        const formData = new FormData();
        formData.append('file', file as File);
        formData.append('schema', schema);
        formData.append('plotID', String(plotID));
        formData.append('censusID', String(censusID));

        const response = await fetch('/api/arcgis/preflight', {
          method: 'POST',
          body: formData
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ArcgisPreflightResponse> & { error?: string };
        if (cancelled) return;

        if (!response.ok) {
          const message = payload.error || `ArcGIS pre-flight failed with HTTP ${response.status}`;
          if ([400, 413, 422].includes(response.status)) {
            setErrorMessage(message);
            return;
          }
          throw new Error(message);
        }

        if (!payload.importSessionId || !payload.fileName || typeof payload.rowCount !== 'number' || !payload.summary || !Array.isArray(payload.warnings)) {
          throw new Error('ArcGIS pre-flight returned an incomplete import session response.');
        }

        if (!cancelled) setResult(payload as ArcgisPreflightResponse);
      } catch (error: unknown) {
        if (cancelled) return;
        const wrapped = error instanceof Error ? error : new Error(String(error));
        ailogger.error('ArcGIS pre-flight failed:', wrapped);
        onError(wrapped);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [acceptedFiles, schema, plotID, censusID, onError]);

  if (errorMessage) {
    return (
      <Alert color="danger" variant="soft" sx={{ width: '100%' }}>
        <Stack spacing={1}>
          <Typography level="body-sm">{errorMessage}</Typography>
          <Box>
            <Button size="sm" variant="outlined" color="danger" onClick={onBack}>
              Back to file selection
            </Button>
          </Box>
        </Stack>
      </Alert>
    );
  }
  if (!result) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size="sm" />
        <Typography level="body-sm">Preparing the ArcGIS workbook pre-flight…</Typography>
      </Stack>
    );
  }
  return (
    <ArcgisPreflightSummary
      summary={result.summary}
      warnings={result.warnings}
      onProceed={() => onProceed({ importSessionId: result.importSessionId, fileName: result.fileName, rowCount: result.rowCount })}
    />
  );
}
