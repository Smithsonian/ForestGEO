import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import moment from 'moment';
import { HTTPResponses } from '@/config/macros';
import { FileRow, FileRowSet, FormType, RequiredTableHeadersByFormType, SourceFormat, getTableHeaders } from '@/config/macros/formdetails';
import { getContainerClient } from '@/config/macros/azurestorage';
import { generateShortBatchID } from '@/config/utils';
import { UploadMode, normalizeUploadMode } from '@/config/uploadmodes';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { aliasesFor } from '@/lib/column-mapping/fields';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { chooseEffectiveCsvMapping } from '@/lib/column-mapping/mapping';
import { CSV_RESOLVE_OPTIONS, collapseRowWithPlan, planColumnCountMatches, resolveHeaders, transformHeaderFromPlan } from '@/lib/column-mapping/resolution';
import {
  claimBackgroundJobForWorker,
  getBackgroundJob,
  markBackgroundJobCompleted,
  markBackgroundJobFailed,
  setBackgroundJobStatus,
  updateBackgroundJobFileStatus
} from '@/lib/background-jobs/repository';
import type { BackgroundJobFileRecord, BackgroundJobWithDetails, UploadJobPhase } from '@/lib/background-jobs/types';
import { INTERNAL_UPLOAD_WORKER_TOKEN_HEADER, isInternalUploadWorkerRequest } from '@/lib/background-jobs/internal-auth';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
const QUADRAT_MISMATCH_PROCEDURE = 'ValidateQuadratMismatchAcrossCensuses';
const COORDINATE_DRIFT_PROCEDURE = 'ValidateCoordinateDriftAcrossCensuses';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

interface ParsedUploadFile {
  rows: FileRow[];
  invalidRows: FileRow[];
  totalRows: number;
}

interface MeasurementFileResult {
  file: BackgroundJobFileRecord;
  batchID: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

interface ArcgisImportPayload {
  importSessionId?: string;
  fileName?: string;
  rowCount?: number;
}

function parseJobID(value: string): number | null {
  const jobID = Number(value);
  return Number.isSafeInteger(jobID) && jobID > 0 ? jobID : null;
}

function getWorkerToken(): string {
  const token = process.env.ASYNC_UPLOAD_WORKER_TOKEN?.trim();
  if (!token) throw new Error('ASYNC_UPLOAD_WORKER_TOKEN is not configured');
  return token;
}

function getChunkRowCount(): number {
  const configured = Number(process.env.BACKGROUND_UPLOAD_CHUNK_ROWS ?? 5000);
  return Number.isInteger(configured) && configured > 0 ? configured : 5000;
}

function getPayloadRecord(job: BackgroundJobWithDetails): Record<string, unknown> {
  return job.payload && typeof job.payload === 'object' ? job.payload : {};
}

function getRecordPayload<T extends Record<string, unknown>>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T);
}

function legacyTransformHeader(header: string): string {
  const normalizedHeader = header
    .trim()
    .toLowerCase()
    .replace(/[_\s-]/g, '');
  const headerMappings: Record<string, string> = {
    tag: 'tag',
    treetag: 'tag',
    stemtag: 'stemtag',
    stem: 'stemtag',
    spcode: 'spcode',
    species: 'spcode',
    speciescode: 'spcode',
    sp: 'spcode',
    quadrat: 'quadrat',
    quad: 'quadrat',
    quadratname: 'quadrat',
    lx: 'lx',
    localx: 'lx',
    x: 'lx',
    xcoord: 'lx',
    ly: 'ly',
    localy: 'ly',
    y: 'ly',
    ycoord: 'ly',
    dbh: 'dbh',
    diameter: 'dbh',
    hom: 'hom',
    height: 'hom',
    heightofmeasurement: 'hom',
    date: 'date',
    measurementdate: 'date',
    dateof: 'date',
    codes: 'codes',
    code: 'codes',
    attributes: 'codes',
    attributecodes: 'codes',
    comments: 'comments',
    comment: 'comments',
    description: 'comments',
    notes: 'comments'
  };
  return headerMappings[normalizedHeader] ?? normalizedHeader;
}

