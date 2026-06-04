'use client';
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, List, ListItem, Stack, Typography } from '@mui/joy';
import { v4 } from 'uuid';
import type { FileWithPath } from 'react-dropzone';
import type { FileCollectionRowSet, FileRowSet } from '@/config/macros/formdetails';
import type { TransformResult, TransformSummary, TransformWarning } from '@/lib/arcgis/types';
import { MissingColumnError, MissingSheetError, UnparseableDateError } from '@/lib/arcgis/errors';
import ailogger from '@/ailogger';

interface UploadArcgisPreflightProps {
  acceptedFiles: FileWithPath[];
  onProceed: (rows: FileCollectionRowSet) => void;
  onError: (error: Error) => void;
}

const SUMMARY_FIELDS: { key: keyof TransformSummary; label: string }[] = [
  { key: 'totalRows', label: 'Rows to transform' },
  { key: 'treesTransformed', label: 'Trees (primary stems)' },
  { key: 'stemsJoined', label: 'Stems joined to a parent' },
  { key: 'blankQuadratCount', label: 'Blank quadrat labels (passed through)' },
  { key: 'tagMismatchCount', label: 'Stem/parent tag mismatches (parent wins)' },
  { key: 'orphanStemsDropped', label: 'Orphan stems dropped' }
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
            <Typography level="title-sm">Warnings ({warnings.length})</Typography>
            <List size="sm" sx={{ maxHeight: 240, overflow: 'auto' }}>
              {warnings.slice(0, 200).map((w, i) => (
                <ListItem key={`${w.type}-${w.globalId ?? i}`}>
                  <Typography level="body-xs">{w.message}</Typography>
                </ListItem>
              ))}
            </List>
            {warnings.length > 200 && <Typography level="body-xs">…and {warnings.length - 200} more.</Typography>}
          </Box>
        )}
        <Box sx={{ mt: 2 }}>
          <Button onClick={onProceed}>Proceed with import</Button>
        </Box>
      </CardContent>
    </Card>
  );
}

function rowsToRowSet(result: TransformResult): FileRowSet {
  const set: FileRowSet = {};
  for (const row of result.rows) set[`row-${v4()}`] = row;
  return set;
}

export default function UploadArcgisPreflight({ acceptedFiles, onProceed, onError }: Readonly<UploadArcgisPreflightProps>) {
  const [result, setResult] = useState<TransformResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const file = acceptedFiles[0];
      if (!file) {
        setErrorMessage('No file provided for the ArcGIS import.');
        return;
      }
      if (acceptedFiles.length > 1) {
        setErrorMessage(`ArcGIS import accepts exactly one workbook, but ${acceptedFiles.length} files were provided. Remove the extra file(s) and try again.`);
        return;
      }
      try {
        const [{ readArcgisWorkbook }, { transformArcgisWorkbook }] = await Promise.all([
          import('@/lib/arcgis/workbook-reader'),
          import('@/lib/arcgis/transform')
        ]);
        const buffer = await (file as File).arrayBuffer();
        const workbook = readArcgisWorkbook(buffer);
        const transformed = transformArcgisWorkbook(workbook);
        if (!cancelled) setResult(transformed);
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof MissingSheetError || error instanceof MissingColumnError || error instanceof UnparseableDateError) {
          setErrorMessage(error.message);
        } else {
          const wrapped = error instanceof Error ? error : new Error(String(error));
          ailogger.error('ArcGIS pre-flight failed:', wrapped);
          onError(wrapped);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [acceptedFiles, onError]);

  if (errorMessage) {
    return (
      <Alert color="danger" variant="soft">
        {errorMessage}
      </Alert>
    );
  }
  if (!result) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size="sm" />
        <Typography level="body-sm">Reading and transforming the ArcGIS workbook…</Typography>
      </Stack>
    );
  }
  const file = acceptedFiles[0] as File;
  return <ArcgisPreflightSummary summary={result.summary} warnings={result.warnings} onProceed={() => onProceed({ [file.name]: rowsToRowSet(result) })} />;
}
