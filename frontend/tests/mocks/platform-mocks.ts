// test/platform-mocks.ts
import { beforeEach, vi } from 'vitest';

/* -------------------------------------------------
 * 1) Mock Next.js `cookies()` (server-only API)
 * -------------------------------------------------
 * Your cookiemanager.ts uses:
 *   const bag = await cookies(); bag.get|set|delete(...)
 * We provide an async function that returns a mutable jar.
 */

type CookieValue = { name: string; value: string };
const jar = new Map<string, CookieValue>();

function __cookieSet(name: string, value: string) {
  jar.set(name, { name, value });
}
function __cookieGet(name: string): CookieValue | undefined {
  return jar.get(name);
}
function __cookieDelete(name: string) {
  jar.delete(name);
}
function __cookieAll(): CookieValue[] {
  return Array.from(jar.values());
}
function __cookieClear() {
  jar.clear();
}

// Export the cookie helpers
export const __cookie = {
  set: __cookieSet,
  get: __cookieGet,
  del: __cookieDelete,
  all: __cookieAll,
  clear: __cookieClear
};

vi.mock('next/headers', () => {
  // Minimal ‘RequestCookies’-like object with get/set/delete
  const cookieBag = {
    get: (name: string) => __cookieGet(name),
    set: (name: string, value: string) => __cookieSet(name, value),
    delete: (name: string) => __cookieDelete(name),
    getAll: () => __cookieAll()
  };

  return {
    // cookies() can be awaited in your code. Support both sync & await usage.
    cookies: async () => cookieBag,
    // optional: headers() stub if anything else imports it
    headers: () => new Map<string, string>()
  };
});

/* -------------------------------------------------
 * 2) Stub heavy/typed SQL RDS modules at runtime
 * -------------------------------------------------
 * datamapper.ts imports lots of modules without `import type`,
 * so Node will try to load them. We stub them all.
 */

const emptyModule = {};
const coreModule = { AttributeStatusOptions: ['alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'] };

vi.mock('@/lib/db/definitions/taxonomies', () => emptyModule);
vi.mock('@/lib/db/definitions/zones', () => emptyModule);
vi.mock('@/lib/db/definitions/views', () => emptyModule);
vi.mock('@/lib/db/definitions/validations', () => emptyModule);
vi.mock('@/lib/db/definitions/timekeeping', () => emptyModule);
vi.mock('@/lib/db/definitions/personnel', () => emptyModule);
vi.mock('@/lib/db/definitions/core', () => coreModule);
vi.mock('@/lib/db/definitions/admin', () => emptyModule);
// datamapper also imports a relative admin re-export:
vi.mock('./sqlrdsdefinitions/admin', () => emptyModule);

/* -------------------------------------------------
 * 3) Nice-to-have: silent chalk + logger if referenced
 * ------------------------------------------------- */
vi.mock('chalk', () => ({
  default: { red: String, yellow: String, cyan: String },
  red: String,
  yellow: String,
  cyan: String
}));
vi.mock('@/ailogger', () => {
  const noop = vi.fn();
  return { default: { info: noop, warn: noop, error: noop, debug: noop } };
});

beforeEach(() => {
  // reset cookie jar between tests
  __cookie.clear();
});
