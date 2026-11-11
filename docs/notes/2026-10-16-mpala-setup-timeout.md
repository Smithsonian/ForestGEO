# Mpala census 3 upload: setup timeout (2026-10-16)

PR #536. Evidence archive: `~/dev/ForestGEO-local/incidents/2026-10-mpala-setup-timeout/`.
The revision design is kept outside the repository.

## Symptom

`Mpala_Tree_Census_2026-10-10.csv` (412,427 records, 412,421 accepted) failed three times in `catalog.background_jobs`.

| Job | Stopped at | Final error |
|---|---|---|
| 24 | 10% | `AZURE_STORAGE_CONNECTION_STRING` not set on the worker that claimed it |
| 25 | 45% | setup transaction timed out after 120000 ms (3/3 retries) |
| 26 | 45% | setup transaction timed out after 120000 ms (3/3 retries) |

All 412,421 rows are still staged in `forestgeo_mpala.temporarymeasurements` under one BatchID. Census 3 has 0 `coremeasurements`.

## Azure measurements (2026-10-16)

The staged rows were copied into a scratch schema on `forestgeo-mysqldataserver` (8.0.46-azure). Each split ran in one transaction that was rolled back.

| | dev loop (`UPDATE ... ORDER BY id LIMIT`) | PR #536 keyset loop |
|---|---|---|
| Total | 99.6 s for 27/42 passes, about 150 s projected | 186.8 s (42 passes) |
| Row selection | about 1.74 s per pass | 101.8 s total |
| Row move (UPDATE) | about 1.5 s per pass | 84.3 s total |
| Rollback | 35 s | 46 s |

## Root cause

1. Wrong plan. The keyset SELECT used `idx_cid_md_dbh_hom_qn_tt`: 2.7 s per pass in production. With `ingest_temporarymeasurements_FBPC_index` the same query returns 10,000 rows in 20 ms. Statistics disagree: `idx_tmpm_file_batch_census` estimates 36 distinct BatchIDs, FBPC 1,997, on a table holding one. The frozen-statistics test reproduces the wrong pick locally (MySQL 8.0.36) for the unhinted fallback select.
2. BatchID rewrite. `BatchID` is in 3 secondary indexes, so moving 412k rows costs about 84 s even with a perfect SELECT. A timeout then pays 35-46 s again in rollback.

Making the split faster cannot reach the budget. The split has to stop rewriting `BatchID`.

## Fix as landed

- Pre-partitioned staging. A row's BatchID is `buildSubBatchID(batch, floor(rowOrdinal / batchSize) + 1)`, a pure function of file bytes and batch size, so a retry reproduces membership. Worker, browser and ArcGIS callers pass `firstRowOrdinal`.
- Family-aware readers: stale cleanup, first-chunk check, dropped-row candidates, staged counts, `/api/verifyupload`, `sqlpacketload` scope check, `/api/setupbulkprocessor`.
- Per-chunk `COUNT(*)` removed. Loss detection uses the INSERT's inserted-row count.
- Setup discovers the family once, with a member-size guard. A pre-partitioned member above the batch size fails with `OversizedSubBatchError`.
- Hinted fallback split for rows still under the original BatchID (legacy clients, `/api/reingest`): `INDEX(... ingest_temporarymeasurements_FBPC_index)`, with a warning logged when it runs.
- An oversized sub-batch is a permanent failure: HTTP 422 from the route, `NonRetryableJobError` in the worker.
- Every failed setup records step and attempt context.
- Kept dev's log-and-continue lock release after COMMIT (the original PR made it fatal). `GET /api/uploadjobs` queries events only for failing jobs.
- Job transitions now write their status and event in one catalog transaction (`withCatalogTransition`, `lib/background-jobs/repository.ts`), so the recorded failure context always matches the transition. A failed event insert now fails the transition.

## Deploy precondition

- **Risk:** a measurements background job whose earlier attempt ran on the old code and completed a `__subNNN` metric, then retried on the new code, can re-ingest a few rows. The old split used accepted-row order; the new one uses raw row position.
- **Required:** before deploying, confirm no measurement job is `running` or `waiting_retry` with a completed sub-batch metric, or let the queue drain.

## Moved out

- COMMIT-outcome-unknown recovery hold, with findings 3 (`/api/cleanup` treats the session as orphaned) and 4 (sweeper depends on a fire-and-forget write). Finding 5 (stale shared-queue `firstFailure`) travels with it.
- Worker blob-readiness check, with finding 6 (a job no worker can claim stays `queued` silently).
- Index trimming (spec section 6): drop `idx_tmpm_file_batch_census`, audit `idx_cid_md_dbh_hom_qn_tt`. Needs caller audit, migration and Azure timings.

## Correction to the plan

Browser chunks are serial (`connectionLimit = 1`), not concurrent. Out-of-order chunks are not the common path; they are still tested.

## Azure acceptance

Run 2026-10-15 19:00 PDT on 8.0.46-azure: the 412,421 Mpala rows were copied into a scratch schema and every trial was rolled back (`mpala-setup-acceptance.mjs` in the archive).

| Path | Target | Result |
|---|---|---|
| Pre-partitioned setup (lock, discovery, recovery and cleanup probes) | < 10 s, zero `BatchID` UPDATEs | **3.8 s**, 0 UPDATEs. Discovery `FOR UPDATE` 2.8 s (1.4 s non-locking), 42 members, the largest 10,000 rows |
| Fallback split, hinted | < 100 s | **96.2 s** (selects 35.9 s, updates 59.6 s), rollback 40 s |
| Staging insert cost | baseline | 30.8 s for a single-statement copy; 45.8 s with the ordinal `ROW_NUMBER()` |

Plans:
- Discovery, the bound and the keyset select are covering FBPC range scans.
- The fallback UPDATE is a PRIMARY range, so no hint is needed.
- Recovery and cleanup probes estimate 1 row each.
- The harness session ran REPEATABLE-READ; the app sets READ COMMITTED.

The fallback margin is thin, so no large file should depend on it.

Follow-up: the stale-cleanup DELETE scanned the whole scratch table (`ALL`), because `FileID` matched every row. A re-upload of a file whose earlier staging is still present pays that scan in its first chunk.

## Decisions

- D1: the duplicate-row test strips one VALUES tuple; `temporarymeasurements` has no unique key, so INSERT IGNORE never drops a duplicate.
- D2: setup passes every family member, completed ones included; the procedure skips and deletes completed batches' staged rows.
- D3: `onIdle`/`firstFailure` leave with the recovery hold; finding 5 moves with it.
- D4: `lifecycleObserver` dropped; every terminal setup failure emits `outcome: 'failed'` with the active step.
- D5: all other `BatchID = ?` readers made family-aware (they would read zero rows on sub-batches).
- D6: staging rejects an original BatchID over 28 characters (`varchar(36)` plus an 8-character suffix; INSERT IGNORE would truncate).
- D7: `resolveMeasurementChunk` returns `validRowSourceIndexes` so ordinals survive dropped rows.
- D8: the `sqlpacketload` mixed-scope check samples one row of the family; setup discovery still rejects a mixed family.
