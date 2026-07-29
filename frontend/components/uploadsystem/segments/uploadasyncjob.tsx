'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/joy';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { FileCollectionRowSet, FormType, SourceFormat } from '@/config/macros/formdetails';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { UploadMode } from '@/config/uploadmodes';
import type { FileWithStream } from '@/config/macros/uploadsystemmacros';
import type { ArcgisImportReference } from '@/lib/arcgis/types';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import ailogger from '@/ailogger';
import { describeUploadFileNameCollisions, findUploadFileNameCollisions } from '@/lib/uploads/file-names';

export interface BlobUploadResult {
  fileName: string;
  blobContainer: string;
  blobName: string;
  contentType: string | null;
  byteSize: number;
  formType: string;
  sourceFormat: string;
}

export interface UploadStorageScope {
  schema: string;
  plotID: number;
  plotCensusNumber: number;
}

interface UploadJobResponse {
  job?: {
    jobID: number;
    status: string;
    phase: string;
  };
  accepted?: boolean;
  jobID?: number;
  error?: string;
  details?: string;
}

interface UploadAsyncJobProps {
  acceptedFiles: FileWithStream[];
  parsedData: FileCollectionRowSet;
  uploadForm: FormType | undefined;
  uploadMode: UploadMode | undefined;
  sourceFormat?: SourceFormat;
  selectedDelimiters: Record<string, string>;
  columnMappings?: Record<string, ColumnMapping>;
  arcgisImportSession?: ArcgisImportReference | null;
  setIsDataUnsaved: React.Dispatch<React.SetStateAction<boolean>>;
  setUploadError: React.Dispatch<React.SetStateAction<any>>;
  setErrorComponent: React.Dispatch<React.SetStateAction<string>>;
  setReviewState: React.Dispatch<React.SetStateAction<ReviewStates>>;
  onClose: () => void;
}

function createUploadAttemptID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getExpectedRows(fileName: string, parsedData: FileCollectionRowSet, arcgisImportSession?: ArcgisImportReference | null): number | null {
  if (arcgisImportSession?.fileName === fileName) {
    return arcgisImportSession.rowCount;
  }
  const rows = parsedData[fileName];
  return rows ? Object.keys(rows).length : null;
}

/** An uploaded blob paired with the browser file name every wizard map is keyed by. */
export interface UploadedFileReference {
  originalFileName: string;
  blob: BlobUploadResult;
}

/**
 * Re-keys a wizard map from raw browser file names to the names the upload
 * route actually stored. The job route validates payload keys against
 * `files[].fileName` and the worker looks delimiters/mappings up by the same
 * value, so a raw-keyed map is rejected outright (and, before it was
 * validated, silently ignored). Entries with no uploaded counterpart are
 * dropped rather than sent as unknown file names.
 */