function detectDelimiter(text: string, fileName: string, selectedDelimiter?: unknown): string {
  if (typeof selectedDelimiter === 'string' && selectedDelimiter.length > 0) return selectedDelimiter;

  const candidates = [',', '\t', ';', '|'];
  const lines = text
    .split(/\r?\n/)
    .slice(0, 20)
    .filter(line => line.trim().length > 0);

  let best = fileName.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  let bestScore = 0;

  for (const delimiter of candidates) {
    const counts = lines.map(line => line.split(delimiter).length).filter(count => count > 1);
    if (counts.length === 0) continue;
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const consistency = counts.filter(count => count === counts[0]).length / counts.length;
    const score = average * consistency;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }

  return best;
}

function extractCsvHeaderRow(text: string, delimiter: string): string[] {
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    preview: 1,
    skipEmptyLines: true
  });
  const firstRow = parsed.data[0];
  return Array.isArray(firstRow) ? firstRow.map(value => String(value ?? '')) : [];
}

function transformValue(value: string, field: string, formType: FormType): unknown {
  if (value === 'NA' || value === 'NULL' || value === '') return null;

  if (formType === FormType.measurements && field === 'date') {
    const dateFormats = [
      'YYYY-MM-DD',
      'MM/DD/YYYY',
      'DD/MM/YYYY',
      'YYYY/MM/DD',
      'MM-DD-YYYY',
      'DD-MM-YYYY',
      'YYYY.MM.DD',
      'MM.DD.YYYY',
      'DD.MM.YYYY',
      'MMMM DD, YYYY',
      'MMM DD, YYYY',
      'DD MMM YYYY',
      'DD MMMM YYYY',
      'YYYY-MM-DD HH:mm:ss',
      'MM/DD/YYYY HH:mm:ss',
      'DD/MM/YYYY HH:mm:ss',
      'YYYY-MM-DDTHH:mm:ss',
      'YYYY-MM-DDTHH:mm:ss.SSS',
      'YYYY-MM-DDTHH:mm:ss.SSSZ'
    ];

    for (const format of dateFormats) {
      const parsed = moment(value.trim(), format, true);
      if (parsed.isValid()) return parsed.toDate();
    }

    const flexible = moment(value.trim());
    return flexible.isValid() ? flexible.toDate() : value;
  }

  if (formType === FormType.measurements && (field === 'lx' || field === 'ly')) {
    const numValue = Number.parseFloat(value);
    if (!Number.isNaN(numValue)) return Math.round(numValue * 1000000) / 1000000;
  }

  if (formType === FormType.measurements && (field === 'dbh' || field === 'hom')) {
    const numValue = Number.parseFloat(value);
    if (!Number.isNaN(numValue)) return Math.round(numValue * 100) / 100;
  }

  return value;
}

