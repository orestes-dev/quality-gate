# An unrecoverable GitHub outage fails red, distinctly from a rule violation

The gate reads a PR or issue fresh from the GitHub API before it can judge it. A
transient GitHub 5xx during that read used to throw, crash the run, and turn the
check red with no on-object explanation: indistinguishable from a real rule
violation, and diagnosable only by opening the job log. During GitHub's
2026-07-16 REST degradation a consumer's PR run died with `Failed to fetch pull
request: 503` and blocked merge as if the PR itself were malformed. A 503 is a
statement about GitHub, not about the diff.

The client now separates the two faults at the shared fetch choke point
(`#fetchWithRetry` in `src/github.js`). A 4xx is returned to the caller unchanged
and still fails the check: a 404 or 403 is an actionable statement about the
object (missing, forbidden), a real failure. A 5xx or a network/timeout error is
retried with bounded exponential backoff (`RETRY_ATTEMPTS`), so a blip that
resolves inside the window never surfaces at all. Only a fault that outlives the
window raises `ApiUnavailableError`, which the gate core catches around the fetch.

The open question this ADR settles is what that surviving outage does to the
check. Three behaviours were on the table.

## Considered options

- **Fail neutral or green on an unrecoverable 5xx.** Rejected: a gate that yields
  to an API error is a gate any API error can defeat. Neutral/green would let an
  unreviewed PR clear a merge-blocking gate by racing (or waiting out) a GitHub
  incident, which is worse than a false red. The gate exists to block an unwanted
  state; abdicating on infrastructure trouble hands that state a bypass.
- **Keep failing red with the bare `503` message.** Rejected: this is today's
  behaviour and the bug. A red check whose only explanation is a status code
  buried in the job log is indistinguishable on the object from a genuine rule
  violation, so an author cannot tell "GitHub is down, wait and re-run" from "your
  PR is malformed, go fix it."
- **Fail red, but annotate the object with a distinct outage notice.** Chosen. The
  outcome is still a red check (the gate does not yield), but the run upserts a bot
  comment on the object that names the outage (`GitHub API unavailable (HTTP
503)`), states plainly that no rule was evaluated, and carries the gate's comment
  marker so a later healthy run replaces it in place. Crucially it applies **no
  quality label**: an outage never writes `pr-readiness:failing`, so it can never
  read as a governance verdict. The distinction lives on the object, legible
  without the job log.

## Consequences

- **A persistent outage blocks merge, by design.** While GitHub is down past the
  retry window, an opted-in PR gate stays red and merge is blocked. This is the
  deliberate cost of not letting an API fault defeat the gate; it self-clears on
  the next run once the API recovers, and the override path (`override:pr-readiness`
  plus a rationale) remains available for a human who must merge during an
  incident.
- **The retry is at the shared choke point, so every path benefits.** Because the
  retry lives in `#fetchWithRetry`, every REST read and write (`getPullRequest`,
  `getIssue`, `#paginate`, `searchIssues`, the label and comment writers) and the
  GraphQL `getLinkedIssues` inherit it, not just the one read named in the bug.
- **Behaviour on a healthy API is unchanged.** A 2xx flows through untouched, a 4xx
  still throws the same actionable error, and override/exempt handling is
  unaffected: the outage branch only runs when `ApiUnavailableError` escapes the
  object fetch.
- **The annotation is best-effort.** If the API is so far down that even the
  comment write fails past its own retries, the notice is skipped and the red check
  with its summary line (`GitHub API unavailable (503)`) stands alone. The write is
  not allowed to convert an outage into an unhandled crash.
