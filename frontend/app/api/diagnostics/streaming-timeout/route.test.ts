import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { isAllowedStreamingDiagnosticHost } from './helpers';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

describe('GET /api/diagnostics/streaming-timeout', () => {
  it('allows only localhost and non-production Azure hosts', () => {
    expect(isAllowedStreamingDiagnosticHost('localhost:3000')).toBe(true);
    expect(isAllowedStreamingDiagnosticHost('127.0.0.1:3000')).toBe(true);
    expect(isAllowedStreamingDiagnosticHost('forestgeo-development.azurewebsites.net')).toBe(true);
    expect(isAllowedStreamingDiagnosticHost('forestgeo-testing-app.azurewebsites.net')).toBe(false);
    expect(isAllowedStreamingDiagnosticHost('forestgeo-livesite.azurewebsites.net')).toBe(false);
  });

  it('returns 404 for disallowed hosts', async () => {
    const response = await GET(
      new Request('https://forestgeo-livesite.azurewebsites.net/api/diagnostics/streaming-timeout', {
        headers: { host: 'forestgeo-livesite.azurewebsites.net' }
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('streams a result payload for an allowed host', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/diagnostics/streaming-timeout?durationSeconds=0&heartbeatSeconds=1', {
        headers: { host: 'localhost:3000' }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');

    const text = await response.text();
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(1);

    const payload = JSON.parse(lines[0]);
    expect(payload).toMatchObject({
      type: 'result',
      success: true,
      data: {
        heartbeatSeconds: 1,
        host: 'localhost:3000',
        requestedDurationSeconds: 0
      }
    });
  });

  it('rejects durations longer than 15 minutes', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/diagnostics/streaming-timeout?durationSeconds=901', {
        headers: { host: 'localhost:3000' }
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'durationSeconds must be an integer between 0 and 900'
    });
  });
});