function validateParsedRow(row: FileRow, requiredHeaders: { label: string }[], delimiter: string, formType: FormType): string[] {
  const errors: string[] = [];

  const missingFields = requiredHeaders.filter(header => {
    const value = row[header.label];
    return value === null || value === '' || value === 'NA' || value === 'NULL' || value === undefined;
  });
  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.map(field => field.label).join(', ')}`);
  }

  if (row.__parsed_extra !== undefined) {
    errors.push('Row contains more columns than the header row');
  }

  if (formType === FormType.measurements) {
    const tag = row.tag;
    const stemtag = row.stemtag;
    if (tag && stemtag) {
      const tagText = String(tag);
      const stemTagText = String(stemtag);
      if (tagText.includes(delimiter) || stemTagText.includes(delimiter)) {
        errors.push(`Tag values contain delimiter character "${delimiter}"`);
      }
      if (tagText.length > 50 || stemTagText.length > 50) {
        errors.push('Unusually long tag or stemtag value detected');
      }
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined && !['tag', 'stemtag'].includes(key)) {
      const num = Number.parseFloat(String(value));
      if (!Number.isNaN(num) && (num < 0 || num > 999999.999999)) {
        errors.push(`Decimal value for ${key} is out of range: ${value}`);
      }
    }
  }

  return errors;
}

function parseCsvUploadFile(
  text: string,
  fileName: string,
  formType: FormType,
  uploadMode: UploadMode,
  delimiter: string,
  usesSubquadrats: boolean,
  columnMapping?: ColumnMapping
): ParsedUploadFile {
  const requiredHeaders = RequiredTableHeadersByFormType[formType];
  const expectedHeaders = getTableHeaders(formType, usesSubquadrats);
  if (!requiredHeaders || !expectedHeaders) {
    throw new Error(`No headers are defined for form type ${formType}`);
  }

  const csvHeaders = extractCsvHeaderRow(text, delimiter);
  const mappingRequired = formType === FormType.measurements && uploadMode !== UploadMode.REVISIONS;
  const headerPlan =
    mappingRequired && csvHeaders.length > 0
      ? (() => {
          const chosen = chooseEffectiveCsvMapping(columnMapping, csvHeaders);
          return resolveHeaders(csvHeaders, chosen.mapping, aliasesFor(SourceFormat.csv), CSV_RESOLVE_OPTIONS);
        })()
      : null;
  const transformHeader = headerPlan ? transformHeaderFromPlan(headerPlan) : legacyTransformHeader;

  const parsed = Papa.parse<FileRow>(text, {
    delimiter,
    header: true,
    skipEmptyLines: true,
    transformHeader,
    transform: (value, field) => transformValue(value, String(field), formType) as string
  });

  if (parsed.errors.length > 0) {
    const fatalError = parsed.errors.find(error => error.type === 'Delimiter' || error.type === 'Quotes');
    if (fatalError) {
      throw new Error(`CSV parse failed for ${fileName}: ${fatalError.message}`);
    }
  }

  if (headerPlan && Array.isArray(parsed.meta.fields) && !planColumnCountMatches(headerPlan, parsed.meta.fields.length)) {
    throw new Error(
      `Header plan misalignment for ${fileName}: mapping plan has ${headerPlan.outputKeys.length} columns but PapaParse parsed ${parsed.meta.fields.length}`
    );
  }

  const rows: FileRow[] = [];
  const invalidRows: FileRow[] = [];

  for (const rawRow of parsed.data) {
    const row = headerPlan ? collapseRowWithPlan(rawRow, headerPlan) : rawRow;
    const errors = validateParsedRow(row, requiredHeaders, delimiter, formType);
    if (errors.length > 0) {
      invalidRows.push({ ...row, failureReason: errors.join('|') });
    } else {
      rows.push(row);
    }
  }

  return {
    rows,
    invalidRows,
    totalRows: parsed.data.length
  };
}

async function downloadBlobText(file: BackgroundJobFileRecord): Promise<string> {
  const containerClient = await getContainerClient(file.blobContainer, { createIfMissing: false });
  const buffer = await containerClient.getBlobClient(file.blobName).downloadToBuffer();
  return buffer.toString('utf8');
}

function buildFileRowSet(rows: FileRow[], startIndex: number): FileRowSet {
  return rows.reduce((acc, row, index) => {
    acc[`row-${startIndex + index + 1}`] = row;
    return acc;
  }, {} as FileRowSet);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Lock wait timeout') ||
    error.message.includes('Deadlock') ||
    error.message.includes('Connection lost') ||
    error.message.includes('server has gone away') ||
    error.message.includes('ECONNRESET') ||
    error.message.includes('PROTOCOL_CONNECTION_LOST') ||
    error.message.includes('HTTP 429') ||
    error.message.includes('HTTP 500') ||
    error.message.includes('HTTP 502') ||
    error.message.includes('HTTP 503') ||
    error.message.includes('HTTP 504')
  );
}

async function readResponsePayload(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function fetchJsonWithRetry(origin: string, path: string, init: RequestInit, maxAttempts = 5): Promise<any> {
  const token = getWorkerToken();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        [INTERNAL_UPLOAD_WORKER_TOKEN_HEADER]: token,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    });
    const payload = await readResponsePayload(response);

    if (response.ok) return payload;

    lastError = new Error(payload?.error || payload?.details || payload?.message || `HTTP ${response.status}`);
    if (!isRetryableStatus(response.status) || attempt >= maxAttempts) {
      throw lastError;
    }

    await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 15000) + Math.random() * 500);
  }

  throw lastError ?? new Error(`Request failed: ${path}`);
}

async function readValidationStream<T>(response: Response): Promise<T> {
  const body = response.body;
  if (!body) throw new Error('Validation response body is empty');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const message = JSON.parse(trimmed);
        if (message.type === 'heartbeat') continue;
        if (message.type === 'error') throw new Error(message.message);
        if (message.type === 'result') return message.data as T;
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error('Validation stream ended without a result');
}

async function fetchValidationStream(origin: string, path: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_UPLOAD_WORKER_TOKEN_HEADER]: getWorkerToken() },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await readResponsePayload(response);
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return readValidationStream(response);
}

async function patchValidationRun(origin: string, schema: string, runID: number | null, update: Record<string, unknown>): Promise<void> {
  if (runID === null) return;
  await fetchJsonWithRetry(origin, '/api/validations/run', {
    method: 'PATCH',
    body: JSON.stringify({ schema, runID, ...update })
  });
}

async function runServerValidation(origin: string, job: BackgroundJobWithDetails): Promise<void> {
  const schema = job.schemaName;
  const plotID = job.plotID;
  const censusID = job.censusID;

  const listData = await fetchJsonWithRetry(origin, `/api/validations/validationlist?schema=${encodeURIComponent(schema)}`, { method: 'GET' });
  const validationMessages: ValidationMessages = listData?.coreValidations || {};
  const allNames = Object.keys(validationMessages);
  const hasCombinedDBH = Boolean(validationMessages[DBH_GROWTH_PROCEDURE] && validationMessages[DBH_SHRINKAGE_PROCEDURE]);
  const hasCombinedCrossCensus = Boolean(validationMessages[QUADRAT_MISMATCH_PROCEDURE] && validationMessages[COORDINATE_DRIFT_PROCEDURE]);
  const combinedNames = new Set<string>();
  if (hasCombinedDBH) {
    combinedNames.add(DBH_GROWTH_PROCEDURE);
    combinedNames.add(DBH_SHRINKAGE_PROCEDURE);
  }
  if (hasCombinedCrossCensus) {
    combinedNames.add(QUADRAT_MISMATCH_PROCEDURE);
    combinedNames.add(COORDINATE_DRIFT_PROCEDURE);
  }

  const tasks = allNames
    .filter(name => !combinedNames.has(name))
    .map(name => ({
      name,
      run: async () => {
        const message = validationMessages[name];
        const result = await fetchValidationStream(origin, `/api/validations/procedures/${encodeURIComponent(name)}`, {
          schema,
          validationProcedureID: message.id,
          cursorQuery: message.definition,
          p_CensusID: censusID,
          p_PlotID: plotID
        });
        if (result === false) throw new Error(`Validation returned failure for ${name}`);
      }
    }));

  if (hasCombinedDBH) {
    tasks.push({
      name: `${DBH_GROWTH_PROCEDURE}+${DBH_SHRINKAGE_PROCEDURE}`,
      run: async () => {
        const result = await fetchValidationStream(origin, '/api/validations/procedures/shared-dbh', { schema, p_CensusID: censusID, p_PlotID: plotID });
        if (!result?.success) throw new Error(result?.error || 'Shared DBH validation failed');
      }
    });
  }

  if (hasCombinedCrossCensus) {
    tasks.push({
      name: `${QUADRAT_MISMATCH_PROCEDURE}+${COORDINATE_DRIFT_PROCEDURE}`,
      run: async () => {
        const result = await fetchValidationStream(origin, '/api/validations/procedures/shared-cross-census-location', {
          schema,
          p_CensusID: censusID,
          p_PlotID: plotID
        });
        if (!result?.success) throw new Error(result?.error || 'Shared cross-census location validation failed');
      }
    });
  }

  if (tasks.length === 0) return;

  const createData = await fetchJsonWithRetry(origin, '/api/validations/run', {
    method: 'POST',
    body: JSON.stringify({ schema, plotID, censusID, totalSteps: tasks.length })
  });
  if (createData?.conflict) return;

  const runID = Number.isFinite(Number(createData?.runID)) ? Number(createData.runID) : null;
  let completedSteps = 0;
  let failedSteps = 0;
  const errorMessages: string[] = [];

  for (const task of tasks) {
    await patchValidationRun(origin, schema, runID, { currentStep: task.name });
    try {
      await task.run();
      completedSteps++;
    } catch (error) {
      failedSteps++;
      const err = error instanceof Error ? error : new Error(String(error));
      errorMessages.push(`Failed: ${task.name} - ${err.message}`);
    }
    await patchValidationRun(origin, schema, runID, {
      completedSteps,
      failedSteps,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined
    });
  }

  if (failedSteps === 0) {
    await fetchJsonWithRetry(origin, '/api/validations/updatepassedvalidations', {
      method: 'POST',
      body: JSON.stringify({ schema, plotID, censusID })
    });
  }

  await fetchJsonWithRetry(origin, `/api/refreshviews/measurementssummary/${encodeURIComponent(schema)}`, {
    method: 'POST',
    body: JSON.stringify({ plotID, censusID })
  });
  await fetchJsonWithRetry(origin, `/api/refreshviews/viewfulltable/${encodeURIComponent(schema)}`, {
    method: 'POST',
    body: JSON.stringify({ plotID, censusID })
  });

  await patchValidationRun(origin, schema, runID, {
    status: failedSteps > 0 ? 'failed' : 'completed',
    completedSteps,
    failedSteps,
    errorMessages: errorMessages.length > 0 ? errorMessages : undefined
  });

  if (failedSteps > 0) {
    throw new Error(`Validation completed with ${failedSteps} failed step(s): ${errorMessages.join('; ')}`);
  }
}

async function updateJobProgress(
  catalogPool: ReturnType<typeof getPoolMonitorInstance>['pool'],
  jobID: number,
  phase: UploadJobPhase,
  percentComplete: number,
  message: string,
  processedRows?: number,
  failedRows?: number
): Promise<void> {
  await setBackgroundJobStatus(catalogPool, jobID, {
    status: 'running',
    phase,
    percentComplete,
    processedRows,
    failedRows,
    lastError: null,
    eventType: phase,
    eventMessage: message
  });
}

async function insertInvalidMeasurementRows(
  origin: string,
  job: BackgroundJobWithDetails,
  fileName: string,
  batchID: string,
  invalidRows: FileRow[]
): Promise<void> {
  if (invalidRows.length === 0) return;

  await fetchJsonWithRetry(
    origin,
    `/api/batchedupload/${encodeURIComponent(job.schemaName)}/${job.plotID}/${job.censusID}?fileID=${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      body: JSON.stringify(
        invalidRows.map(row => ({
          plotID: job.plotID,
          censusID: job.censusID,
          tag: row.tag || null,
          stemTag: row.stemtag || null,
          spCode: row.spcode || null,
          quadrat: row.quadrat || null,
          x: row.lx || null,
          y: row.ly || null,
          dbh: row.dbh || null,
          hom: row.hom || null,
          date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
          codes: row.codes || null,
          comments: row.comments || null,
          fileID: fileName,
          batchID,
          failureReasons: row.failureReason || 'Unknown parse error'
        }))
      )
    }
  );
}

