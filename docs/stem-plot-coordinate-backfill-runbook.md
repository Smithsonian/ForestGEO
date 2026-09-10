# Stem plot-coordinate backfill runbook

Purpose: repair `Stem.PX/PY` on Smithsonian destination stems that the app's
(pre-fix) publish pipeline inserted without plot coordinates. Issue:
[#475](https://github.com/Smithsonian/ForestGEO/issues/475), "Publish leaves
PX/PY NULL on every Stem row in the Smithsonian database."

The script itself is `frontend/db/ops/2026-09-09-backfill-stem-plot-coordinates.sql`.
Its own header documents every metric it prints and exactly what it refuses
to do — read that first. This runbook covers what surrounds running it:
building the inputs, the maintenance window, and the post-commit checks.

Suzanne runs this by hand with a MySQL client against the Smithsonian
server. The app never executes it, and it is kept out of automatic schema
migrations.

## 1. Prerequisites — build the inventory inputs

Before touching the destination, gather and record the following for the
plot you are repairing. Cocoli is the first target; the script ships Cocoli
placeholders that must be filled in from this inventory before it is usable
(see `-- SECTION: inputs`).

- **Destination PlotID** — the `Site.PlotID` on the Smithsonian server, not
  the app's `plots.PlotID`. These are not guaranteed to match.
- **Census IDs the app published** — the destination `Census.CensusID`
  values that the app's publish pipeline actually loaded for this plot (not
  every census on the destination plot — only the ones the app touched).
  Confirm each one against upload/audit history before listing it; an
  extra, unverified census ID pulls unrelated stems into the candidate set.
