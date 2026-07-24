// `uninstall <ids>`: the single home for deselection (ADR 0016). `init` only ever
// adds and refuses a selection that would drop an installed scaffold, pointing
// here; this command removes exactly one or more named scaffolds' footprint and
// nothing adjacent, reading the same per-scaffold manifest `init` installs from
// (`scaffolds.js`).
//
// It is deliberately conservative, the mirror of `init`'s assertiveness. It
// removes only the files the manifest names, rewrites the `scaffolds` key to what
// remains (removing the key when the last scaffold goes), and unsets
// `core.hooksPath` only where it still holds the managed value. It never deletes a
// remote label (those sit on live issues and PRs, so they are named as manual
// cleanup, not removed), never touches the consumer-owned
// `.repo-contract/hooks/local` chain `init` never wrote, and never reverts a
// repo's `.repo-contract.json` `overrides`.

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { CONFIG_FILENAME, SCAFFOLD, SCAFFOLD_IDS } from "../constants.js";
import { scaffold, labelsFor } from "../scaffolds.js";
import {
  loadConfig,
  writeScaffolds,
  removeScaffoldsKey,
  sortScaffolds,
} from "../config.js";
import {
  releaseHooksPath,
  readHooksPath,
  HOOKS_PATH,
} from "../hook-activation.js";

/** Exit code for a malformed request, matching `init`'s unknown-id/usage exit. */
const USAGE_EXIT = 2;

/** The known ids, for error messages that teach the vocabulary on the spot. */
const KNOWN = `Known scaffolds: ${SCAFFOLD_IDS.join(", ")}.`;

/**
 * Parse the scaffold ids to uninstall out of argv. Targets are positional (removal
 * names things, it does not describe a selection the way `init --only` does),
 * accepted space-separated across arguments, comma-separated within one, or both,
 * and validated against the known ids. Flags are ignored so the surface can grow
 * later without this rejecting them.
 * @param {string[]} argv
 * @returns {{ids: string[]} | {error: string}}
 */
export function parseTargets(argv) {
  /** @type {string[]} */
  const raw = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) continue;
    for (const id of arg.split(",")) {
      const trimmed = id.trim();
      if (trimmed !== "") raw.push(trimmed);
    }
  }

  const unknown = raw.filter((id) => !SCAFFOLD_IDS.includes(id));
  if (unknown.length > 0) {
    return {
      error: `uninstall: unknown scaffold ${unknown.map((id) => `'${id}'`).join(", ")}. ${KNOWN}`,
    };
  }
  if (raw.length === 0) {
    return {
      error: `uninstall needs at least one scaffold id to remove. ${KNOWN}`,
    };
  }
  // Dedup and order the way every other surface lists them, so a repeated id is
  // harmless and the report reads in the canonical order.
  return { ids: sortScaffolds(raw) };
}

/**
 * Remove one scaffold's on-disk files, reporting per file and returning what it
 * did so the caller can decide the manifest and no-op messaging. Files the
 * scaffold declares but that are absent are skipped: an orphan (some files
 * present, manifest silent) and a partial install both resolve to "remove what
 * is there".
 * @param {string} id
 * @param {boolean} recorded - Whether the manifest lists this scaffold.
 * @param {string} cwd
 * @param {(line: string) => void} log
 * @returns {{removed: number}}
 */
function removeScaffoldFiles(id, recorded, cwd, log) {
  const { files } = scaffold(id);
  const present = files
    .map((f) => f.to)
    .filter((to) => existsSync(resolve(cwd, to)));

  for (const to of present) {
    rmSync(resolve(cwd, to));
    log(`remove   ${to}`);
  }
  // A scaffold with no files (git-hooks vendors none on the remote side; its
  // footprint is the hooks, handled in Activation) still counts as touched when
  // it was recorded, so the manifest rewrite below fires.
  if (present.length === 0 && (recorded || files.length === 0)) {
    log(`ok       ${id}: no files on disk to remove`);
  }
  return { removed: present.length };
}

/**
 * Remove a selected subset of scaffolds' footprint from the current repo.
 *
 * Files first: each named scaffold's on-disk files are deleted (an orphan is
 * removable by naming its scaffold, which is the only resolution the state
 * `findOrphans` reports has). Then activation: uninstalling `git-hooks` unsets
 * `core.hooksPath` only when it still holds the managed `.repo-contract/hooks`,
 * handing control back to any global tier-1 hooks; a value pointing elsewhere is
 * left alone and reported. Then the manifest is rewritten to the remaining set,
 * the key removed entirely when the last scaffold goes. Finally the remote labels
 * the removed scaffolds own are named as manual cleanup, never deleted: they are
 * applied to live issues and PRs.
 *
 * Uninstalling a scaffold that is neither recorded nor on disk is a no-op that
 * says so, not an error.
 * @param {string[]} [argv]
 * @returns {Promise<void>}
 */
export async function uninstall(argv = []) {
  const cwd = process.cwd();
  const parsed = parseTargets(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(USAGE_EXIT);
  }
  const { ids } = parsed;
  const recorded = loadConfig(cwd).scaffolds;

  console.log(`Uninstalling ${ids.join(", ")}\n`);

  // A scaffold contributes nothing to remove when it has no files on disk, is not
  // recorded, and (for git-hooks) is not the value core.hooksPath still holds.
  const enforcing =
    ids.includes(SCAFFOLD.GIT_HOOKS) && readHooksPath(cwd) === HOOKS_PATH;
  const noop = ids.filter((id) => {
    const onDisk = scaffold(id).files.some((f) =>
      existsSync(resolve(cwd, f.to)),
    );
    const active = id === SCAFFOLD.GIT_HOOKS && enforcing;
    return !onDisk && !recorded.includes(id) && !active;
  });

  console.log("Files:");
  for (const id of ids) {
    if (noop.includes(id)) {
      console.log(
        `ok       ${id} is not installed (no files on disk, not in the manifest); nothing to remove`,
      );
      continue;
    }
    removeScaffoldFiles(id, recorded.includes(id), cwd, (line) =>
      console.log(line),
    );
  }

  if (ids.includes(SCAFFOLD.GIT_HOOKS)) {
    console.log("\nActivation:");
    releaseHooksPath({ cwd, log: (line) => console.log(line) });
  }

  const remaining = recorded.filter((id) => !ids.includes(id));
  console.log("\nManifest:");
  if (remaining.length === recorded.length) {
    console.log(
      `ok       ${CONFIG_FILENAME} unchanged (none of the named scaffolds were recorded)`,
    );
  } else if (remaining.length === 0) {
    removeScaffoldsKey(cwd);
    console.log(
      `update   removed the "scaffolds" key from ${CONFIG_FILENAME} (nothing installed)`,
    );
  } else {
    writeScaffolds(remaining, cwd);
    console.log(
      `update   ${CONFIG_FILENAME} now records: ${sortScaffolds(remaining).join(", ")}`,
    );
  }

  const labels = labelsFor(ids);
  if (labels.length > 0) {
    console.log("\nRemote labels (manual cleanup, not deleted):");
    for (const { name } of labels) {
      console.log(`keep     ${name}`);
    }
    console.log(
      `         These are applied to live issues and PRs, so uninstall leaves them. ` +
        `Delete any you no longer want by hand: gh label delete <name>.`,
    );
  }

  console.log(`\nDone. Uninstalled ${ids.join(", ")}.`);
}
