// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { SourceFormat } from '@/config/macros/formdetails';
import {
  MAX_UPLOAD_REQUEST_BODY_BYTES,
  UPLOAD_LENGTH_REQUIRED_MESSAGE,
  UPLOAD_UNREADABLE_MESSAGE,
  uploadRequestBodyTooLargeMessage
} from './upload-request-limits';

const mocks = vi.hoisted(() => ({ loggerWarn: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { warn: mocks.loggerWarn } }));

import { readUploadFormData } from './upload-request-body';

const BOUNDARY = '----forestgeoUploadBoundary';
const FILE_FIELD = 'census2.csv';
const FILE_CONTENT = 'tag,stemtag,spcode\r\n010001,010001,DICHGL\r\n';
const CONTEXT = { route: '/api/files/upload', schema: 'forestgeo_rabi', fileName: FILE_FIELD, sourceFormat: SourceFormat.csv };
const TRUNCATED_TAIL_BYTES = 20;

function multipartBody(): string {
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="${FILE_FIELD}"; filename="${FILE_FIELD}"\r\n` +
    'Content-Type: text/csv\r\n\r\n' +
    FILE_CONTENT +
    `\r\n--${BOUNDARY}--\r\n`
  );
}

function uploadRequest(body: string | null, contentLength: string | null): Request {
  const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
  if (contentLength !== null) headers['content-length'] = contentLength;
  return new Request('http://localhost/api/files/upload', { method: 'POST', body, headers });
}

async function rejectionBody(result: Awaited<ReturnType<typeof readUploadFormData>>) {
  expect(result.rejection, 'expected a rejection response').not.toBeNull();
  return { status: result.rejection!.status, body: await result.rejection!.json() };
}

describe('readUploadFormData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the parsed form for a complete body whose declared length is within the ceiling', async () => {
    const body = multipartBody();
    const result = await readUploadFormData(uploadRequest(body, String(Buffer.byteLength(body))), CONTEXT);

    expect(result.rejection, 'a well-formed upload must not be rejected').toBeNull();
    const file = result.formData!.get(FILE_FIELD) as File;
    expect(file.size, 'parsed file size').toBe(Buffer.byteLength(FILE_CONTENT));
  });

  it('answers 411 when Content-Length is missing, without reading the body', async () => {
    const request = uploadRequest(multipartBody(), null);
    const formDataSpy = vi.spyOn(request, 'formData');

    const { status, body } = await rejectionBody(await readUploadFormData(request, CONTEXT));

    expect(status, JSON.stringify(body)).toBe(HTTPResponses.LENGTH_REQUIRED);
    expect(body.error).toBe(UPLOAD_LENGTH_REQUIRED_MESSAGE);
    expect(formDataSpy, 'body must not be parsed without a declared length').not.toHaveBeenCalled();
  });

  it('answers 411 when Content-Length is not a non-negative integer', async () => {
    const { status } = await rejectionBody(await readUploadFormData(uploadRequest(null, 'abc'), CONTEXT));
    expect(status).toBe(HTTPResponses.LENGTH_REQUIRED);
  });

  it('answers 413 with the request-body message when the declared length exceeds the ceiling, without reading the body', async () => {
    const overCeiling = String(MAX_UPLOAD_REQUEST_BODY_BYTES + 1);
    const request = uploadRequest(null, overCeiling);
    const formDataSpy = vi.spyOn(request, 'formData');

    const { status, body } = await rejectionBody(await readUploadFormData(request, CONTEXT));

    expect(status, `declared ${overCeiling} vs ceiling ${MAX_UPLOAD_REQUEST_BODY_BYTES}`).toBe(HTTPResponses.PAYLOAD_TOO_LARGE);
    expect(body.error).toBe(uploadRequestBodyTooLargeMessage(SourceFormat.csv));
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it('accepts a declared length exactly at the ceiling (the guard is not off by one)', async () => {
    const request = uploadRequest(null, String(MAX_UPLOAD_REQUEST_BODY_BYTES));
    vi.spyOn(request, 'formData').mockResolvedValue(new FormData());

    const result = await readUploadFormData(request, CONTEXT);

    expect(result.rejection, `declared exactly ${MAX_UPLOAD_REQUEST_BODY_BYTES}`).toBeNull();
  });

  it('answers 400 "could not be read" for a truncated multipart body and logs the parser failure', async () => {
    const full = multipartBody();
    const truncated = full.slice(0, full.length - TRUNCATED_TAIL_BYTES);

    const { status, body } = await rejectionBody(await readUploadFormData(uploadRequest(truncated, String(Buffer.byteLength(truncated))), CONTEXT));

    expect(status, JSON.stringify(body)).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body.error).toBe(UPLOAD_UNREADABLE_MESSAGE);
    expect(body.error).not.toMatch(/File is required/);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    const [warning, context] = mocks.loggerWarn.mock.calls[0];
    expect(warning).toContain('Failed to parse body as FormData');
    expect(context).toMatchObject({
      route: CONTEXT.route,
      schema: CONTEXT.schema,
      fileName: CONTEXT.fileName,
      declaredContentLength: Buffer.byteLength(truncated)
    });
  });

  it('rethrows errors that are not body-parse failures', async () => {
    const request = uploadRequest(null, '10');
    const unexpected = new RangeError('unexpected failure');
    vi.spyOn(request, 'formData').mockRejectedValue(unexpected);

    await expect(readUploadFormData(request, CONTEXT)).rejects.toBe(unexpected);
  });
});
