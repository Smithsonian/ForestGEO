/**
 * Content-Length is now MANDATORY on POST /api/uploadjobs, which is only a safe
 * policy if the supported client path actually sends it.
 *
 * That premise cannot be checked with `new Request(...)`: the WHATWG Request
 * constructor does not set Content-Length — the HTTP transport adds it when the
 * request is really sent, which is also why the route's unit tests have to set
 * the header themselves. So this test sends a real request over a real socket to
 * a real Node HTTP server, exactly as the upload wizard does (fetch, POST, a
 * JSON string body), and asserts the server received a length.
 *
 * If this ever fails, the route's 411 policy is wrong for the deployed path and
 * the fix is a single-read byte-capped parser — not relaxing the check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

/** The body shape the wizard posts: a JSON string, no FormData, no stream. */
const WIZARD_STYLE_BODY = JSON.stringify({
  schema: 'forestgeo_testing',
  plotID: 1,
  censusID: 2,
  sourceFormat: 'csv',
  formType: 'measurements',
  files: [{ fileName: 'measurements.csv', blobContainer: 'forestgeo-testing-storage', blobName: 'uploads/measurements.csv' }]
});

let server: Server;
let baseUrl: string;
let lastRequestHeaders: IncomingHttpHeaders | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequestHeaders = req.headers;
    req.resume();
    req.on('end', () => {
      res.writeHead(204).end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('the supported upload-job client path carries a Content-Length', () => {
  it('sets Content-Length, and does not chunk, for a JSON string body', async () => {
    const response = await fetch(`${baseUrl}/api/uploadjobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: WIZARD_STYLE_BODY
    });

    expect(response.status).toBe(204);
    console.log(
      `[content-length] server saw content-length=${lastRequestHeaders?.['content-length']} ` +
        `transfer-encoding=${lastRequestHeaders?.['transfer-encoding'] ?? '(none)'}`
    );

    expect(lastRequestHeaders?.['content-length'], 'a string body must be sent with a declared length').toBeDefined();
    expect(Number(lastRequestHeaders?.['content-length'])).toBe(Buffer.byteLength(WIZARD_STYLE_BODY, 'utf8'));
    // Chunked is the shape that has no length; a string body must never use it.
    expect(lastRequestHeaders?.['transfer-encoding']).toBeUndefined();
  });

  it('shows the contrast: a streamed body IS chunked and carries no length', async () => {
    // The bypass the 411 closes. Documented here so the distinction stays
    // visible: this is what an attacker sends, and it is NOT what the wizard does.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(WIZARD_STYLE_BODY));
        controller.close();
      }
    });

    const response = await fetch(`${baseUrl}/api/uploadjobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      // @ts-expect-error duplex is required by undici for a streaming body and is not in the DOM lib types
      duplex: 'half'
    });

    expect(response.status).toBe(204);
    console.log(
      `[content-length] streamed body: content-length=${lastRequestHeaders?.['content-length'] ?? '(none)'} ` +
        `transfer-encoding=${lastRequestHeaders?.['transfer-encoding']}`
    );

    expect(lastRequestHeaders?.['content-length'], 'a streamed body has no declared length — this is the case the route rejects').toBeUndefined();
    expect(lastRequestHeaders?.['transfer-encoding']).toBe('chunked');
  });
});
