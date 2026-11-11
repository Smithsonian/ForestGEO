# Development integration failures: diagnosis and fixes

Baseline: `430bdadb` (`origin/forestgeo-app-development`). Every database run used
the Docker `mysql:8.0.36` container at `127.0.0.1:3306`, session time zone `SYSTEM`,
system time zone UTC, with the harness refusal guards intact. The runtime was Node 24
under `TZ=Europe/Bratislava` (+02:00 in September, +01:00 in January).

## A. Calendar dates: a harness gap, not a production defect

`lib/ctfs-export/select-measurements.test.ts` reported `expected '2024-05-31' to be
'2024-06-01'`. The selector read a `DATE` column as a mysql2 `Date` and took
`toISOString().slice(0, 10)`. That is only wrong when the driver decodes the column
in a non-UTC zone, and the harness connection in `tests/setup/local-db-setup.ts`
had no `timezone` option, so it decoded in the runtime's local zone.

The production pool in `lib/db/poolmonitorsingleton.ts` pins `timezone: 'Z'`, and
mysql2 then decodes a `DATE` as `Date.UTC(y, m - 1, d)`, so no host offset can shift
the day. The same reasoning covers the fifteen other `toISOString().slice(0, 10)`
and `split('T')[0]` sites in `config/editplan/*`, `analyzer.ts`, `planhash.ts`,
`fieldpolicy.ts`, `config/measurementerrors.ts` and `app/api/errors/explorer/_shared.ts`,
which are left as they are. Nothing in this section changed what users see.

Two things did change. The selector now formats the day in SQL with
`DATE_FORMAT(cm.MeasurementDate, '%Y-%m-%d')`, which removes the dependence on the
driver zone entirely, and it maps a NULL date to SQL NULL instead of the text
`'null'`, so an out-of-band NULL reaches Stage 5's "Missing required field" check
instead of aborting the publish as an invalid `DATE`. `MeasurementStagingRow.ExactDate`
is `string | null` to match.

The four editplan assertions that converted a `Date` the same way now read the stored
day as `DATE_FORMAT()` from the row they already load.

## B. Freshness and leases: test pools decoded in local time

The validation conflict, interactive session and same-pass sweeper tests failed
because the shared harness connection and every hand-built catalog pool omitted
`timezone: 'Z'`. With a UTC server and a +02:00 runtime, mysql2 decoded `NOW()` two
hours old and bound `NextAttemptAt = new Date(now + 60 s)` two hours in the future,
so `NextAttemptAt <= NOW()` never reopened a parked job within the test window.

A read-only clock experiment on the baseline returned:

```text
runtime: 2026-09-14T18:49:07Z; session timezone SYSTEM; system timezone UTC
mysql2 timezone local: NOW() decoded as 2026-09-14T16:49:07Z
mysql2 timezone Z:     NOW() decoded as 2026-09-14T18:49:07Z
TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) = 0
```

`tests/setup/test-db-connection.ts` now supplies the server options, with
`timezone: 'Z'`, to the harness connection, `catalog-migrations.ts`, and every test
pool or connection under `tests/integration/` and `lib/provisioning/` that reads or
writes timestamps. Five DDL-only probe connections in four files stay unpinned on purpose, and
`csv-to-sql.integration.test.ts` stays local-zone until its `formatExactDate` helper
stops reading the decoded `Date` with local-time getters. The waiting_retry test
in `background-jobs-repository.test.ts` asserts `TIMESTAMPDIFF(SECOND, NOW(),
NextAttemptAt)` against the requested delay; on the baseline pool under
`Europe/Bratislava` it reports 7260 s. `00-infrastructure.integration.test.ts` asserts
first that the server session is UTC, naming host, port and both `time_zone`
variables (a Homebrew mysqld on :3306 fails here, not in the driver test), and then
that the harness connection binds and decodes as UTC. Unit tests now guard
`timezone: 'Z'` on the runtime pool and the schema CLI, which no suite covered before.

Production repository code is unchanged. The July note on the realdb e2e suite
describes the mirror image, a non-UTC server under a UTC-configured application
pool; both are the same contract, and the app still assumes the server is UTC.

## C. Test database naming

`VITEST_POOL_ID` is always `1` under `singleFork`, so two worktrees running the suite
at once dropped each other's `forestgeo_test_1` mid-load. The name is now
`forestgeo_test_<namespace>_<pool_id>`, where the namespace is `TEST_DB_NAMESPACE`
or the first 8 hex characters of a SHA-256 of the directory the suite is started
from (always `frontend/`): unique across worktrees, stable across runs, and reclaimed
by the next run's `DROP DATABASE IF EXISTS`. Two concurrent runs in the same checkout
still share one schema. `cleanup-test-databases.ts` now matches the prefix with the
underscores escaped; the old `LIKE 'forestgeo_test_%'` also matched, and would have
dropped, the live `forestgeo_testing` e2e schema. Its runner docstring now says
`npx tsx`; `ts-node` is not a dependency. The shared `catalog` schema is still a single fixed name, so suites that
touch it still serialize across worktrees.

## D. CI

The PR gate's integration job now runs the whole suite under `TZ=Europe/Bratislava`.
UTC is the one runtime in which this bug class is invisible, production runs UTC, and
the full suite was green under Bratislava on this branch, so a second UTC run would
add nothing. The zone was chosen because its offset varies (+01:00 in winter, +02:00
in summer), so a single hard-coded offset compensation is caught too; the price is
that a run on a DST transition day (2026-03-29 and 2026-10-25) sees a 23- or 25-hour
local day. The MySQL service container is pinned to `TZ: UTC` in the workflow, since
the server-clock probe depends on it and the image default was the only thing
providing it. The unit suite still runs under UTC, so the singleton timezone guard is
zone-inert there.

