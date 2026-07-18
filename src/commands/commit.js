// CI process entry for the commit gate: build a GitHub client from the
// environment, load the triggering `pull_request` event, and run the gate core
// with the commit descriptor. Invoked by `action.yml` when its `object` input is
// `commit`. The commit gate hard-fails, so a failing verdict exits non-zero and
// turns the check red, blocking merge.

import { readFileSync } from "node:fs";

import { GitHub } from "../github.js";
import { run } from "../action.js";
import { commitGate } from "../gates/commit.js";
import { STATUS } from "../constants.js";

/**
 * Load the webhook event payload from `GITHUB_EVENT_PATH`.
 * @returns {object}
 * @throws {Error} When the env var is unset.
 */
function loadEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("GITHUB_EVENT_PATH is not set.");
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Gate the PR named in the triggering event, logging the outcome. Exits 1 on a
 * failing verdict so the check blocks merge.
 * @returns {Promise<void>}
 */
async function main() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set.");
  const gh = new GitHub({
    token,
    apiUrl: process.env.GITHUB_API_URL,
    owner,
    repo,
  });
  const { summary, status } = await run({
    gh,
    event: loadEvent(),
    gate: commitGate,
  });
  console.log(summary);
  if (commitGate.hardFail && status === STATUS.FAIL) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
