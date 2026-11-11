import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkPromotion } from "./check-promotion.mjs";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "promotion-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Policy Test");
  git("config", "user.email", "policy@example.invalid");
  git("config", "commit.gpgsign", "false");
  const commit = (file, content) => {
    writeFileSync(join(cwd, file), content);
    git("add", file);
    git("commit", "-m", file);
    return git("rev-parse", "HEAD");
  };
  commit("shared", "initial");
  git("branch", "dev");
  const baseSha = commit("production-safeguard", "keep");
  git("checkout", "dev");
  const devSha = commit("feature", "reviewed on dev");
  const options = {
    cwd,
    baseRef: "main",
    headRef: "promote/dev-to-main-test",
    baseRepo: "org/repo",
    headRepo: "org/repo",
    baseSha,
    headSha: devSha,
    devSha,
  };
  return { git, commit, options };
}

test("ordinary dev PRs are permitted; missing or unknown bases fail closed", () => {
  assert.match(
    checkPromotion({ baseRef: "forestgeo-app-development" }),
    /does not apply/,
  );
  assert.throws(() => checkPromotion({}), /Unexpected/);
});

test("direct dev promotion preserves main-only safeguards", (t) => {
  const { options } = fixture(t);
  assert.match(
    checkPromotion({ ...options, headRef: "forestgeo-app-development" }),
    /Verified/,
  );
});

test("a promotion branch can merge main and release an older dev snapshot", (t) => {
  const { git, commit, options } = fixture(t);
  git("checkout", "-b", "promotion");
  git("merge", "--no-ff", "main", "-m", "Merge main");
  options.headSha = git("rev-parse", "HEAD");
  git("checkout", "dev");
  options.devSha = commit("future-work", "not in this release");
  assert.match(checkPromotion(options), /Verified/);
});

test("feature branches and forks cannot target main", (t) => {
  const { options } = fixture(t);
  assert.throws(
    () => checkPromotion({ ...options, headRef: "fix/bypass" }),
    /Target forestgeo/,
  );
  assert.throws(
    () => checkPromotion({ ...options, headRepo: "fork/repo" }),
    /this repository/,
  );
  assert.throws(
    () => checkPromotion({ ...options, headSha: "--help" }),
    /full commit SHAs/,
  );
});

test("a new commit on a correctly named promotion branch is rejected", (t) => {
  const { commit, options } = fixture(t);
  options.headSha = commit("unreviewed", "never landed in dev");
  assert.throws(() => checkPromotion(options), /not landed in dev/);
});

test("content added in a merge commit is rejected, including removal of a main safeguard", (t) => {
  const { git, options } = fixture(t);
  git("merge", "--no-ff", "--no-commit", "main");
  git("rm", "-f", "production-safeguard");
  git("commit", "-m", "Merge with hidden change");
  options.headSha = git("rev-parse", "HEAD");
  assert.throws(() => checkPromotion(options), /changes content beyond/);
});

test("merge conflicts require reconciliation in dev", (t) => {
  const { git, commit, options } = fixture(t);
  options.devSha = options.headSha = commit("shared", "dev edit");
  git("checkout", "main");
  options.baseSha = commit("shared", "main edit");
  assert.throws(() => checkPromotion(options), /merge conflicts/);
});
