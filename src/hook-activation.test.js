// Tests for the `core.hooksPath` plumbing shared by `init` and `uninstall`.
// `ensureHooksPath` (the install side) is exercised end-to-end through a real
// `git commit` in `git-hooks.test.js`; this file covers `releaseHooksPath`, the
// uninstall side, which must be conservative: it releases only this repo's own
// local managed value and leaves anything else (a foreign local value, or the
// global tier-1 hooks) exactly as it found it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOOKS_PATH, releaseHooksPath } from "./hook-activation.js";

// A scratch git repo with an optional starting *local* `core.hooksPath`,
// auto-cleaned. Reads assert against the local scope, since a developer's global
// `core.hooksPath` (the tier-1 hooks) is inherited by every fresh repo's merged
// config and would mask an unset local value.
function withRepo(hooksPath) {
  const dir = mkdtempSync(join(tmpdir(), "rc-release-"));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  if (hooksPath !== undefined) {
    execFileSync("git", ["-C", dir, "config", "core.hooksPath", hooksPath], {
      stdio: "ignore",
    });
  }
  return dir;
}

const readLocal = (dir) =>
  execFileSync(
    "git",
    ["-C", dir, "config", "--local", "--get", "core.hooksPath"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();

// `--local --get` exits 1 when the key is unset locally; treat that as "".
const readLocalOrEmpty = (dir) => {
  try {
    return readLocal(dir);
  } catch {
    return "";
  }
};

test("releaseHooksPath unsets the managed local value and reports it", () => {
  const dir = withRepo(HOOKS_PATH);
  try {
    const lines = [];
    const outcome = releaseHooksPath({ cwd: dir, log: (l) => lines.push(l) });
    assert.equal(outcome, "released");
    assert.equal(readLocalOrEmpty(dir), "", "local core.hooksPath is unset");
    assert.match(lines[0], /^unset\s+core\.hooksPath/);
    assert.match(lines[0], /handed back/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A local value repo-contract did not set is not ours to remove: an operator's
// own directory, or a legacy `.husky` ADR 0017 leaves for `init` to repair.
test("releaseHooksPath leaves a foreign local value alone and reports it", () => {
  const dir = withRepo(".husky");
  try {
    const lines = [];
    const outcome = releaseHooksPath({ cwd: dir, log: (l) => lines.push(l) });
    assert.equal(outcome, "left");
    assert.equal(readLocalOrEmpty(dir), ".husky", "the foreign value survives");
    assert.match(lines[0], /^keep\s+core\.hooksPath=\.husky/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// With no local value, there is nothing repo-contract set to release: the global
// tier-1 hooks (if any) simply keep running, untouched.
test("releaseHooksPath is a no-op when no local core.hooksPath is set", () => {
  const dir = withRepo(undefined);
  try {
    const lines = [];
    const outcome = releaseHooksPath({ cwd: dir, log: (l) => lines.push(l) });
    assert.equal(outcome, "absent");
    assert.match(lines[0], /^ok\s+core\.hooksPath is not set in this repo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("releaseHooksPath skips outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-release-nogit-"));
  try {
    const lines = [];
    const outcome = releaseHooksPath({ cwd: dir, log: (l) => lines.push(l) });
    assert.equal(outcome, "skipped");
    assert.match(lines[0], /^skip\s+core\.hooksPath \(no git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
