// On-demand backfill: label + scorecard every open issue that has no quality
// label yet. Unlike the CI action (one issue per webhook event), `sweep` walks
// the whole repo, so it is the tool for retro-fitting the gate onto an existing
// backlog.
//
// All filtering is server-side via a single search query: open issues only, no
// pull requests (`is:issue`), and none already carrying a quality label. So
// only issues that need work come back — there is no client-side skip pass.
// Because sweeping labels an issue, it drops out of the query on the next run;
// re-running therefore drains a backlog larger than the Search API's 1000-result
// cap, one page-sized bite at a time.

import { LABEL } from './schema.js';
import { run } from './action.js';

const QUALITY_LABELS = [LABEL.FAILING, LABEL.WARNING, LABEL.PASS];

// Search qualifiers selecting open issues (not PRs) that carry no quality label.
export function buildQuery() {
  const negations = QUALITY_LABELS.map((l) => `-label:"${l}"`).join(' ');
  return `is:issue is:open ${negations}`;
}

// Sweep every matching issue through the same gate core the CI action runs.
// Resilient per-issue: one failure is collected and the sweep continues, so a
// transient error on one issue never abandons the rest (and the sweep is
// re-runnable — already-labeled issues are skipped by the query next time).
//
// Returns `{ swept, failed, totalCount, capped }`: `swept` is the count driven
// to a labeled state, `failed` the issue numbers that errored, `totalCount` the
// full match count, and `capped` true when the 1000-result cap truncated the
// results (more issues match than were fetched — re-run to continue).
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
