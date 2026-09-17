# Decision: one-time historical DBH re-score

On 2026-09-17, Mason chose to use the historical re-score in PR #473 as a temporary migration tool, then remove its dedicated code after accepted completion and an agreed rollback window. Ordinary validation continues to use the annualised DBH rules. The historical sweep is not a permanent service, scheduled job, or supported API/UI feature.

The [operator runbook](../../frontend/docs/validation-rescore-runbook.md) is the single source for execution, reconciliation, acceptance, rollback, and retirement. Its completion record must name an owner, the intended scopes, a recoverable source revision, private evidence archive, and rollback-window start/end before production apply. No window duration is implied by this decision.

Removal requires every intended site/census and affected later census to be reconciled and accepted, with no unknown, deferred, held, or artifact-failed outcomes outstanding. Disabled or excluded scopes need an explicit disposition; a skipped scope is not a completed re-score. Mason or a named delegate signs off after the rollback window ends.

Remove the dedicated CLI, sweep, re-score recovery/artifact orchestration, rollback-only seed refresher, and their exclusive tests/assets after a caller audit. Preserve the exact reviewed Git revision in retained history or a durable ref, runtime and dependency information, manifest hashes, private snapshot/artifact references, and verified recovery instructions. Keep the runbook and this decision as historical documentation.

Retain the annualised SQL rules, applied schema migrations and ledger integrity, shared DBH execution/finalization, manager-override semantics, notices, shared SQL parsers, independently justified connection-manager fixes, and their runtime regression coverage. Do not remove a helper simply because the migration also uses it.

This records the chosen lifecycle; it does not execute or authorize production changes, merge/deployment, or immediate tool removal. The September 17 review's non-atomic override operation and recovery-marker/user-notice collision remain unresolved by these documentation-only changes; record their disposition before apply as required by the runbook.
