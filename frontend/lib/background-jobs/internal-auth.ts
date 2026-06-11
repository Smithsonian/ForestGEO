import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const INTERNAL_UPLOAD_WORKER_TOKEN_HEADER = 'x-forestgeo-upload-worker-token';

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isInternalUploadWorkerRequest(request: NextRequest | Request): boolean {
  const configuredToken = process.env.ASYNC_UPLOAD_WORKER_TOKEN?.trim();
  if (!configuredToken) return false;

  const suppliedToken = request.headers.get(INTERNAL_UPLOAD_WORKER_TOKEN_HEADER)?.trim();
  if (!suppliedToken) return false;

  return constantTimeEquals(suppliedToken, configuredToken);
}
