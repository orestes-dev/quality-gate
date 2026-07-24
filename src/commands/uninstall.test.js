// Tests for `uninstall`, the single home for deselection (ADR 0016). The parsing
// is unit-tested directly; the removal is exercised end-to-end through the real
// CLI against a scratch git repo that `init` first populated, so the manifest,
// the on-disk files, and `core.hooksPath` are all real state, not stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTargets } from "./uninstall.js";
import { filesFor } from "../scaffolds.js";
import { SCAFFOLD, SCAFFOLD_IDS, CONFIG_FILENAME } from "../constants.js";
import { HOOKS_PATH } from "../hook-activation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "bin", "cli.js");

// A scratch git repo with a chosen set of scaffolds installed by the real `init`,
// so uninstall runs against a genuine manifest, real files, and a real
// `core.hooksPath`. `init`'s label/protection steps degrade to skipped with no
// credentials, so no network is touched.
function withInstalled(ids) {
  const dir = mkdtempSync(join(tmpdir(), "rc-uninstall-"));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  const res = spawnSync(
    process.execPath,
    [CLI, "init", "--only", ids.join(",")],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(res.status, 0, `init failed: ${res.stderr}`);
  return dir;
}

function runUninstall(dir, ...args) {
  return spawnSync(process.execPath, [CLI, "uninstall", ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

const readManifest = (dir) =>
  JSON.parse(readFileSync(join(dir, CONFIG_FILENAME), "utf8")).scaffolds;
// Read the *local* value only: a developer's global core.hooksPath (the tier-1
// hooks) is inherited by every fresh repo, so a merged read would never show a
// released value as unset.
const readLocalHooksPath = (dir) =>
  spawnSync(
    "git",
    ["-C", dir, "config", "--local", "--get", "core.hooksPath"],
    { encoding: "utf8" },
  ).stdout.trim();

test("parseTargets rejects an unknown id and lists the known ones", () => {
  const parsed = parseTargets(["issue-quality"]);
  assert.ok("error" in parsed);
  assert.match(parsed.error, /unknown scaffold 'issue-quality'/);
  for (const id of SCAFFOLD_IDS) assert.ok(parsed.error.includes(id));
});

test("parseTargets rejects naming nothing", () => {
  const parsed = parseTargets(["--force"]);
  assert.ok("error" in parsed);
  assert.match(parsed.error, /at least one scaffold/);
});

test("parseTargets dedups and orders like SCAFFOLD_IDS", () => {
  const parsed = parseTargets([
    `${SCAFFOLD.GIT_HOOKS},${SCAFFOLD.QUALITY_GATES}`,
    SCAFFOLD.GIT_HOOKS,
  ]);
  assert.deepEqual(parsed, {
    ids: [SCAFFOLD.QUALITY_GATES, SCAFFOLD.GIT_HOOKS],
  });
});

test("uninstall removes one scaffold's files and leaves the others", () => {
  const dir = withInstalled(SCAFFOLD_IDS);
  try {
    const res = runUninstall(dir, SCAFFOLD.COMMIT_HYGIENE);
    assert.equal(res.status, 0, res.stderr);

    // The named scaffold's files are gone; the others survive.
    for (const { to } of filesFor([SCAFFOLD.COMMIT_HYGIENE])) {
      assert.ok(!existsSync(join(dir, to)), `${to} should be removed`);
    }
    for (const { to } of filesFor([
      SCAFFOLD.QUALITY_GATES,
      SCAFFOLD.GIT_HOOKS,
    ])) {
      assert.ok(existsSync(join(dir, to)), `${to} should survive`);
    }
    // The manifest records exactly what remains.
    assert.deepEqual(readManifest(dir), [
      SCAFFOLD.QUALITY_GATES,
      SCAFFOLD.GIT_HOOKS,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstalling git-hooks unsets the managed core.hooksPath", () => {
  const dir = withInstalled([SCAFFOLD.GIT_HOOKS]);
  try {
    assert.equal(
      readLocalHooksPath(dir),
      HOOKS_PATH,
      "precondition: hooks active",
    );
    const res = runUninstall(dir, SCAFFOLD.GIT_HOOKS);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readLocalHooksPath(dir), "", "core.hooksPath is handed back");
    assert.match(res.stdout, /unset\s+core\.hooksPath/);
    // Removing the last scaffold removes the key rather than writing [].
    assert.ok(
      !existsSync(join(dir, CONFIG_FILENAME)) ||
        !(
          "scaffolds" in
          JSON.parse(readFileSync(join(dir, CONFIG_FILENAME), "utf8"))
        ),
      "the scaffolds key is gone",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstalling git-hooks leaves a foreign core.hooksPath alone", () => {
  const dir = withInstalled([SCAFFOLD.QUALITY_GATES]);
  try {
    execFileSync("git", ["-C", dir, "config", "core.hooksPath", ".husky"], {
      stdio: "ignore",
    });
    const res = runUninstall(dir, SCAFFOLD.GIT_HOOKS);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      readLocalHooksPath(dir),
      ".husky",
      "the operator's value survives",
    );
    assert.match(res.stdout, /keep\s+core\.hooksPath=\.husky/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstalling a scaffold that is not installed is a no-op that says so", () => {
  const dir = withInstalled([SCAFFOLD.GIT_HOOKS]);
  try {
    const res = runUninstall(dir, SCAFFOLD.COMMIT_HYGIENE);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /commit-hygiene is not installed/);
    // The untouched scaffold's manifest entry is unchanged.
    assert.deepEqual(readManifest(dir), [SCAFFOLD.GIT_HOOKS]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A recorded scaffold whose files were removed by hand is still touched: the
// manifest entry goes, and the `Files:` section names it rather than printing an
// empty heading.
test("uninstall reports a recorded scaffold whose files are already gone", () => {
  const dir = withInstalled([SCAFFOLD.QUALITY_GATES, SCAFFOLD.GIT_HOOKS]);
  try {
    for (const { to } of filesFor([SCAFFOLD.QUALITY_GATES])) {
      rmSync(join(dir, to));
    }
    const res = runUninstall(dir, SCAFFOLD.QUALITY_GATES);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /quality-gates: no files on disk to remove/);
    assert.deepEqual(readManifest(dir), [SCAFFOLD.GIT_HOOKS]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An orphan (files on disk the manifest never recorded) is removable by naming
// its scaffold, which is the resolution `findOrphans` reports has none without
// this command. Built by installing both, then rewriting the manifest to record
// only one while the other's files stay on disk.
test("uninstall removes an orphan the manifest never recorded", () => {
  const dir = withInstalled([SCAFFOLD.QUALITY_GATES, SCAFFOLD.COMMIT_HYGIENE]);
  try {
    writeFileSync(
      join(dir, CONFIG_FILENAME),
      `${JSON.stringify({ scaffolds: [SCAFFOLD.QUALITY_GATES] }, null, 2)}\n`,
    );
    for (const { to } of filesFor([SCAFFOLD.COMMIT_HYGIENE])) {
      assert.ok(existsSync(join(dir, to)), "precondition: orphan file present");
    }

    const res = runUninstall(dir, SCAFFOLD.COMMIT_HYGIENE);
    assert.equal(res.status, 0, res.stderr);
    for (const { to } of filesFor([SCAFFOLD.COMMIT_HYGIENE])) {
      assert.ok(!existsSync(join(dir, to)), `${to} removed`);
    }
    // The record already omitted the orphan, so the manifest is left unchanged.
    assert.deepEqual(readManifest(dir), [SCAFFOLD.QUALITY_GATES]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstall names the removed scaffold's labels as manual cleanup", () => {
  const dir = withInstalled(SCAFFOLD_IDS);
  try {
    const res = runUninstall(dir, SCAFFOLD.COMMIT_HYGIENE);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Remote labels \(manual cleanup, not deleted\)/);
    assert.match(res.stdout, /commit-hygiene:failing/);
    assert.match(res.stdout, /gh label delete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstall with an unknown id exits 2 and writes nothing", () => {
  const dir = withInstalled([SCAFFOLD.GIT_HOOKS]);
  try {
    const before = readFileSync(join(dir, CONFIG_FILENAME), "utf8");
    const res = runUninstall(dir, "issue-quality");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown scaffold 'issue-quality'/);
    assert.equal(
      readFileSync(join(dir, CONFIG_FILENAME), "utf8"),
      before,
      "the manifest is untouched",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
