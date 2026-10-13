import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function checkPromotion({
  cwd,
  baseRef,
  headRef,
  baseRepo,
  headRepo,
  baseSha,
  headSha,
  devSha,
}) {
  if (baseRef === "forestgeo-app-development")
    return "Development PR: promotion policy does not apply.";
  if (baseRef !== "main") throw new Error("Unexpected PR base branch.");
  if (!baseRepo || headRepo !== baseRepo)
    throw new Error("Main promotions must come from this repository.");
  if (
    headRef !== "forestgeo-app-development" &&
    !/^promote\/dev-to-main-.+/.test(headRef)
  ) {
    throw new Error(
      "Target forestgeo-app-development first. Main only accepts dev or promote/dev-to-main-* branches.",
    );
  }
  for (const sha of [baseSha, headSha, devSha]) {
    if (!/^[a-f0-9]{40}$/.test(sha ?? ""))
      throw new Error(
        "Expected full commit SHAs for main, the PR head, and dev.",
      );
  }
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const extra = git(
    "rev-list",
    "--no-merges",
    headSha,
    `^${baseSha}`,
    `^${devSha}`,
  );
  if (extra)
    throw new Error(
      `These commits have not landed in dev. Merge them through a dev PR first:\n${extra}`,
    );

  // A release may select an older dev snapshot while newer work continues.
  // Reject ambiguous ancestry instead of arbitrarily choosing a merge base.
  const snapshots = git("merge-base", "--all", headSha, devSha).split("\n");
  if (snapshots.length !== 1)
    throw new Error(
      "Ambiguous dev ancestry; rebuild the promotion from one dev snapshot.",
    );
  const mergeTree = (other) => {
    try {
      return git("merge-tree", "--write-tree", baseSha, other).split("\n")[0];
    } catch {
      throw new Error(
        "Promotion has merge conflicts. Reconcile main into dev through a dev PR first.",
      );
    }
  };
  // Checking commits alone misses edits smuggled into merge commits. Reproduce
  // the clean main + dev merge and compare its entire tree with the PR result.
  if (mergeTree(headSha) !== mergeTree(snapshots[0])) {
    throw new Error(
      "Promotion changes content beyond the main + dev merge. Land those changes in dev first.",
    );
  }
  return `Verified dev-first promotion from ${snapshots[0]}; existing main changes are preserved.`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      checkPromotion({
        cwd: process.cwd(),
        baseRef: process.env.PR_BASE_REF,
        headRef: process.env.PR_HEAD_REF,
        baseRepo: process.env.PR_BASE_REPO,
        headRepo: process.env.PR_HEAD_REPO,
        baseSha: process.env.PR_BASE_SHA,
        headSha: process.env.PR_HEAD_SHA,
        devSha: process.env.DEV_SHA,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