async function processMeasurementUpload(origin: string, job: BackgroundJobWithDetails, workerID: string): Promise<void> {
  const catalogPool = getPoolMonitorInstance().pool;
  const payload = getPayloadRecord(job);
  const selectedDelimiters = getRecordPayload<Record<string, string>>(payload, 'selectedDelimiters');
  const columnMappings = getRecordPayload<Record<string, ColumnMapping>>(payload, 'columnMappings');
  const usesSubquadrats = payload.usesSubquadrats === true;
  const uploadMode = normalizeUploadMode(job.uploadMode);
  const chunkRows = getChunkRowCount();
  let processedRows = 0;
  let failedRows = 0;
  const fileResults: MeasurementFileResult[] = [];

  for (let fileIndex = 0; fileIndex < job.files.length; fileIndex++) {
    const file = job.files[fileIndex];
    await updateJobProgress(catalogPool, job.jobID, 'staging', 5 + Math.floor((fileIndex / job.files.length) * 35), `Downloading ${file.fileName}`);
    await updateBackgroundJobFileStatus(catalogPool, file.jobFileID, { status: 'staged', processedRows: 0, failedRows: 0, errorMessage: null });

    const text = await downloadBlobText(file);
    const delimiter = detectDelimiter(text, file.fileName, selectedDelimiters[file.fileName]);
    const parsed = parseCsvUploadFile(text, file.fileName, FormType.measurements, uploadMode, delimiter, usesSubquadrats, columnMappings[file.fileName]);
    const batchID = generateShortBatchID();
    failedRows += parsed.invalidRows.length;

    await insertInvalidMeasurementRows(origin, job, file.fileName, batchID, parsed.invalidRows);

    for (let start = 0; start < parsed.rows.length; start += chunkRows) {
      const chunk = parsed.rows.slice(start, start + chunkRows);
      const fileRowSet = buildFileRowSet(chunk, start);
      await fetchJsonWithRetry(origin, '/api/sqlpacketload', {
        method: 'POST',
        body: JSON.stringify({
          schema: job.schemaName,
          formType: FormType.measurements,
          sourceFormat: SourceFormat.csv,
          uploadMode,
          fileName: file.fileName,
          plot: { plotID: job.plotID, usesSubquadrats },
          census: { dateRanges: [{ censusID: job.censusID }] },
          user: job.createdBy,
          fileRowSet,
          batchID,
          workerID
        })
      });
      processedRows += chunk.length;
      await updateJobProgress(
        catalogPool,
        job.jobID,
        'staging',
        10 + Math.floor(((fileIndex + (start + chunk.length) / Math.max(parsed.rows.length, 1)) / job.files.length) * 35),
        `Staged ${processedRows} measurement row(s)`,
        processedRows,
        failedRows
      );
      await updateBackgroundJobFileStatus(catalogPool, file.jobFileID, {
        status: 'staged',
        processedRows: Math.min(start + chunk.length, parsed.rows.length),
        failedRows: parsed.invalidRows.length,
        errorMessage: null
      });
    }

    if (parsed.rows.length > 0) {
      const verify = await fetchJsonWithRetry(
        origin,
        `/api/verifyupload?schema=${encodeURIComponent(job.schemaName)}&fileName=${encodeURIComponent(file.fileName)}&batchID=${encodeURIComponent(batchID)}&plotID=${job.plotID}&censusID=${job.censusID}`,
        { method: 'GET' }
      );
      if (Number(verify?.count ?? 0) !== parsed.rows.length) {
        throw new Error(`Upload verification failed for ${file.fileName}: expected ${parsed.rows.length}, found ${verify?.count ?? 0}`);
      }
    }

    fileResults.push({ file, batchID, totalRows: parsed.totalRows, validRows: parsed.rows.length, invalidRows: parsed.invalidRows.length });
  }

  for (let fileIndex = 0; fileIndex < fileResults.length; fileIndex++) {
    const result = fileResults[fileIndex];
    if (result.validRows === 0) {
      await updateBackgroundJobFileStatus(catalogPool, result.file.jobFileID, {
        status: result.invalidRows > 0 ? 'failed' : 'skipped',
        processedRows: 0,
        failedRows: result.invalidRows,
        errorMessage: result.invalidRows > 0 ? 'All rows were rejected during parsing' : null
      });
      continue;
    }

    await updateJobProgress(
      catalogPool,
      job.jobID,
      'ingestion',
      45 + Math.floor((fileIndex / Math.max(fileResults.length, 1)) * 25),
      `Processing ${result.file.fileName}`,
      processedRows,
      failedRows
    );
    await fetchJsonWithRetry(
      origin,
      `/api/setupbulkprocedure/${encodeURIComponent(result.file.fileName)}/${encodeURIComponent(result.batchID)}?schema=${encodeURIComponent(job.schemaName)}`,
      { method: 'GET' },
      2
    );
    await updateBackgroundJobFileStatus(catalogPool, result.file.jobFileID, {
      status: 'processed',
      processedRows: result.validRows,
      failedRows: result.invalidRows,
      errorMessage: null
    });
  }

  await updateJobProgress(catalogPool, job.jobID, 'collapsing', 72, 'Consolidating processed measurements', processedRows, failedRows);
  await fetchJsonWithRetry(origin, `/api/setupbulkcollapser/${job.censusID}?schema=${encodeURIComponent(job.schemaName)}`, { method: 'GET' }, 2);

  for (const result of fileResults) {
    await fetchJsonWithRetry(
      origin,
      `/api/verifysession?schema=${encodeURIComponent(job.schemaName)}&plotID=${job.plotID}&censusID=${job.censusID}&fileID=${encodeURIComponent(result.file.fileName)}`,
      { method: 'GET' }
    );
  }

  await updateJobProgress(catalogPool, job.jobID, 'validation', 82, 'Running validation checks', processedRows, failedRows);
  await runServerValidation(origin, job);
  await updateJobProgress(catalogPool, job.jobID, 'refreshing_views', 98, 'Finalizing refreshed views', processedRows, failedRows);
}

