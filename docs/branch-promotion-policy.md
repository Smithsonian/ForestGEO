# Dev-first promotion

Feature, fix, documentation, and workflow PRs target `forestgeo-app-development`.
Release PRs target `main` from that branch or a same-repository
`promote/dev-to-main-*` branch based on a selected dev snapshot.

The required `promotion-policy` check on main verifies that every newly
introduced non-merge commit is already reachable from dev. It also compares the
proposed merge's complete tree with a clean merge of main and the selected dev
snapshot. This preserves existing main changes and rejects extra edits hidden
in merge commits. An older dev snapshot is permitted while development continues.

If a promotion needs a fix or conflict resolution, submit that work to dev first.
Do not add release-only fixes to the promotion branch. In particular, preserve
main's validation-deployment safeguard until its replacement has landed in dev.

Main checks out the checker from dev, so checker changes must land there before
they can affect promotions. The workflow has read-only contents permission and
does not persist checkout credentials. Review changes to this workflow and its
checker as branch-policy changes, like other required CI workflows.

## Rollout and protection

Land this workflow in dev first; the next dev-to-main promotion carries it to
main. A main PR without the workflow will not report the required check and will
remain blocked. Do not bypass it to promote a snapshot predating this workflow.
Dev PRs run the policy tests but are not subject to the promotion restriction.

Add `promotion-policy` (GitHub Actions app ID 15368) to main's required status
checks while preserving its existing checks. Existing administrator bypass and
force-push settings are separate controls; a required check does not remove them.

Changing the repository default branch is also separate. This policy names both
branches explicitly and works with either default.

Run the isolated Git-history tests with:

```sh
node --test scripts/check-promotion.test.mjs
```
