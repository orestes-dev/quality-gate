# Quality Gate

A deterministic gate that scores GitHub **issues** and **pull requests** against a structural quality bar, labels each outcome, and posts a scorecard explaining it. It exists so work has a proper spec before anyone picks it up (the issue) and a proper report of how that spec was met (the PR). The **Issue gate** is advisory (labels + scorecard, never fails CI, since GitHub cannot block issue creation); the **PR gate** hard-fails CI (a red check blocks merge), and additionally requires the PR to descend from a ready issue. The two gates share one core: title check, scorecard, labels, override, presence/length rules, and the validator.

## Language

**Intent**:
The single source of truth for a gate: which **fields** to present and at what severity. Format-independent. A given intent is **rendered** into one or more concrete templates (the GitHub-format one, the agent-facing one), which differ in format but express the same intent; drift between renderings is tested and prevented. "The Form owns structure" is shorthand for "the Form is the intent's GitHub rendering."

**Issue Form**:
The GitHub YAML template (`.github/ISSUE_TEMPLATE/task.yml`) an author fills in to open an issue. The GitHub rendering of the issue gate's **Intent**, read at runtime as the source of issue **structure**.
_Avoid_: Template (ambiguous with workflow template), schema.

**PR Form**:
The Markdown template (`.github/PULL_REQUEST_TEMPLATE.md`) a PR author fills in, carrying each section's heading plus inline voice guidance. Unlike the Issue Form, GitHub does not enforce it, so the PR gate enforces the sections itself. Because it is Markdown, it is both the GitHub rendering and the agent-facing rendering of the PR gate's Intent (one file, no agent-versus-UI drift). Its required sections are Summary, Verification, and Divergence.
_Avoid_: Template.

**Structure**:
The set of **fields** an object must contain and their shape: each field's id, heading, whether it is required, and any enumerated options. Owned by the gate's **Intent** and read from its GitHub rendering (Issue Form / PR Form) at runtime.

**Field**:
One input in the Issue Form, identified by a stable `id` and rendered in the submitted body as a `### <heading>` **section**. The fields are Context, Acceptance Criteria, Out of Scope, Decisions, Affected files / entry points, Depends on, and Size. Context, Acceptance Criteria, Out of Scope, and Size are required; Decisions and Affected files are optional but warn when empty; Depends on is purely optional.
_Avoid_: Question, item.

**Title**:
The issue's one-line summary, validated (not a field, since the form doesn't own it) against the Conventional Commits format `type(scope): summary`. It leads the scorecard so the change type reads first and maps onto the eventual branch/commit.

**Section**:
A `### <heading>` block in a submitted issue body. GitHub renders each field's heading as the section heading; the validator parses sections back out to check them. A section is the rendered form of a field.

**Rule**:
A constraint applied to a field that the Issue Form cannot express: minimum/maximum length, checklist-item requirement, warn-if-empty on an optional field, or which sizes are too large to land. Owned by `rules.js`, keyed by field `id`, and joined to the structure at runtime.
_Avoid_: Validation, constraint, config.