async function processArcgisUpload(origin: string, job: BackgroundJobWithDetails): Promise<void> {
  const catalogPool = getPoolMonitorInstance().pool;
  const payload = getPayloadRecord(job);
  const arcgisImportSession = (
    payload.arcgisImportSession && typeof payload.arcgisImportSession === 'object' ? payload.arcgisImportSession : null
  ) as ArcgisImportPayload | null;

  if (!arcgisImportSession?.importSessionId || !arcgisImportSession.fileName) {
    throw new Error('ArcGIS async upload job is missing its pre-flight import session reference');
  }

  const uploadMode = normalizeUploadMode(job.uploadMode);
  let processedRows = 0;
  let failedRows = 0;
  const fileResults: MeasurementFileResult[] = [];

  for (let fileIndex = 0; fileIndex < job.files.length; fileIndex++) {
    const file = job.files[fileIndex];
    if (file.fileName !== arcgisImportSession.fileName) {
      throw new Error(`ArcGIS async upload file ${file.fileName} does not match pre-flight file ${arcgisImportSession.fileName}`);
    }

    const batchID = generateShortBatchID();
    await updateJobProgress(catalogPool, job.jobID, 'staging', 10 + Math.floor((fileIndex / job.files.length) * 35), `Committing ${file.fileName}`);
    await updateBackgroundJobFileStatus(catalogPool, file.jobFileID, { status: 'staged', processedRows: 0, failedRows: 0, errorMessage: null });

    const commitResult = await fetchJsonWithRetry(origin, '/api/arcgis/commit', {
      method: 'POST',
      body: JSON.stringify({
        schema: job.schemaName,
        plotID: job.plotID,
        censusID: job.censusID,
        importSessionId: arcgisImportSession.importSessionId,
        fileName: file.fileName,
        batchID,
        uploadMode,
        userId: job.createdBy,
        uploadSessionID: `async-job-${job.jobID}`
      })
    });
    const rowCount = Number(commitResult?.rowCount ?? arcgisImportSession.rowCount ?? file.expectedRows ?? 0);
    processedRows += rowCount;

    await updateBackgroundJobFileStatus(catalogPool, file.jobFileID, {
      status: 'staged',
      processedRows: rowCount,
      failedRows: 0,
      errorMessage: null
    });
    fileResults.push({ file, batchID, totalRows: rowCount, validRows: rowCount, invalidRows: 0 });
  }

  for (let fileIndex = 0; fileIndex < fileResults.length; fileIndex++) {
    const result = fileResults[fileIndex];
    await updateJobProgress(
      catalogPool,
      job.jobID,
      'ingestion',
      45 + Math.floor((fileIndex / Math.max(fileResults.length, 1)) * 25),
      `Processing ${result.file.fileName}`,
      processedRows,
      failedRows
    );
    await fetchJsonWithRetry(
      origin,
      `/api/setupbulkprocedure/${encodeURIComponent(result.file.fileName)}/${encodeURIComponent(result.batchID)}?schema=${encodeURIComponent(job.schemaName)}`,
      { method: 'GET' },
      2
    );
    await updateBackgroundJobFileStatus(catalogPool, result.file.jobFileID, {
      status: 'processed',
      processedRows: result.validRows,
      failedRows: 0,
      errorMessage: null
    });
  }

  await updateJobProgress(catalogPool, job.jobID, 'collapsing', 72, 'Consolidating processed ArcGIS measurements', processedRows, failedRows);
  await fetchJsonWithRetry(origin, `/api/setupbulkcollapser/${job.censusID}?schema=${encodeURIComponent(job.schemaName)}`, { method: 'GET' }, 2);

  for (const result of fileResults) {
    await fetchJsonWithRetry(
      origin,
      `/api/verifysession?schema=${encodeURIComponent(job.schemaName)}&plotID=${job.plotID}&censusID=${job.censusID}&fileID=${encodeURIComponent(result.file.fileName)}`,
      { method: 'GET' }
    );
  }

  await updateJobProgress(catalogPool, job.jobID, 'validation', 82, 'Running validation checks', processedRows, failedRows);
  await runServerValidation(origin, job);
  await updateJobProgress(catalogPool, job.jobID, 'refreshing_views', 98, 'Finalizing refreshed views', processedRows, failedRows);
}

