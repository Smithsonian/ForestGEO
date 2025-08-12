import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// Import handler after mocks
import { POST } from './route';

// -------- hoisted spies/classes (safe to use inside vi.mock) --------
const { getCCSpy, uploadSpy, loggerErrSpy } = vi.hoisted(() => ({
  getCCSpy: vi.fn(),
  uploadSpy: vi.fn(),
  loggerErrSpy: vi.fn()
}));

// -------- mocks (must be before importing the route) --------
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: getCCSpy,
  uploadValidFileAsBuffer: uploadSpy
}));

vi.mock('@/ailogger', () => ({
  default: { error: loggerErrSpy, info: vi.fn(), warn: vi.fn() }
}));

// -------- helpers --------
function makeUrl(params: Record<string, string | number | undefined>) {
  const url = new URL('http://localhost/api/filehandlers/storageload');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url;
}

function makeRequest(params: Record<string, any>) {
  const url = makeUrl(params);
  const req: any = new Request(url.toString(), { method: 'POST' });
  req.nextUrl = url; // Next.js reads request.nextUrl
  return req as any;
}

function makeFile(name = 'myfile.csv', contents = 'a,b,c\n1,2,3') {
  const blob = new Blob([contents], { type: 'text/csv' });
  return new File([blob], name, { type: 'text/csv' });
}

describe('POST /api/filehandlers/storageload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default: upload succeeds
    uploadSpy.mockResolvedValue({ _response: { status: 200 } } as any);
    // default: container client is an object with no special shape required by the route
    getCCSpy.mockResolvedValue({} as any);
  });

  it('400 when formData is missing/empty', async () => {
    // formData() rejects
    const req1 = makeRequest({});
    (req1 as any).formData = vi.fn().mockRejectedValue(new Error('nope'));
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);
    expect(await res1.text()).toMatch(/File is required/i);

    // formData() resolves but is empty
    const req2 = makeRequest({});
    (req2 as any).formData = vi.fn().mockResolvedValue(new FormData());
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);
    expect(await res2.text()).toMatch(/File is required/i);
  });

  it('400 when required query params are missing', async () => {
    const fd = new FormData();
    const file = makeFile('m.csv');
    fd.append('m.csv', file);

    // Missing user/formType/etc.
    const req = makeRequest({
      fileName: 'm.csv',
      plot: 'MyPlot',
      census: 'C1'
      // user missing
      // formType missing
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Missing required parameters/i);
  });

  it('500 when getContainerClient throws; logs via ailogger', async () => {
    const fd = new FormData();
    const file = makeFile('doc.csv');
    fd.append('doc.csv', file);
    fd.append('fileRowErrors', JSON.stringify([{ row: 1, error: 'bad' }]));

    getCCSpy.mockRejectedValueOnce(new Error('boom'));
    const req = makeRequest({
      fileName: 'doc.csv',
      plot: 'PLOT-X',
      census: 'CEN-1',
      user: 'sam',
      formType: 'trees'
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.responseMessage).toMatch(/Error getting container client/i);
    expect(body.error).toMatch(/boom/i);
    expect(loggerErrSpy).toHaveBeenCalled();
  });

  it('500 when container client is falsy', async () => {
    const fd = new FormData();
    const file = makeFile('doc.csv');
    fd.append('doc.csv', file);

    getCCSpy.mockResolvedValueOnce(undefined as any);

    const req = makeRequest({
      fileName: 'doc.csv',
      plot: 'PLOT-X',
      census: 'CEN-1',
      user: 'sam',
      formType: 'trees'
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.responseMessage).toMatch(/Container client is undefined/i);
  });

  it('500 when upload returns non-2xx status', async () => {
    const fd = new FormData();
    const file = makeFile('u.csv');
    fd.append('u.csv', file);
    fd.append('fileRowErrors', JSON.stringify([{ row: 2, error: 'x' }]));

    uploadSpy.mockResolvedValueOnce({ _response: { status: 500 } } as any);

    const req = makeRequest({
      fileName: 'u.csv',
      plot: 'Plot-Name',
      census: 'Cen-Name',
      user: 'jane',
      formType: 'stems'
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.responseMessage).toMatch(/File Processing error/i);
  });

  it('500 when upload throws; logs error', async () => {
    const fd = new FormData();
    const file = makeFile('x.csv');
    fd.append('x.csv', file);

    uploadSpy.mockRejectedValueOnce(new Error('kaboom'));

    const req = makeRequest({
      fileName: 'x.csv',
      plot: 'MyPlot',
      census: 'C1',
      user: 'u1',
      formType: 'trees'
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.responseMessage).toMatch(/File Processing error/i);
    expect(body.error).toMatch(/kaboom/i);
    expect(loggerErrSpy).toHaveBeenCalled();
  });

  it('200 on success; uses lower-cased container name and passes args to upload', async () => {
    const fd = new FormData();
    const file = makeFile('good.csv');
    fd.append('good.csv', file);
    fd.append('fileRowErrors', JSON.stringify([{ row: 5, error: 'warn' }]));

    const fakeContainer = { id: 'container' };
    getCCSpy.mockResolvedValueOnce(fakeContainer as any);
    uploadSpy.mockResolvedValueOnce({ _response: { status: 201 } } as any);

    const req = makeRequest({
      fileName: 'good.csv',
      plot: 'PLOT_UPPER',
      census: 'CEN_UPPER',
      user: 'alex',
      formType: 'measurementssummary'
    });
    (req as any).formData = vi.fn().mockResolvedValue(fd);

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to Azure Storage successful/i);

    // container name is `${plot}-${census}` lower-cased
    expect(getCCSpy).toHaveBeenCalledWith('plot_upper-cen_upper');
    // upload called with container, file, user, formType, row errors (parsed)
    const [passedContainer, passedFile, passedUser, passedFormType, passedErrors] = uploadSpy.mock.calls[0];
    expect(passedContainer).toBe(fakeContainer);
    expect(passedFile?.name).toBe('good.csv');
    expect(passedUser).toBe('alex');
    expect(passedFormType).toBe('measurementssummary');
    expect(passedErrors).toEqual([{ row: 5, error: 'warn' }]);
  });
});
