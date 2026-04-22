import { SESSION_TIMEOUTS } from '@/config/uploadsessiontracker';

/**
 * A validation run older than this threshold is treated as stale (likely a
 * crashed worker that never updated its status) and does NOT block new
 * measurement-scope operations. Keep in sync between scopeguard and any
 * route that re-probes inside its own transaction.
 */
export const STALE_VALIDATION_RUN_THRESHOLD_MINUTES = 15;

export const ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS = Math.ceil(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);
