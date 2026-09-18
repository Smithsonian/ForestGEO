# Issue #434: complete test schema loading

Branch `codex/issue-434-test-schema-loader` starts at development commit
`369f0f90` in an isolated worktree. Existing work for handoff items 1 and 2
was preserved in the original checkout.

## Cause and change

`loadSchema` split the canonical SQL on semicolons, then discarded each
chunk starting with `--`. A banner comment therefore discarded the following
SQL statement too. Running the original loader against a disposable local
MySQL database confirmed that `upload_errors`, `upload_sessions`, and
`validation_runs` were all absent despite a successful return.

The loader now removes leading comment and blank lines while preserving the
following statement. After loading, it independently derives table names from
the canonical DDL and checks them against the selected database's base tables.
Missing tables cause setup to fail with their names. Foreign-key checks are
restored even when loading or metadata verification fails.

Declaration matching follows the canonical file's line-start CREATE TABLE
format. The September 18 pre-merge follow-up replaces the local splitter with the
existing provisioning `splitSqlFile` parser. Quoted semicolons and escaped
quotes use that shared implementation; no second parser is maintained.

Seven duplicate table-creation statements were removed from four integration
test files. These suites now use the canonical table definitions. Production
upload-session bootstrap calls and existing behavioral assertions remain.
The provisioning lifecycle test still checks the separate production DDL path.
No production schema, migration, or application code changed.

## Verification

- Focused harness tests passed before the review follow-up; the final full unit
  run includes the added declaration-matching regressions.
- Full unit suite: 271 files, 4,204 tests passed.
- Full integration suite under `TZ=Europe/Bratislava`, using local Docker
  MySQL 8.0.36: 132 files, 1,210 tests passed, 7 skipped. No failures surfaced
  from restoring the missing tables or removing compensating DDL.
- The infrastructure regression checks all 33 canonical table declarations,
  including the three previously missing tables.
- `npm run build` passed, including formatting, lint, and type checking. Its
  initial sandboxed attempt could not download Google Fonts; the permitted
  network-enabled retry passed.
- `git diff --check` and `graphify update .` passed.

Implementation and review fixes used Fable orchestration with Sonnet workers;
actual response metadata confirmed `claude-fable-5` and `claude-sonnet-5`.
Codex reviewed the original diff and ran validation. September 18: this
branch is integrated into PR #473 with shared-parser reuse as simplicity fix 4.
The original verification above predates that integration; current release
checks are recorded in the annual DBH release notes.
