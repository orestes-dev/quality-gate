// CI process entry: build a GitHub client from the environment, load the
// triggering webhook event, and run the gate core against it. Invoked directly
// by `action.yml` (`node src/commands/action.js`); the pure logic lives in
// `../action.js`.

import { readFileSync } from "node:fs";

import { GitHub } from "../github.js";
import { run } from "../action.js";

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
 * Gate the issue named in the triggering event, logging the outcome.
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
  const summary = await run({ gh, event: loadEvent() });
  console.log(summary);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
