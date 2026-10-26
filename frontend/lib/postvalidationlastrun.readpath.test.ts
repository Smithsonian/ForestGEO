import { describe, expect, it, vi } from 'vitest';
import { formatInstant, parseInstant } from '@/config/dateformats';

// The global test setup stubs the mapper factory; this test needs the real GenericMapper.
const { default: MapperFactory } = await vi.importActual<typeof import('@/config/datamapper')>('@/config/datamapper');

// Read path of "Last Run At": mysql2 (pool timezone 'Z') decodes the zone-less DATETIME as a UTC
// Date -> GenericMapper passes it through (lastRunAt is not one of its date keys) -> the fetchall
// route JSON.stringify()s it -> the browser receives an ISO string ending in "Z" -> formatInstant.
// Zones are passed explicitly, so no test mutates process.env.TZ.
describe('postvalidationqueries LastRunAt read path', () => {
  const stored = '2026-10-20 15:30:00'; // what the UTC writer stored
  const decodedByMysql2 = new Date('2026-10-20T15:30:00.000Z'); // pool timezone 'Z'

  function browserPayload() {
    const rows = MapperFactory.getMapper<any, any>('postvalidationqueries').mapData([
      { QueryID: 1, QueryName: 'Q', LastRunAt: decodedByMysql2, LastRunStatus: 'success' }
    ]);
    return JSON.parse(JSON.stringify(rows))[0] as { lastRunAt: string };
  }

  it('reaches the browser as a zoned ISO string', () => {
    expect(browserPayload().lastRunAt).toBe('2026-10-20T15:30:00.000Z');
  });

  it('renders the stored UTC wall time once in the viewer zone', () => {
    const { lastRunAt } = browserPayload();
    expect(formatInstant(lastRunAt, 'America/Los_Angeles')).toBe('Oct 20, 2026, 8:30 AM');
    expect(formatInstant(lastRunAt, 'Pacific/Auckland')).toBe('Oct 21, 2026, 4:30 AM');
    expect(formatInstant(lastRunAt, 'UTC')).toBe('Oct 20, 2026, 3:30 PM');
  });

  it('interprets the same value identically when it arrives as zone-less database text', () => {
    expect(parseInstant(stored)!.getTime()).toBe(decodedByMysql2.getTime());
    expect(formatInstant(stored, 'America/Los_Angeles')).toBe(formatInstant(browserPayload().lastRunAt, 'America/Los_Angeles'));
  });

  it('maps a never-run query (NULL) to no timestamp', () => {
    const [row] = MapperFactory.getMapper<any, any>('postvalidationqueries').mapData([{ QueryID: 1, LastRunAt: null }]);
    expect(formatInstant(row.lastRunAt, 'UTC')).toBeNull();
  });
});
