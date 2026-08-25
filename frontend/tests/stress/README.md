# Workshop Stress Suite

This suite drives a running ForestGEO dev server over HTTP and keeps multiple site schemas active at the same time. The default `workshop` profile is read-heavy: site/plot/census discovery, dashboard metrics, fixed-data pages, and errors explorer queries.

## Local dev run

Start the app with the E2E credentials provider and run a short smoke pass:

```bash
npm run stress:workshop:local -- --duration=30s --vus-per-site=1 --profile=smoke
```

Run the full default profile:

```bash
npm run stress:workshop:local -- --duration=2m --vus-per-site=3 --max-sites=4
```

## Shared dev deployment

Use a browser-authenticated cookie header or another authorized header:

```bash
STRESS_BASE_URL=https://your-dev-site.example.com \
STRESS_AUTH=cookie \
STRESS_COOKIE='authjs.session-token=...' \
npm run stress:workshop -- --duration=5m --vus-per-site=5 --max-sites=6
```

## Pin workshop sites

Let the runner discover sites from `/api/fetchall/sites`, or pin them:

```bash
npm run stress:workshop -- \
  --site=forestgeo_panama:2:9:3 \
  --site=forestgeo_serc:1:4:2
```

The compact format is `schema[:plotID[:censusID[:plotCensusNumber]]]`. Missing plot/census values are discovered from the API.

## Thresholds

The runner exits nonzero when thresholds fail:

```bash
npm run stress:workshop -- --max-error-rate=1% --max-p95=8s --min-sites=3
```

JSON reports are written to `test-results/stress/` by default.