async function processFixedDataUpload(origin: string, job: BackgroundJobWithDetails): Promise<void> {
  const catalogPool = getPoolMonitorInstance().pool;
  const payload = getPayloadRecord(job);
  const selectedDelimiters = getRecordPayload<Record<string, string>>(payload, 'selectedDelimiters');
  const formType = job.formType as FormType;
  const uploadMode = normalizeUploadMode(job.uploadMode);
  let processedRows = 0;
  let failedRows = 0;

  for (let fileIndex = 0; fileIndex < job.files.length; fileIndex++) {
    const file = job.files[fileIndex];
    await updateJobProgress(catalogPool, job.jobID, 'staging', 10 + Math.floor((fileIndex / job.files.length) * 50), `Processing ${file.fileName}`);
    const text = await downloadBlobText(file);
    const delimiter = detectDelimiter(text, file.fileName, selectedDelimiters[file.fileName]);
    const parsed = parseCsvUploadFile(text, file.fileName, formType, uploadMode, delimiter, false);
    processedRows += parsed.rows.length;
    failedRows += parsed.invalidRows.length;

    await fetchJsonWithRetry(origin, '/api/sqlpacketload', {
      method: 'POST',
      body: JSON.stringify({
        schema: job.schemaName,
        formType,
        sourceFormat: SourceFormat.csv,
        uploadMode,
        fileName: file.fileName,
        plot: { plotID: job.plotID },
        census: { dateRanges: [{ censusID: job.censusID }] },
        user: job.createdBy,
        fileRowSet: buildFileRowSet(parsed.rows, 0)
      })
    });

    await updateBackgroundJobFileStatus(catalogPool, file.jobFileID, {
      status: parsed.invalidRows.length > 0 ? 'failed' : 'processed',
      processedRows: parsed.rows.length,
      failedRows: parsed.invalidRows.length,
      errorMessage: parsed.invalidRows.length > 0 ? `${parsed.invalidRows.length} row(s) were rejected during parsing` : null
    });
    await updateJobProgress(
      catalogPool,
      job.jobID,
      'ingestion',
      40 + Math.floor(((fileIndex + 1) / job.files.length) * 50),
      `Processed ${processedRows} fixed-data row(s)`,
      processedRows,
      failedRows
    );
  }
}

