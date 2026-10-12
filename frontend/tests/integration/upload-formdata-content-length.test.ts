/**
 * /api/files/upload and /api/arcgis/preflight answer 411 without a Content-Length
 * (lib/uploads/upload-request-body.ts). That is only safe if the upload wizard's
 * request shape — fetch, POST, a FormData body holding a File — is sent with a
 * declared length. This sends exactly that over a real socket and asserts the
 * server saw a length and no chunking. Checked by hand 2026-10-12: length 194, no
 * transfer-encoding. If this ever fails, the 411 policy is wrong for the
 * supported path; fix the reader, do not relax the check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

const NO_CONTENT = 204;
const CSV_CONTENT = 'tag,stemtag,spcode\n010001,010001,DICHGL\n';

let server: Server;
let baseUrl: string;
let lastRequestHeaders: IncomingHttpHeaders | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequestHeaders = req.headers;
    req.resume();
    req.on('end', () => {
      res.writeHead(NO_CONTENT).end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('the supported file-upload client path carries a Content-Length', () => {
  it('sets Content-Length, and does not chunk, for a FormData body with a File', async () => {
    const formData = new FormData();
    formData.append('census2.csv', new File([CSV_CONTENT], 'census2.csv', { type: 'text/csv' }));

    const response = await fetch(`${baseUrl}/api/files/upload?fileName=census2.csv`, { method: 'POST', body: formData });

    expect(response.status).toBe(NO_CONTENT);
    console.log(
      `[content-length] server saw content-length=${lastRequestHeaders?.['content-length']} ` +
        `transfer-encoding=${lastRequestHeaders?.['transfer-encoding'] ?? '(none)'}`
    );
    expect(lastRequestHeaders?.['content-length'], 'a FormData body must be sent with a declared length').toBeDefined();
    expect(Number(lastRequestHeaders?.['content-length'])).toBeGreaterThan(CSV_CONTENT.length);
    expect(lastRequestHeaders?.['transfer-encoding']).toBeUndefined();
  });
});
