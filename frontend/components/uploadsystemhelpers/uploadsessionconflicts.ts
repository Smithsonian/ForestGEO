export interface UploadSessionConflictInfo {
  message: string;
  reason: string | null;
  sessionState: string | null;
  restartRequired: boolean;
}

const TERMINAL_UPLOAD_SESSION_STATES = new Set(['abandoned', 'cleaned_up', 'completed', 'failed']);

function getObjectProperty<T = unknown>(value: unknown, key: string): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, T | undefined>)[key];
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  const error = getObjectProperty<string>(payload, 'error');
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  const responseMessage = getObjectProperty<string>(payload, 'responseMessage');
  if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
    return responseMessage.trim();
  }

  return '';
}

export function getApiErrorMessage(payload: unknown): string | null {
  const message = extractErrorMessage(payload);
  return message.length > 0 ? message : null;
}

export function parseUploadSessionConflict(payload: unknown): UploadSessionConflictInfo | null {
  const message = extractErrorMessage(payload);
  if (!message) {
    return null;
  }

  const details = getObjectProperty<Record<string, unknown>>(payload, 'details');
  const responseMessage = getObjectProperty<string>(payload, 'responseMessage');
  const combinedMessage = `${responseMessage ?? ''} ${message}`.trim();
  const normalizedMessage = combinedMessage.toLowerCase();

  if (!normalizedMessage.includes('upload session')) {
    return null;
  }

  let sessionState =
    typeof details?.sessionState === 'string'
      ? details.sessionState.toLowerCase()
      : combinedMessage.match(/\bis in state\s+([a-z_]+)/i)?.[1]?.toLowerCase() ?? null;

  let reason =
    typeof details?.reason === 'string'
      ? details.reason
      : normalizedMessage.includes('expired before')
        ? 'stale_session'
        : normalizedMessage.includes('was not found')
          ? 'not_found'
          : normalizedMessage.includes('is required')
            ? 'missing_session'
            : normalizedMessage.includes('does not own')
              ? 'scope_mismatch'
              : normalizedMessage.includes('another upload is in progress')
                ? 'concurrent_upload'
                : normalizedMessage.includes('is in state')
                  ? 'invalid_state'
                  : null;

  if (sessionState && !TERMINAL_UPLOAD_SESSION_STATES.has(sessionState) && reason === 'invalid_state') {
    sessionState = sessionState.toLowerCase();
  }

  const restartRequired =
    reason === 'stale_session' || reason === 'not_found' || (sessionState !== null && TERMINAL_UPLOAD_SESSION_STATES.has(sessionState));

  return {
    message,
    reason,
    sessionState,
    restartRequired
  };
}

export class UploadSessionRestartRequiredError extends Error {
  conflict: UploadSessionConflictInfo | null;

  constructor(message: string, conflict: UploadSessionConflictInfo | null = null) {
    super(message);
    this.name = 'UploadSessionRestartRequiredError';
    this.conflict = conflict;
  }
}

export function isUploadSessionRestartRequiredError(error: unknown): error is UploadSessionRestartRequiredError {
  return error instanceof Error && error.name === 'UploadSessionRestartRequiredError';
}

export function buildUploadSessionRestartRequiredError(context: string, payload?: unknown): UploadSessionRestartRequiredError {
  const conflict = parseUploadSessionConflict(payload);

  if (conflict?.sessionState) {
    return new UploadSessionRestartRequiredError(
      `Upload session entered the '${conflict.sessionState}' state before ${context}. Restart the upload to create a fresh session.`,
      conflict
    );
  }

  if (conflict?.reason === 'not_found') {
    return new UploadSessionRestartRequiredError(
      `Upload session was no longer available before ${context}. Restart the upload to create a fresh session.`,
      conflict
    );
  }

  if (conflict?.reason === 'stale_session') {
    return new UploadSessionRestartRequiredError(
      `Upload session expired before ${context}. Restart the upload to create a fresh session.`,
      conflict
    );
  }

  return new UploadSessionRestartRequiredError(
    `Upload session expired before ${context}. Restart the upload to create a fresh session.`,
    conflict
  );
}

export async function readResponsePayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '');
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
