// Choosing which scaffolds an `init` run installs (ADR 0016).
//
// Precedence is explicit `--only <ids>` -> interactive prompt (TTY) -> the
// recorded selection -> all-in. Each step is more specific than the next: a flag
// beats a question, a question beats a record, and a record beats the package
// default. The all-in tail is what keeps a scripted, non-interactive `init` in a
// pre-manifest repo behaving exactly as it did before the manifest existed.
//
// The one invariant every path upholds: `init` only ever ADDS. A selection that
// would drop an installed scaffold is refused and pointed at `uninstall`, so no
// run of a command whose job is to install can open a gap between the manifest
// and what is actually enforcing. The prompt goes further and makes deselection
// unrepresentable, offering only the scaffolds that are not yet installed.

import { SCAFFOLD_IDS } from "./constants.js";
import { sortScaffolds } from "./config.js";

/** The flag that names an explicit selection; comma-separated scaffold ids. */
export const ONLY_FLAG = "--only";

/**
 * Raised for a selection the CLI must reject. `code` is the process exit code:
 * 2 for a usage error (an unknown id, a malformed `--only`), 1 for a refusal of
 * a well-formed request (dropping an installed scaffold).
 */
export class SelectionError extends Error {
  /**
   * @param {string} message
   * @param {number} code - The exit code to leave the process with.
   */
  constructor(message, code) {
    super(message);
    this.name = "SelectionError";
    this.code = code;
  }
}

/** Exit code for a malformed request: the same one an unknown command uses. */
const USAGE_EXIT = 2;
/** Exit code for a well-formed request that is refused on policy. */
const REFUSED_EXIT = 1;

/** The known ids, for error messages that teach the vocabulary on the spot. */
const KNOWN = `Known scaffolds: ${SCAFFOLD_IDS.join(", ")}.`;

/**
 * Parse `--only <ids>` out of argv, accepting the ids comma-separated in one
 * argument, repeated across several `--only` flags, or both. Returns `null` when
 * the flag is absent, which is what hands control to the next precedence step.
 * @param {string[]} argv
 * @returns {string[]|null}
 * @throws {SelectionError} On a missing value or an unrecognized id.
 */
export function parseOnly(argv) {
  /** @type {string[]} */
  const ids = [];
  let present = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== ONLY_FLAG) continue;
    present = true;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new SelectionError(
        `${ONLY_FLAG} needs a comma-separated list of scaffold ids. ${KNOWN}`,
        USAGE_EXIT,
      );
    }
    i += 1;
    for (const id of value.split(",")) {
      const trimmed = id.trim();
      if (trimmed !== "") ids.push(trimmed);
    }
  }
  if (!present) return null;

  const unknown = ids.filter((id) => !SCAFFOLD_IDS.includes(id));
  if (unknown.length > 0) {
    throw new SelectionError(
      `${ONLY_FLAG}: unknown scaffold ${unknown.map((id) => `'${id}'`).join(", ")}. ${KNOWN}`,
      USAGE_EXIT,
    );
  }
  if (ids.length === 0) {
    throw new SelectionError(
      `${ONLY_FLAG} selected nothing. An init run that installs nothing is not a ` +
        `selection; name at least one scaffold. ${KNOWN}`,
      USAGE_EXIT,
    );
  }
  return sortScaffolds(ids);
}

/**
 * Refuse a selection that would drop a scaffold the manifest records as
 * installed. Deselection has exactly one home, the `uninstall` command, because
 * the failure modes differ: installing is idempotent and safe to run
 * half-attentively across a fleet, while deselecting from `init` would leave a
 * scaffold enforcing under a manifest that denies it.
 *
 * The error names both exits the operator has, since either may be the one they
 * meant: widen the selection, or uninstall first.
 * @param {string[]} chosen - The selection about to be installed.
 * @param {string[]} recorded - What the manifest currently lists.
 * @returns {void}
 * @throws {SelectionError} When the selection drops an installed scaffold.
 */
export function refuseDeselection(chosen, recorded) {
  const dropped = recorded.filter((id) => !chosen.includes(id));
  if (dropped.length === 0) return;
  const list = dropped.join(", ");
  throw new SelectionError(
    `This selection would drop ${list}, which this repo has installed. ` +
      "`init` only ever adds; it will not quietly stop recording a scaffold that " +
      "is still on disk and still enforcing.\n" +
      `Either widen the selection to include ${list}, or remove it first with: ` +
      `repo-contract uninstall ${dropped[0]}`,
    REFUSED_EXIT,
  );
}

/**
 * Resolve which scaffolds this run installs, applying the precedence above.
 *
 * The prompt is only reached on a TTY *and* when something is left to offer: in a
 * fully-installed repo there is nothing to ask about, so the common re-run and
 * `--force` upgrade path never stops for input. Whatever the prompt returns is
 * unioned with the record rather than replacing it, which is the additive
 * guarantee expressed in the data flow rather than merely checked afterwards.
 * @param {object} params
 * @param {string[]} params.argv - The remaining CLI args.
 * @param {string[]} params.recorded - The manifest's current contents.
 * @param {boolean} params.interactive - Whether to ask (a TTY on both ends).
 * @param {(offer: string[], installed: string[]) => Promise<string[]|null>} params.prompt
 *   Asks for the additions; resolves to null when the operator cancels.
 * @returns {Promise<{ids: string[], source: string}>} The selection and where it came from.
 * @throws {SelectionError}
 */
export async function resolveSelection({
  argv,
  recorded,
  interactive,
  prompt,
}) {
  const only = parseOnly(argv);
  if (only) {
    refuseDeselection(only, recorded);
    return { ids: only, source: ONLY_FLAG };
  }

  const offer = SCAFFOLD_IDS.filter((id) => !recorded.includes(id));
  if (interactive && offer.length > 0) {
    const added = await prompt(offer, recorded);
    if (added === null) {
      throw new SelectionError(
        "Cancelled. Nothing was written and the recorded selection is unchanged.",
        REFUSED_EXIT,
      );
    }
    const ids = sortScaffolds([...recorded, ...added]);
    if (ids.length === 0) {
      throw new SelectionError(
        "Nothing selected, so there is nothing to install. Re-run and choose at " +
          "least one scaffold.",
        REFUSED_EXIT,
      );
    }
    return { ids, source: "prompt" };
  }

  // Non-interactive, or nothing left to offer: honour the record, and fall
  // through to all-in only where there is no record at all. An absent manifest
  // means none installed (ADR 0016), so this tail is also what a repo scaffolded
  // before the manifest existed hits on its one migrating `init` run.
  if (recorded.length > 0) return { ids: recorded, source: "recorded" };
  return { ids: [...SCAFFOLD_IDS], source: "all-in" };
}
