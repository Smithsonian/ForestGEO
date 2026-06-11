import { FormType, SourceFormat } from '@/config/macros/formdetails';

export const BACKGROUND_JOB_TYPES = ['upload_validation'] as const;
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

export const BACKGROUND_JOB_STATUSES = ['queued', 'running', 'cancel_requested', 'waiting_retry', 'completed', 'failed', 'cancelled'] as const;
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

export const UPLOAD_JOB_PHASES = [
  'queued',
  'staging',
  'ingestion',
  'collapsing',
  'validation',
  'refreshing_views',
  'completed',
  'failed',
  'cancelled'
] as const;
export type UploadJobPhase = (typeof UPLOAD_JOB_PHASES)[number];

export const UPLOAD_JOB_MAX_RETRIES = 3;

/**
 * The form-type/source-format pairs the async upload pipeline supports in v1.
 * Single source of truth shared by the creation route's guard (reject anything
 * the worker would refuse) and the worker's pipeline routing. Lives here
 * because types.ts is cycle-free: config/macros/formdetails is a leaf module.
 */
export const ASYNC_UPLOAD_V1_PIPELINES: ReadonlyArray<{ formType: FormType; sourceFormat: SourceFormat }> = [
  { formType: FormType.measurements, sourceFormat: SourceFormat.csv },
  { formType: FormType.measurements, sourceFormat: SourceFormat.arcgis_xlsx }
];

/**
 * Accepts plain strings (job records store formType/sourceFormat as nullable
 * strings) and compares against the string-valued enums in the allowlist.
 */
export function isAllowedAsyncPipeline(formType: string | null | undefined, sourceFormat: string | null | undefined): boolean {
  return ASYNC_UPLOAD_V1_PIPELINES.some(pipeline => pipeline.formType === formType && pipeline.sourceFormat === sourceFormat);
}

/**
 * Single owner of every PercentComplete value written to a job, keyed by
 * pipeline milestone. Lives in types.ts (not worker.ts) so the repository can
 * reference the terminal value without importing the worker (cycle risk).
 * Reported progress is clamped monotonically non-decreasing WITHIN AN ATTEMPT
 * because the per-file pipeline revisits earlier phases for later files; a
 * fresh attempt starts its clamp from zero again.
 */
export const UPLOAD_JOB_PHASE_PROGRESS = {
  claimed: 1,
  staging: 10,
  ingestion: 45,
  collapsing: 72,
  validation: 82,
  refreshingViews: 98,
  completed: 100
} as const;

export const BACKGROUND_JOB_FILE_STATUSES = ['pending', 'staged', 'processed', 'failed', 'skipped'] as const;
export type BackgroundJobFileStatus = (typeof BACKGROUND_JOB_FILE_STATUSES)[number];

export interface UploadJobFileInput {
  fileName: string;
  blobContainer: string;
  blobName: string;
  contentType?: string | null;
  byteSize?: number | null;
  checksumSha256?: string | null;
  sourceFormat?: string | null;
  formType?: string | null;
  expectedRows?: number | null;
}

export interface CreateUploadJobInput {
  schema: string;
  plotID: number;
  censusID: number;
  uploadMode?: string | null;
  sourceFormat?: string | null;
  formType?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
  files: UploadJobFileInput[];
}

export interface BackgroundJobRecord {
  jobID: number;
  jobType: BackgroundJobType;
  status: BackgroundJobStatus;
  phase: UploadJobPhase;
  schemaName: string;
  plotID: number;
  censusID: number;
  uploadMode: string | null;
  sourceFormat: string | null;
  formType: string | null;
  createdBy: string;
  idempotencyKey: string | null;
  percentComplete: number;
  totalFiles: number;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  workerID: string | null;
  workerHeartbeatAt: Date | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface BackgroundJobFileRecord {
  jobFileID: number;
  jobID: number;
  fileName: string;
  blobContainer: string;
  blobName: string;
  contentType: string | null;
  byteSize: number | null;
  checksumSha256: string | null;
  sourceFormat: string | null;
  formType: string | null;
  batchID: string | null;
  expectedRows: number | null;
  processedRows: number;
  failedRows: number;
  status: BackgroundJobFileStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackgroundJobEventRecord {
  eventID: number;
  jobID: number;
  eventType: string;
  message: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface BackgroundJobWithDetails extends BackgroundJobRecord {
  files: BackgroundJobFileRecord[];
  events: BackgroundJobEventRecord[];
}