export function rekeyByStoredFileName<T>(source: Record<string, T>, uploadedFiles: UploadedFileReference[]): Record<string, T> {
  const storedNames = new Map(uploadedFiles.map(entry => [entry.originalFileName, entry.blob.fileName]));
  return Object.fromEntries(
    Object.entries(source).flatMap(([originalFileName, value]) => {
      const storedFileName = storedNames.get(originalFileName);
      return storedFileName ? [[storedFileName, value] as const] : [];
    })
  );
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload?.error || payload?.details || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function cleanupUploadedFiles(files: BlobUploadResult[], scope: UploadStorageScope): Promise<void> {
  const results = await Promise.allSettled(
    files.map(file => {
      const params = new URLSearchParams({
        schema: scope.schema,
        plotID: String(scope.plotID),
        census: String(scope.plotCensusNumber),
        container: file.blobContainer,
        filename: file.blobName
      });
      return fetch(`/api/files/delete?${params.toString()}`, { method: 'DELETE' }).then(response => {
        if (!response.ok && response.status !== 404) {
          throw new Error(`HTTP ${response.status}`);
        }
      });
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      ailogger.warn(
        `[UploadAsyncJob] Failed to clean uploaded blob ${files[index].blobName}:`,
        result.reason instanceof Error ? result.reason : new Error(String(result.reason))
      );
    }
  });
}

export default function UploadAsyncJob({
  acceptedFiles,
  parsedData,
  uploadForm,
  uploadMode,
  sourceFormat,
  selectedDelimiters,
  columnMappings,
  arcgisImportSession,
  setIsDataUnsaved,
  setUploadError,
  setErrorComponent,
  setReviewState,
  onClose
}: UploadAsyncJobProps) {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const hasStartedRef = useRef(false);
  const attemptIDRef = useRef(createUploadAttemptID());
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('Preparing upload...');
  const [queuedJobID, setQueuedJobID] = useState<number | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    // Teardown only stops this run from writing THIS component's own progress
    // state. It must NEVER abort the run: hasStartedRef makes the effect
    // one-shot for the component instance, so an aborted run has no restart
    // path — it would strand the dialog mid-progress and (via the cleanup
    // below) delete blobs the user already uploaded. A re-render with new
    // dependency identities, and React StrictMode's double-invoke in dev, both
    // take this path. The outcome setters the parent owns (upload error, review
    // state, unsaved flag) are always called: the parent outlives this dialog
    // and a swallowed failure would leave the wizard reporting nothing at all.
    let cancelled = false;
    const setStepIfLive = (step: string) => {
      if (!cancelled) setCurrentStep(step);
    };

    async function runAsyncUpload() {
      const uploadedFiles: UploadedFileReference[] = [];
      let cleanupAllowed = true;
      let cleanupScope: UploadStorageScope | null = null;
      try {
        const schema = currentSite?.schemaName;
        const plotID = currentPlot?.plotID;
        const plotName = currentPlot?.plotName?.trim();
        const plotCensusNumber = currentCensus?.plotCensusNumber;
        const censusID = currentCensus?.dateRanges?.[0]?.censusID;
        const normalizedSourceFormat = sourceFormat ?? SourceFormat.csv;

        if (!schema || !plotID || !plotName || !plotCensusNumber || !censusID || !uploadForm || !uploadMode) {
          throw new Error('Missing required context for async upload job');
        }

        cleanupScope = { schema, plotID, plotCensusNumber };

        // Canonicalize BEFORE anything is uploaded. Sanitizing is lossy — "a
        // b.csv" and "a_b.csv" both become "a_b.csv" — and the canonical name is
        // the job's file identity, so a clash is rejected at job creation. Left
        // to that point, both files have already been uploaded to storage and
        // the user is told only that the job has duplicate file names. Caught
        // here, nothing is uploaded and the message names both of their files.
        const nameCollisions = findUploadFileNameCollisions(acceptedFiles.map(file => file.name));
        if (nameCollisions.length > 0) {
          throw new Error(`Rename one of these files before uploading: ${describeUploadFileNameCollisions(nameCollisions)}.`);
        }

        const totalSteps = acceptedFiles.length + 1;

        for (let index = 0; index < acceptedFiles.length; index++) {
          const file = acceptedFiles[index];
          setStepIfLive(`Uploading ${file.name} to cloud storage...`);

          const params = new URLSearchParams({
            fileName: file.name,
            schema,
            plotID: String(plotID),
            plotName,
            census: String(plotCensusNumber),
            formType: uploadForm,
            sourceFormat: normalizedSourceFormat,
            // Binds the blob to this attempt: it is stored under an
            // attempt-scoped path, created atomically rather than after an
            // exists() probe, and stamped with the attempt in blob metadata.
            attemptID: attemptIDRef.current
          });

          const formData = new FormData();
          formData.append(file.name, file);

          const response = await fetch(`/api/files/upload?${params.toString()}`, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`Failed to upload ${file.name}: ${await readErrorMessage(response)}`);
          }

          uploadedFiles.push({ originalFileName: file.name, blob: (await response.json()) as BlobUploadResult });
          if (!cancelled) setProgress(Math.round(((index + 1) / totalSteps) * 100));
        }

        setStepIfLive('Queueing background processing job...');

        // Once the queue request is on the wire, a network failure is ambiguous:
        // the server may already have committed the job. Do not delete blobs in
        // that case; an accepted worker could be reading them.
        cleanupAllowed = false;
        const jobResponse = await fetch('/api/uploadjobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema,
            plotID,
            censusID,
            uploadMode,
            sourceFormat: normalizedSourceFormat,
            formType: uploadForm,
            idempotencyKey: `async-upload:${schema}:${plotID}:${censusID}:${attemptIDRef.current}`,
            attemptID: attemptIDRef.current,
            payload: {
              asyncUploadVersion: 1,
              plotName,
              plotCensusNumber,
              usesSubquadrats: currentPlot?.usesSubquadrats === true,
              selectedDelimiters: rekeyByStoredFileName(selectedDelimiters, uploadedFiles),
              columnMappings: rekeyByStoredFileName(columnMappings ?? {}, uploadedFiles),
              arcgisImportSession: arcgisImportSession ?? null
            },
            files: uploadedFiles.map(({ originalFileName, blob }) => ({
              fileName: blob.fileName,
              blobContainer: blob.blobContainer,
              blobName: blob.blobName,
              contentType: blob.contentType,
              byteSize: blob.byteSize,
              sourceFormat: blob.sourceFormat,
              formType: blob.formType,
              expectedRows: getExpectedRows(originalFileName, parsedData, arcgisImportSession)
            }))
          })
        });

        // The server responds 202 Accepted with { job, accepted: true } and
        // kicks the worker immediately, so processing may already be running.
        const jobPayload = (await jobResponse.json().catch(() => ({}))) as UploadJobResponse;
        if (!jobResponse.ok || !jobPayload.job?.jobID) {
          // A definitive HTTP rejection means no job owns these blobs.
          cleanupAllowed = !jobResponse.ok;
          throw new Error(jobPayload.error || jobPayload.details || `Failed to queue background upload job: HTTP ${jobResponse.status}`);
        }

        setIsDataUnsaved(false);
        if (cancelled) return;
        setQueuedJobID(jobPayload.job.jobID);
        setProgress(100);
        setCurrentStep('Background processing accepted.');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ailogger.error('[UploadAsyncJob] Failed to start async upload:', err);
        setUploadError(err);
        setErrorComponent('UploadAsyncJob');
        setReviewState(ReviewStates.ERRORS);
      } finally {
        if (cleanupAllowed && cleanupScope && uploadedFiles.length > 0) {
          await cleanupUploadedFiles(
            uploadedFiles.map(entry => entry.blob),
            cleanupScope
          );
        }
      }
    }

    runAsyncUpload();

    return () => {
      cancelled = true;
    };
  }, [
    acceptedFiles,
    arcgisImportSession,
    columnMappings,
    currentCensus?.dateRanges,
    currentCensus?.plotCensusNumber,
    currentPlot?.plotID,
    currentPlot?.plotName,
    currentSite?.schemaName,
    parsedData,
    selectedDelimiters,
    setErrorComponent,
    setIsDataUnsaved,
    setReviewState,
    setUploadError,
    sourceFormat,
    uploadForm,
    uploadMode
  ]);

  return (
    <Box sx={{ display: 'flex', flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', mt: 4, px: 3 }}>
      <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 640, alignItems: 'stretch' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          {queuedJobID ? <CheckCircleOutline color="success" /> : <CloudUploadOutlined color="primary" />}
          <Typography level="h4">{queuedJobID ? 'Upload accepted' : 'Starting background upload'}</Typography>
        </Stack>

        <LinearProgress determinate value={progress} aria-label="Async upload queueing progress" />

        <Typography level="body-sm" color="neutral">
          {currentStep}
        </Typography>

        {queuedJobID && (
          <Alert color="success" variant="soft">
            Job {queuedJobID} was accepted and is processing in the background. You can close this dialog; progress is shown in the upload job badge.
          </Alert>
        )}

        {queuedJobID && (
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Close</Button>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