## E. Benchmark: reproduced only inside the full suite; localized to one phase

Three standalone runs of `ingestion-scale-benchmark.integration.test.ts` completed all
three 10,000-row batches in about 2.3 s each, with `tree_stem_insert_ms` near 720 ms
every time:

| Run              |  Batch 1 |  Batch 2 |  Batch 3 |
| ---------------- | -------: | -------: | -------: |
| 1 (2026-09-14)   | 2,281 ms | 2,252 ms | 2,344 ms |
| 2 (2026-09-14)   | 2,290 ms | 2,262 ms | 2,305 ms |
| 3 (2026-09-16)   | 2,302 ms | 2,255 ms | 2,375 ms |

The full-suite runs on the finished branch (2026-09-16, `TZ=Europe/Bratislava` and
`TZ=UTC`, the benchmark file 130th of 132) both failed the second batch against the
30,000 ms ceiling, and the new phase log says where the time went:

| Run          | Batch 1 total | Batch 2 total | Batch 2 `tree_stem_insert_ms` |
| ------------ | ------------: | ------------: | ----------------------------: |
| Bratislava   |      2,278 ms |     39,113 ms |                     37,521 ms |
| UTC          |      4,212 ms |     42,258 ms |                     40,685 ms |

Every other phase of batch 2 matched batch 1 within a few milliseconds. So the
slowdown is not a timezone effect, is confined to the tree/stem insert phase of
`bulkingestionprocess` once 10,000 measurements exist, and depends on state the
preceding suite files leave on the server (the InnoDB buffer pool was 268,435,456
bytes in every run; the local server also carries 32 orphaned
`forestgeo_cte_app_*` schemas). The same failure was listed as a pre-existing
benchmark flake in the 2026-09-14 review of PR #479 on bare `forestgeo-app-development`,
so it is not introduced by this branch. The benchmark's ceiling, ratio bound, timeout,
ingested-row assertions and ratchets are unchanged; it now logs runtime and server
time zones, MySQL version, buffer pool size, and every procedure phase timing.

## Follow-ups surfaced by review, not done here

- Stage 5's required-field guard is `ExactDate IS NULL` only. A stored zero date now
  reaches Stage 1 as the literal `'0000-00-00'` (the old `toISOString()` path would
  have published it as `1899-11-30`, which mysql2 decodes a zero date to); whether it
  survives to Stage 5 depends on the destination `sql_mode`, which nothing here
  measured. Extend the predicate to `ExactDate IS NULL OR ExactDate = '0000-00-00'`
  with an integration case; legacy `ctfs-migrations/08_migrate_coremeasurements.sql`
  copies dates that may hold zeros.
- No `checkFinishedCensus` precondition covers a NULL `MeasurementDate`, and the dry
  run omits Stage 5, so the operator first sees the failure when the real publish
  SIGNALs. Add a blocking precondition kind next to `missing-taxonomy-fields`.
- `docker-compose.yml` does not pass `--default-time-zone=+00:00`; the local
  container is UTC only by image default (the CI service container is now pinned).
  Pin it so the server-clock probe guards a declared contract locally too.
- The unit step in `pr-gate.yml` and the nightly coverage run still execute under
  UTC; give them the same `TZ` once the integration run has proven stable.
- `csv-to-sql.integration.test.ts` still reads a decoded `Date` with local-time
  getters in `formatExactDate`; convert it and pin its connection.
  `tests/setup/cleanup-test-databases.ts` and `tests/benchmarks/*.ts` also build
  unpinned connections.
- The local-host refusal list is copied into seven files, and the `isRemoteHost`
  check in `local-db-setup.ts` omits `::1`; export one constant from
  `test-db-connection.ts`.
- `lib/background-jobs/repository.ts` binds `NextAttemptAt` with sub-second
  precision into a `DATETIME(0)` column, so MySQL rounds the scheduled retry by up
  to half a second; harmless, but an exact-equality assertion would be flaky.
- The driver-zone probes and the harness pinning are inert on a UTC runner; the PR
  gate's `TZ` setting (section D) is what gives them teeth, and the two must ship
  together.
- The singleton test proves the pool is constructed with `timezone: 'Z'`; the export
  route reaches it through `lib/db/primitives.ts`, but no test proves application
  traffic flows through `getPoolMonitorInstance()`.
- `DEFAULT_TEST_CONFIG.database` hashes `process.cwd()` at module load, so starting
  vitest from the repo root instead of `frontend/` silently produces a second schema
  for the same checkout; assert the basename or key the hash off the git toplevel.
- Bisect which prior-suite state makes `tree_stem_insert_ms` grow fifty-fold in the
  scale benchmark (section E): InnoDB statistics on `trees`/`stems`, buffer pool
  pressure after 130 files, or the orphaned schemas on the server.

## Reproduction

From `frontend/`, on the clean baseline:

```sh
TZ=Europe/Bratislava npm run test:integration -- \
  select-measurements.test editplan-writer-failedmeasurements \
  editplan-writer-measurementssummary upload-worker upload-sweeper validation-orchestrator \
  -t 'returns one measurement row|updates MeasurementDate|applies.*changes|date|stores an ISO-format Date|parks waiting_retry|returns conflict without executing|dispatches a job it reclaimed'
```

All eight selected tests failed under `Europe/Bratislava` across two runs and passed
under `UTC`. On the finished branch `npm run test:unit` passes (268 files, 4,140 tests,
4 skipped), `npm run build` passes, and `npm run test:integration` passes under both
`UTC` and `Europe/Bratislava` (132 files, 1,201 tests, 7 skipped) except the
pre-existing scale-benchmark failure described in section E.