- **Verified plot bounds** (`@plot_dimension_x` / `@plot_dimension_y`) — the
  plot's real dimensions in the same units as `Stem.PX/PY`. Do not use
  destination `Site.QDimX/QDimY` for this — those are **quadrat** dimensions,
  not plot dimensions, on the canonical schema. Confirm units explicitly
  (see the coordinate-units note in the issue #475 spec); do not infer them
  from magnitudes.

  **The script's bounds check assumes a rectangular plot with its origin at
  (0,0)** — "in bounds" is exactly `0 <= value <= dimension` on each axis
  independently, checked independently per axis. A nonrectangular plot
  cannot be safely repaired with a single `@plot_dimension_x`/
  `@plot_dimension_y` pair: a proposed point can sit inside both axis ranges
  and still be outside the plot's actual boundary. Do not run this script
  against a nonrectangular plot until you have written and reviewed its own
  boundary check (e.g. a polygon containment test substituted for the
  script's `BETWEEN 0 AND @plot_dimension_*` bounds logic).

## 2. Prerequisite — the quadrat-origin-equivalence check

The script derives each quadrat's origin from the destination as
`MIN(Coordinates.PX)` / `MIN(Coordinates.PY)` per `QuadratID` — the same
reduction the ctfsweb migration used. The app's publish pipeline instead
computes `PX = quadrats.StartX + stems.LocalX` from the **app's** `quadrats`
table. These are the same number only for a plot that went through the
ctfsweb migration and whose quadrats have not been re-uploaded or re-gridded
since.

Run `frontend/db/ops/2026-09-09-check-quadrat-origin-equivalence.sql` before
repairing a plot. It compares, per quadrat name, the app's `StartX/StartY`
against the destination's `MIN(Coordinates.PX)/MIN(Coordinates.PY)`, and
reports one go/no-go metric: `equivalence_ok`. It is 0 — do not proceed with
the repair — if any quadrat name exists on only one side (app-only or
destination-only), if a name is ambiguous (more than one row for that name,
on either side), or if a matched name's origin disagrees beyond decimal
storage precision. Run it in its own `inputs` → `setup` → `report` →
`cleanup` order; its header documents every metric `report` prints.

Produce the app side of the comparison with the export query the script's
own `inputs` section documents:

```sql
SELECT CONCAT(
    '(', '''''',
    REPLACE(REPLACE(REPLACE(REPLACE(QuadratName, '\\', '\\\\'), '''', ''''''), '\\', '\\\\'), '''', ''''''),
    '''''', ', ', IFNULL(StartX,'NULL'), ', ', IFNULL(StartY,'NULL'), '),'
  )
FROM quadrats
WHERE PlotID = <app plot id>
  AND IsActive = 1
ORDER BY QuadratName;
```

Do not use `QUOTE()` for this — it backslash-escapes an embedded apostrophe
(e.g. `O'BRIEN` becomes `'O\'BRIEN'`), and that stray backslash corrupts the
outer `'...'` literal once pasted. The `REPLACE` chain instead doubles every
backslash and quote twice — once so the name round-trips through the
generated `INSERT` statement's own string literal, once more so that whole
result round-trips through the `@app_quadrat_origins` literal you paste it
into.

against the app's schema for the site (`forestgeo_<sitename>`). Paste every
returned row, in order, into `@app_quadrat_origins`, then delete the
trailing comma on the very last row — the query ends every row with `,` so
the rows concatenate into a VALUES list, but the final row must not have one
or the list is malformed SQL.

## 3. Maintenance window

Run the repair during a window with:

- No competing publishes to the same destination plot. `transaction`
  rebuilds the candidate set from live data immediately before its `UPDATE`,
  so a stem inserted by a concurrent publish between `setup` and
  `transaction` IS picked up and, if it qualifies, repaired. But `backup`
  runs before `transaction` and snapshots only the candidates known at that
  point — a stem that appears afterward is **not in the backup table**, so
  `rollback` cannot undo any repair applied to it. That gap, not a
  correctness problem in the repair itself, is why the maintenance window is
  mandatory: without it, a "successful" rollback can silently leave some
  repaired stems un-rolled-back.
- No concurrent manual edits to `Stem.PX/PY` or `Coordinates` on the target
  plot — the verification metrics assume nothing else is writing to these
  rows while the transaction is open.

## 4. Running the script

Follow the section order in the script's own header exactly:
`inputs` → `setup` → `preview` → `backup` → `transaction` → `verification`
→ (your own `COMMIT;` or `ROLLBACK;`) → `cleanup`.

Before you type `COMMIT;`, every one of these must hold. If any does not,
type `ROLLBACK;` instead and investigate — do not commit a run that fails
this checklist.

| Metric | Required value before COMMIT |
| --- | --- |
| `inputs_ok` | 1 |
| `bounds_ok` | 1 |
| `repair_allowed` | 1 |
| `rows_updated` | equals `stems_needing_repair` |
| `rows_updated_matches_stems_needing_repair` | 1 |
| `repaired_axes_not_equal_replacement` | 0 |
| `stems_repaired_not_in_backup` | 0 |
| `candidates_still_null_px` | equals `px_expected_still_null` |
| `candidates_still_null_py` | equals `py_expected_still_null` |
| `fresh_rebuild_proposes` | 0 |

`repair_allowed` is the gate that matters most: it is 0 if inputs are
missing/invalid (`inputs_ok`), or if **even one** candidate's proposed value
falls outside the plot bounds (`bounds_ok`). In either case the `UPDATE`
inside `transaction` affects zero rows for the *whole plot* — it is not a
partial repair. If `bounds_ok` is 0, review the sample rows printed by
`preview` before re-running with different inputs; never widen
`@plot_dimension_x/@plot_dimension_y` to make an out-of-bounds row pass
without first confirming the bounds you were given are wrong.

**If you already ran `backup` before discovering `repair_allowed` = 0**,
`stem_px_backup_20260909` now exists (holding a snapshot that was never
applied, since the blocked `transaction` updated zero rows). You must drop
it by hand — `DROP TABLE stem_px_backup_20260909;` — before retrying with
corrected inputs: `backup`'s plain `CREATE TABLE` (no `IF NOT EXISTS`)
refuses with `ER_TABLE_EXISTS_ERROR` on a second run rather than silently
reusing or overwriting the stale snapshot.

### ROLLBACK vs COMMIT

`ROLLBACK;` after `transaction` undoes the `UPDATE` and every other
statement issued since `START TRANSACTION;` — but not `backup`, which runs
before the transaction opens (as a `CREATE TABLE` plus an `INSERT`) and
survives regardless. That is deliberate: the backup snapshot exists whether
or not you commit. If you `ROLLBACK;`, drop `stem_px_backup_20260909` by
hand once you've confirmed you no longer need it — `cleanup` does not do
this for you (see below).

`COMMIT;` makes the `UPDATE` permanent. Immediately after, run `verification`
again if you have not already, then move to the post-commit steps.

## 5. Post-commit: rebuild ViewFullTable

The destination `ViewFullTable` carries its own `PX/PY` and does not update
automatically. After `COMMIT;`, rebuild it via the app's standalone rebuild
artifact:

- Endpoint: `GET /api/export/ctfs-rebuild-view/[schema]`
- Rendered by `renderRebuildViewFullTableArtifact` in
  `frontend/lib/ctfs-export/render-procedure.ts`

Download the generated SQL for the site whose plot you repaired and run it
against the destination. Then confirm the repaired coordinates appear in
`ViewFullTable` for a few of the stems you just fixed (cross-check against
the sample rows `preview` printed, or against `stem_px_backup_20260909`).

**No census is republished as part of this repair.** The rebuild artifact
only refreshes the reporting view; it does not touch `Stem`, `DBH`, or any
other measurement data.

## 6. cleanup — what it does and does not remove

`cleanup` drops only the two working tables
(`stem_px_repair_census_input_20260909`, `stem_px_repair_candidates_20260909`).
It deliberately does **not** drop `stem_px_backup_20260909` — that table is
your only way to reverse a bad commit. Keep it until you are confident the
repair is correct (including after the ViewFullTable rebuild and a look at
live data), then drop it by hand:

```sql
DROP TABLE stem_px_backup_20260909;
```

## 7. Undoing a repair after COMMIT

If you need to reverse a committed repair, run the script's `rollback`
section. It does two things, in order:

1. Reports `rollback_axes_diverged` — the count of repaired axes that no
   longer match what this run wrote (someone edited them since the
   commit), with a sample of the diverged rows. Those axes are **left
   alone**; the rollback never overwrites a value it did not itself write.
2. Restores every repaired axis that still matches its replacement value
   back to its pre-repair state (NULL, in every case this script produces),
   and reports `rollback_rows_restored`.

If `rollback_axes_diverged` is greater than 0, resolve those specific rows
by hand (they are listed in the sample) before deciding whether the rest of
the rollback is still what you want.

Run `cleanup` again after a post-commit `rollback` if you re-ran `setup` to
get back into a matching working-table state; otherwise it is not needed.

## 8. FLOAT-precision destinations

The canonical DDL's `DBCHANGES2014f` section widens `Stem.PX/PY/QX/QY` and
`Coordinates.PX/PY` to `decimal(16,5)`. This repair script and its
integration test both assume that ALTER has been applied. If the
destination you are repairing is still on the older `FLOAT` columns (the
DDL's own comment says "Have Taiwan run the update" — confirm, don't
assume), the values this script writes are stored at `FLOAT` precision on
that destination: a value like `992.34567` may come back as `992.34564`.
This does not change the script's logic (it never clamps or rounds beyond
what MySQL's column type does automatically), but do not expect
exact-string matches when checking live results manually the way the
integration test does against the canonical `decimal(16,5)` schema.

## 9. Recording results

Record, on [issue #475](https://github.com/Smithsonian/ForestGEO/issues/475):

- The plot and destination CensusIDs repaired.
- The full metric output from `preview` and from `verification` (before you
  typed `COMMIT;`).
- `rows_updated`.
- Confirmation the ViewFullTable rebuild ran and was spot-checked.
- Whether `stem_px_backup_20260909` was dropped, and when.
