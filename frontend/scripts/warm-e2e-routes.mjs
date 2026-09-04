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
//
// Each route has its own accepted status set rather than accepting any status: a 404
// (route renamed) or 500 must fail the warmup loudly instead of logging "done" and
// letting Cypress start with the race unfixed. /api/uploadjobs accepts 401 alongside
// 200 because the measured no-session response IS a 401 -- it still proves the route
// compiled AND executed -- while an auth-bypassing e2e environment would see 200. The
// page route has no such no-session variant, so only 200 is accepted for it.
//
// Redirects are followed manually (redirect: 'manual') so a redirect to a login/error
// page surfaces as its own 3xx status -- which is not in any accepted set and throws --
// instead of silently resolving as a 200 warmup of the wrong page.

const BASE_URL = process.env.WARMUP_BASE_URL ?? 'http://localhost:3000';

// Order matters. The API compile is what held the compiler while the page waited.
const ROUTES = [
  { path: '/api/uploadjobs?schema=luquillo&plotID=1&censusID=5&activeOnly=false&limit=25', acceptedStatuses: [200, 401] },
  { path: '/measurementshub/summary', acceptedStatuses: [200] }
];

const REQUEST_TIMEOUT_MS = 120_000;

for (const { path, acceptedStatuses } of ROUTES) {
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(`${BASE_URL}${path}`, { signal, redirect: 'manual' });

  // Consume the body under the same signal/timeout: fetch resolves on headers alone,
  // and App Router pages can stream, so an unread body can leave Cypress starting
  // mid-render and pins the HTTP resource open. Reading it here also makes the logged
  // duration reflect the full render, matching the server-side timings that motivated
  // this script.
  await response.arrayBuffer();

  const duration = Date.now() - startedAt;

  if (!acceptedStatuses.includes(response.status)) {
    const location = response.headers.get('location');
    const locationDetail = location ? ` (redirected to ${location})` : '';
    throw new Error(`[warmup] ${path} returned status ${response.status}${locationDetail}, expected one of [${acceptedStatuses.join(', ')}]`);
  }

  console.log(`[warmup] ${String(response.status).padEnd(3)} ${String(duration).padStart(6)}ms  ${path}`);
}

console.log('[warmup] done');
