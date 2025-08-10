// testing/mockstesting/platform-mocks.spec.ts
import { vi, beforeEach, describe, expect, it } from 'vitest';

// 1) Turn on your platform mocks
import '@/testing/platform-mocks';

// 2) Pull in the mocked helpers directly from next/headers
import { __cookie, cookies, headers } from 'next/headers';

describe('platform-mocks wiring', () => {
  beforeEach(() => {
    // extra safety; mock’s beforeEach already clears
    __cookie.clear();
  });

  it('cookies(): returns an awaitable bag with get/set/delete/getAll', async () => {
    const bag = await cookies(); // async function per mock

    // Initially empty
    expect(__cookie.all()).toEqual([]);

    // set through the bag
    bag.set('theme', 'dark');
    bag.set('token', 'abc');

    // read via bag + helper
    expect(bag.get('theme')?.value).toBe('dark');
    expect(__cookie.get('token')?.value).toBe('abc');

    // getAll from helper mirrors jar contents
    const all = __cookie.all();
    expect(all.map(c => c.name).sort()).toEqual(['theme', 'token']);

    // delete via bag and confirm
    bag.delete('token');
    expect(__cookie.get('token')).toBeUndefined();
    expect(__cookie.all().map(c => c.name)).toEqual(['theme']);
  });

  it('cookies(): separate awaits share the same underlying jar', async () => {
    const a = await cookies();
    const b = await cookies();

    a.set('x', '1');
    expect(b.get('x')?.value).toBe('1'); // shared state
    b.delete('x');
    expect(a.get('x')).toBeUndefined();
  });

  it('headers(): returns a Map-like object (stubbed)', () => {
    const h = headers(); // from mock
    expect(h).toBeInstanceOf(Map);
    expect(typeof h.get).toBe('function');
  });

  it('RDS definition modules are stubbed and importable', async () => {
    // They don’t need to export anything; just ensure they’re resolvable
    await expect(import('@/config/sqlrdsdefinitions/taxonomies')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/zones')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/views')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/validations')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/timekeeping')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/personnel')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/core')).resolves.toBeDefined();
    await expect(import('@/config/sqlrdsdefinitions/admin')).resolves.toBeDefined();
  });

  it('chalk + logger are mocked quietly', async () => {
    const chalk = await import('chalk');
    // @ts-expect-error: mock uses String passthroughs
    expect(chalk.default.red('hi')).toBe('hi');

    const logger = (await import('@/ailogger')).default as any;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');

    // call without throwing / noisy output
    logger.info('test-info');
    logger.error('test-error');
  });

  it('integrates with server action cookiemanager via mocked cookies()', async () => {
    // Bypass any prior vi.mock for this specific import
    const cm = await vi.importActual<typeof import('@/app/actions/cookiemanager')>('@/app/actions/cookiemanager');
    await cm.submitCookie('lang', 'en');
    expect(__cookie.get('lang')?.value).toBe('en');
    expect(await cm.getCookie('lang')).toBe('en');
    await cm.deleteCookie('lang');
    expect(__cookie.get('lang')).toBeUndefined();
  });
});
