export const BACKGROUND_JOB_TYPES = ['upload_validation'] as const;
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

export const BACKGROUND_JOB_STATUSES = ['created', 'queued', 'running', 'waiting_retry', 'completed', 'failed', 'cancelled', 'dead_lettered'] as const;
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

export const UPLOAD_JOB_PHASES = [
  'created',
  'blob_received',
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
  lastMessageID: string | null;
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
