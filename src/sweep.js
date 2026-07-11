// On-demand backfill: label + scorecard every open issue with no quality label.
// A single server-side search query filters to exactly those, so a swept issue
// drops out on the next run; re-running drains a backlog past the 1000-result cap.

import { LABEL } from "./schema.js";
import { run } from "./action.js";

/** @typedef {import('./github.js').GitHub} GitHub */

const QUALITY_LABELS = [LABEL.FAILING, LABEL.WARNING, LABEL.PASS];

/**
 * Search qualifiers selecting open issues (not PRs) with no quality label.
 * @returns {string}
 */
export function buildQuery() {
  const negations = QUALITY_LABELS.map((l) => `-label:"${l}"`).join(" ");
  return `is:issue is:open ${negations}`;
}

/**
 * Sweep every matching issue through the same gate core the CI action runs.
 * Resilient per-issue: a failure is collected and the sweep continues.
 * @param {object} params
 * @param {GitHub} params.gh
 * @param {(line: string) => void} [params.log] - Per-issue progress sink.
 * @returns {Promise<{swept: number, failed: number[], totalCount: number, capped: boolean}>}
 *   `capped` is true when the 1000-result cap truncated the results; re-run to continue.
 */
export async function sweep({ gh, log = () => {} }) {
  const { totalCount, items } = await gh.searchIssues(buildQuery());
  let swept = 0;
  const failed = [];
  for (const item of items) {
    try {
      log(await run({ gh, event: { issue: { number: item.number } } }));
      swept += 1;
    } catch (err) {
      failed.push(item.number);
      log(`issue #${item.number}: ERROR ${err.message || err}`);
    }
  }
  return { swept, failed, totalCount, capped: items.length < totalCount };
}
