// `sweep`: backfill labels + scorecards across a repo's open issues.

import { execFileSync } from "node:child_process";

import { GitHub } from "../github.js";
import { sweep as runSweep } from "../sweep.js";

/**
 * Run a `gh` CLI command, exiting with a hint on failure. `sweep` runs locally,
 * so it borrows the operator's `gh` session for creds and repo context instead
 * of a GITHUB_TOKEN + --repo flag.
 * @param {string[]} args - Arguments passed to `gh`.
 * @param {string} hint - Remediation shown if the command fails.
 * @returns {string} Trimmed stdout.
 */
function gh(args, hint) {
  try {
    return execFileSync("gh", args, { encoding: "utf8" }).trim();
  } catch {
    console.error(`error: \`gh ${args.join(" ")}\` failed. ${hint}`);
    process.exit(2);
  }
}

/**
 * Backfill the current repo's open issues, then exit non-zero if any failed.
 * @returns {Promise<void>}
 */
export async function sweep() {
  const token = gh(
    ["auth", "token"],
    "Install the GitHub CLI and run `gh auth login`.",
  );
  const { owner, name } = JSON.parse(
    gh(
      ["repo", "view", "--json", "owner,name"],
      "Run this from inside a GitHub repository clone.",
    ),
  );
  const client = new GitHub({
    token,
    apiUrl: process.env.GITHUB_API_URL,
    owner: owner.login,
    repo: name,
  });

  const { swept, failed, totalCount, capped } = await runSweep({
    gh: client,
    log: (line) => console.log(line),
  });

  const tally = `swept ${swept}, failed ${failed.length}`;
  console.log(`\n${tally}`);
  if (capped) {
    console.log(
      `note: ${totalCount} issues matched but the Search API caps results at ` +
        "1000. Swept issues drop out of the query, so re-run `sweep` to continue.",
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