**Check**:
One evaluated rule or structural requirement against a submitted section, producing a pass, warning, or fail with a message. Checks are **additive**: each fires only when its trigger is present (a required field, a dropdown's options, a length rule, a checklist rule).

**Scorecard**:
The single bot comment on an issue listing every check and its outcome, kept in sync on each run. Present on every result, pass and override included, so a clean issue gets confirmation rather than silence and an overridden one still shows what the gate found. No run leaves an issue without one.
_Avoid_: Report (reserved for the CLI's terminal output), comment.

**Quality Label**:
Exactly one of `issue-quality:pass` / `issue-quality:warning` / `issue-quality:failing` (on issues) or `pr-quality:pass` / `pr-quality:warning` / `pr-quality:failing` (on PRs), mutually exclusive within its object, reflecting the worst check outcome. The gate's machine-readable verdict. On issues it is the verdict; on PRs the merge-blocking verdict is the CI **Check**, and the label is a filterable echo of it.

**Override**:
The manual escape hatch: an `override:<gate>` label (`override:issue-quality` or `override:pr-quality`) plus a written `## Override rationale` section bypasses that gate. Neither alone suffices. It strips the quality label but not the scorecard, which stays with a banner acknowledging the bypass. The override label is human-applied and the gate never removes it, so it persists as a durable, filterable signal. On the PR gate, a bot-authored PR (actor ends in `[bot]`) is exempt without an override, since no human is present to apply one.

**Readiness**:
Whether an issue is cleared for a consumer (human or automation) to pick up. Distinct from the **Quality Label**: readiness is "not blocked," the label is the gate's verdict on a single issue. An issue is ready when it carries `issue-quality:pass`, `issue-quality:warning` (non-blocking by design), or `override:issue-quality` (a human waived the block). `issue-quality:failing` and an issue with no quality label at all (un-gated, or the run is in flight) are not ready. Consumers express readiness as a positive union of the ready labels, never as the absence of `failing`, which would sweep in un-gated issues.

**Linked issue**:
An issue a PR declares it closes, read from GitHub's native `closingIssuesReferences` (populated by `Closes #N` or the Development sidebar), the same relationship that auto-closes the issue on merge. The PR gate's notion of "connected," never a body field it parses. Only same-repo links count toward readiness; cross-repo links are ignored (the workflow token cannot read another repo's labels).
_Avoid_: Referenced issue, mentioned issue (a bare `#N` mention that is not a closing reference is not a Linked issue).

**Divergence**:
A declared departure of a PR's implementation from its Linked issue's original what/why. The issue's what/why may evolve during coding; a Divergence is that evolution made explicit, owing a written rationale. The gate checks only that a rationale is **present** when the author flags a Divergence, never whether the code actually conforms to the issue; conformance is the implementer's and reviewer's judgment.
_Avoid_: Deviation, scope change.

**PR Readiness**:
Whether a PR is cleared to merge by the gate. Distinct from **Readiness** (an issue property): a PR is ready when it has no error (its required sections are present, its title is conventional, and **every** same-repo Linked issue is itself ready), or a human waived the block with `override:pr-quality` plus a rationale, or a bot authored it. Expressed as a passing (green) status **Check**, the merge-blocking signal; the `pr-quality:*` label and scorecard are explanatory.

**Suggested rule**:
The agent-guidance snippet `init` prints to stdout (it does not write it to any file) for the operator to paste into their own agent-rules file (`AGENTS.md`, `CLAUDE.md`, editor rules). It tells an agent which template to fill and to pre-flight validate before opening the issue or PR. Kept out of the repo so `init` never clobbers a file it does not own.

**Sweep**:
A local, on-demand backfill that applies quality labels and scorecards across a repo's existing open issues, using the operator's own `gh` session rather than CI credentials.

**Pre-flight validation**:
Running the validator against a drafted issue body locally (`validate <file>`) before `gh issue create`, to catch hard errors before the issue exists.

**Drift test**:
A test asserting that a restated copy of a fact still matches its single source: the README threshold numbers against the rules, and the two workflow files against each other's shared parts. Duplication that is kept on purpose is made safe by a drift test rather than eliminated.

**Accepted duplication**:
A restatement deliberately left in place because collapsing it costs more than it saves, guarded by a drift test. The two workflow files (consumer `@main` vs dogfood `./`) are the standing example.

## Example dialogue

**Dev**: If the Issue Form owns the structure, where does "Context must be at least 30 characters" live?

**Domain expert**: That's a rule, not structure. The form only says Context is a required field; the 30-character floor is a rule in `rules.js`, keyed to the Context field's id. We join the two at runtime.

**Dev**: And if someone renames the Context field's heading in the form?

**Domain expert**: The section heading follows automatically, because the validator reads headings from the form. The rule still matches because it's keyed by id, not heading. A test asserts every rule still maps to a real field, so an orphaned rule or an unruled field fails CI.

**Dev**: The README also lists "30 characters." Isn't that duplication?

**Domain expert**: It is, and it's accepted duplication: the README is the human-readable bar, so we keep the number but guard it with a drift test against the rule. Same pattern as the two workflow files.

**Dev**: A PR says `Closes #42`, but #42 is `issue-quality:failing`. The PR body is perfect. Does it merge?

**Domain expert**: No. The PR gate hard-fails, and one of its errors is that every same-repo Linked issue must be ready. #42 isn't, so the check is red. A perfect PR body doesn't buy readiness for the spec it claims to satisfy.

**Dev**: Then someone fixes #42 and it flips to pass. Does the PR go green on its own?

**Domain expert**: No, and that's deliberate. The PR check only re-runs on PR events, so it goes stale. The scorecard tells the author to re-run it once the issue is ready, rather than us coupling the two gates. If they can't wait, `override:pr-quality` plus a rationale is the escape hatch.

**Dev**: The PR gate never asks whether the code actually matches #42's acceptance criteria?

**Domain expert**: Right. It checks presence, not conformance. If the implementation drifted from the issue, that's a Divergence, and the gate only checks the author wrote a rationale for it. Judging whether the rationale is honest is the reviewer's job, human or agent, not the gate's.