async function processUploadJob(origin: string, job: BackgroundJobWithDetails, workerID: string): Promise<void> {
  const sourceFormat = job.sourceFormat || SourceFormat.csv;
  const formType = job.formType as FormType | null;
  if (!formType || !Object.values(FormType).includes(formType)) {
    throw new Error(`Unsupported upload form type: ${job.formType ?? 'missing'}`);
  }

  if (sourceFormat === SourceFormat.arcgis_xlsx) {
    if (formType !== FormType.measurements) {
      throw new Error(`${SourceFormat.arcgis_xlsx} async uploads are only supported for measurements`);
    }
    await processArcgisUpload(origin, job);
    return;
  }

  if (sourceFormat !== SourceFormat.csv) {
    throw new Error(`Async worker currently supports ${SourceFormat.csv} and ${SourceFormat.arcgis_xlsx} uploads; received ${sourceFormat}`);
  }

  if (formType === FormType.measurements) {
    await processMeasurementUpload(origin, job, workerID);
  } else {
    await processFixedDataUpload(origin, job);
  }
}

export async function POST(
  request: NextRequest,
  props: {
    params: Promise<{ jobId: string }>;
  }
) {
  if (process.env.ASYNC_UPLOAD_WORKER_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Async upload worker is disabled' }, { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }

  if (!isInternalUploadWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized worker request' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  const { jobId } = await props.params;
  const jobID = parseJobID(jobId);
  if (!jobID) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const body = await request.json().catch(() => ({}));
  const workerID = String(body.workerID || request.headers.get('x-worker-id') || `next:${Date.now()}`);
  const catalogPool = getPoolMonitorInstance().pool;

  const claimedJob = await claimBackgroundJobForWorker(catalogPool, jobID, workerID);
  if (!claimedJob) {
    const existing = await getBackgroundJob(catalogPool, jobID);
    return NextResponse.json(
      {
        skipped: true,
        reason: existing ? `Job is not claimable from status ${existing.status}` : 'Job not found',
        job: existing
      },
      { status: existing ? HTTPResponses.OK : HTTPResponses.NOT_FOUND }
    );
  }

  const origin = request.nextUrl.origin;

  try {
    await updateJobProgress(catalogPool, jobID, 'staging', 1, 'Worker started upload processing');
    await processUploadJob(origin, claimedJob, workerID);
    await markBackgroundJobCompleted(catalogPool, jobID);
    return NextResponse.json({ completed: true, jobID }, { status: HTTPResponses.OK });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    ailogger.error(`[UploadJobs Process API] Job ${jobID} failed:`, err);

    if (isRetryableError(err)) {
      ailogger.warn(`[UploadJobs Process API] Retryable error exhausted local retry budget for job ${jobID}: ${err.message}`);
    }

    await markBackgroundJobFailed(catalogPool, jobID, err);
    return NextResponse.json({ error: err.message, jobID }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
