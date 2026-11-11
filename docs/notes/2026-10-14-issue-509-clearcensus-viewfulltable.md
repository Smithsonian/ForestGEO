# Issue #509: census deletion left historical rows in viewfulltable

## Problem

`viewfulltable` is materialized by `RefreshViewFullTable`, not recomputed on
read. `clearcensusfull`/`clearcensusmsmts` deleted a census's rows from
`coremeasurements`, `stems`, `trees`, and `measurementssummary` but never
`viewfulltable`, leaving a cleared census's rows visible there indefinitely.
Neither procedure had an `EXIT HANDLER`, so a mid-procedure `SQLEXCEPTION`
left the pooled connection with an open transaction and
`foreign_key_checks`/`@disable_triggers` still overridden for the next
borrower. `clearcensusfull`'s single-remaining-census branch also used
`TRUNCATE` (implicit-commit DDL) on nine reference tables, breaking the
"one atomic transaction" guarantee, and `TRUNCATE`d `unifiedchangelog`,
destroying audit history on every full clear.

## Fix

Both procedures now `DELETE FROM viewfulltable WHERE CensusID = ...` inside
the same transaction as every other census-scoped delete; declare an
`EXIT HANDLER FOR SQLEXCEPTION` that `ROLLBACK`s and restores session state
before `RESIGNAL`ing; capture `foreign_key_checks` into a local variable and
`@disable_triggers` into a nullable local variable (`DECLARE ... INT DEFAULT
NULL` — MySQL locals round-trip `NULL` fine) before overriding, and restore
those exact captured values — not a hard-coded `1`/`0` — on both the success
path and the handler path, so a caller's own pre-existing session state
(including an already-`NULL` `@disable_triggers`) survives the call
unchanged. The nine reference-table `TRUNCATE`s became `DELETE`s so the
`EXIT HANDLER`'s `ROLLBACK` actually reverts them; `truncate
unifiedchangelog;` was removed outright — it is audit history, not census
data, and is no longer touched by either procedure.

## Rollout

Existing provisioned sites keep running their already-deployed procedure
bodies until the established `deploy:procedures` step re-creates them from
this file. No retrospective cleanup of `viewfulltable` rows already
orphaned by a census cleared under the old procedure body is performed.
