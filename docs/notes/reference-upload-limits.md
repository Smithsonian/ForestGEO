# Whole-file reference upload limits

Reference files (species, attributes, personnel and quadrats) remain one request and one transaction per file. The session marker makes a multi-file clean upload replace existing data once. Files commit separately; the upload session is not one atomic transaction.

## Limits

Keep the 8 MiB source-file ceiling for browser buffering, and add a **10,000-row ceiling per reference file**. The upload parser checks the count before sending rows; `/api/sqlpacketload` also rejects oversized requests before starting a transaction. The selection screen displays both limits. Measurements retain chunking and do not use these reference limits.

The byte ceiling alone does not bound database work. Rejecting dense files by row count is preferable to reducing the byte limit and rejecting ordinary lists with longer descriptions. Ten thousand rows also preserves the existing quadrat maximum. A file above either limit can be split into files selected for the same upload.

## Local measurements — 2026-09-14

The production writers were exercised against local MySQL using the integration suite's ConnectionManager adapter. Every SQL statement ran against MySQL; the adapter bypasses the app connection pool, authentication, HTTP handling and network transit. These timings establish workload behavior, not a production latency guarantee. A slower server, more existing data, network latency or lock contention can still cause timeouts.

An attribute CSV of **8,388,600 bytes** (eight bytes below the ceiling) contained **174,762 rows**, each with an eight-character code, a 32-character description and an `alive` status. Encoding it as the uploader's UUID-keyed JSON row set produced **22,544,299 bytes** before the request envelope.

- First write: **47.67 seconds**, 174,766 SQL statements.
- Retry: stopped at **300.01 seconds**, after 132,096 SQL statements, with the file unfinished. The retry performs an existing-row lookup and update for every code. The benchmark rolled back that unfinished transaction.

The revised writers at 10,000 rows per file completed both phases:

| Form       | First write |   Retry | SQL statements on retry |
| ---------- | ----------: | ------: | ----------------------: |
| Attributes |      2.17 s | 12.88 s |                  20,001 |
| Species    |     11.79 s | 34.47 s |                  60,001 |
| Personnel  |     11.35 s | 21.40 s |                  50,001 |
| Quadrats   |      2.50 s | 14.64 s |                  20,003 |

Species fixtures include family and genus; personnel fixtures include a role. Quadrats form a non-overlapping 100-by-100 grid. Each retry resubmits the same file under the same session. These are practical limits with observed headroom, not a promise that every accepted file finishes within 300 seconds.

## Reproduce

From `frontend`, with the local integration MySQL instance available:

```sh
REFERENCE_UPLOAD_BENCHMARK_ROWS=10000 npm run test:integration -- tests/integration/reference-clean-reupload-session.test.ts -t benchmark
```

The benchmark is opt-in, runs all four production writers and reports row count, serialized sizes, statement counts and elapsed time. It uses a disposable local test schema, as the integration suite does. To reproduce the former byte-limit workload at writer level, set `REFERENCE_UPLOAD_BENCHMARK_ROWS=174762` and filter with `-t 'benchmark: attributes'`. The HTTP route now refuses that row count. The probe throws at the 300-second budget and rolls back the unfinished transaction.

## Reference replacement prerequisites

Apply migration `2026-09-09-01-add-upload-session-reference-replacement-marker.sql` before deploying to an existing schema. Reference uploads no longer alter the schema at request time or continue a clean replacement with a missing session/table/column. If the session disappears before its marker can be recorded, the data transaction rolls back. Existing measurement compatibility behavior is preserved.
