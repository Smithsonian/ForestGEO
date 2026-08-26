// The nightly starts `next dev --turbo` and runs Cypress immediately, so routes compile
// on demand and the first spec races the compiler. Measured 2026-08-26:
//
//   07:20:56.101  Compiling /api/uploadjobs ...
//   07:21:11.576  Compiled /api/uploadjobs in 16s
//   07:21:11.685  GET /measurementshub/summary 200 in 14873ms   <- 15000ms budget
//   07:21:17.505  GET /measurementshub/summary 200 in 428ms
//
// a11y-responsive missed its navigation budget by 127ms because the page request queued
// behind the API compile. Warming exactly that pair removes the contention.
//
// Deliberately NOT a route inventory: discovering every route and fan-out API would
// couple this fix to unrelated application growth. Deliberately NOT non-fatal: a
// warmup that can silently skip cannot guarantee the goal and would leave the race.

const BASE_URL = process.env.WARMUP_BASE_URL ?? 'http://localhost:3000';

// Order matters. The API compile is what held the compiler while the page waited.
const ROUTES = ['/api/uploadjobs?schema=luquillo&plotID=1&censusID=5&activeOnly=false&limit=25', '/measurementshub/summary'];

const REQUEST_TIMEOUT_MS = 120_000;

for (const route of ROUTES) {
  const startedAt = Date.now();
  // Any HTTP status means the route compiled -- a 401 from /api/uploadjobs is enough.
  // Only a network failure or timeout indicates the server never got there.
  const response = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  console.log(`[warmup] ${String(response.status).padEnd(3)} ${String(Date.now() - startedAt).padStart(6)}ms  ${route}`);
}

console.log('[warmup] done');
