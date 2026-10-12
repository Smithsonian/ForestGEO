import { NextResponse } from 'next/server';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import type { SourceFormat } from '@/config/macros/formdetails';
import {
  MAX_UPLOAD_REQUEST_BODY_BYTES,
  UPLOAD_LENGTH_REQUIRED_MESSAGE,
  UPLOAD_UNREADABLE_MESSAGE,
  uploadRequestBodyTooLargeMessage
} from './upload-request-limits';

const CONTENT_LENGTH_HEADER = 'content-length';
const NON_NEGATIVE_INTEGER = /^\d+$/;

export interface UploadRequestContext {
  route: string;
  schema: string | null;
  fileName: string | null;
  sourceFormat: SourceFormat | null;
}

export type UploadFormDataResult = { formData: FormData; rejection: null } | { formData: null; rejection: NextResponse };

function declaredContentLength(request: Request): number | null {
  const raw = request.headers.get(CONTENT_LENGTH_HEADER)?.trim();
  return raw && NON_NEGATIVE_INTEGER.test(raw) ? Number(raw) : null;
}

function rejectWith(error: string, status: HTTPResponses): UploadFormDataResult {
  return { formData: null, rejection: NextResponse.json({ error }, { status }) };
}

// Call after authentication. The upload routes are excluded from middleware, so this guard is what
// bounds how much of an authenticated request body the server will buffer.
export async function readUploadFormData(request: Request, context: UploadRequestContext): Promise<UploadFormDataResult> {
  const contentLength = declaredContentLength(request);
  if (contentLength === null) {
    return rejectWith(UPLOAD_LENGTH_REQUIRED_MESSAGE, HTTPResponses.LENGTH_REQUIRED);
  }
  if (contentLength > MAX_UPLOAD_REQUEST_BODY_BYTES) {
    ailogger.warn(`Upload request body over the ${MAX_UPLOAD_REQUEST_BODY_BYTES}-byte ceiling on ${context.route}`, {
      route: context.route,
      schema: context.schema,
      fileName: context.fileName,
      declaredContentLength: contentLength
    });
    return rejectWith(uploadRequestBodyTooLargeMessage(context.sourceFormat), HTTPResponses.PAYLOAD_TOO_LARGE);
  }

  try {
    return { formData: await request.formData(), rejection: null };
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    ailogger.warn(`Unreadable upload body on ${context.route}: ${error.message}`, {
      route: context.route,
      schema: context.schema,
      fileName: context.fileName,
      declaredContentLength: contentLength
    });
    return rejectWith(UPLOAD_UNREADABLE_MESSAGE, HTTPResponses.INVALID_REQUEST);
  }
}
