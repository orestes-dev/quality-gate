# Promote the rejection-rationale convention into the tier-2 contract

Closing an idea as declined is a decision worth keeping. The working convention
has been: label the issue `wontfix` and append a `## Rejection rationale`
section giving the reason plus a `Revisit if <condition>` trigger, so the
rejection stays searchable and reusable rather than becoming a dead end. That
convention lived only in personal tier-1 agent rules (`~/.claude/rules/`), which
means it binds one operator's agents on one machine and nothing else. Nothing
checked it, so a rejection could be recorded with an empty section or none at
all: retained, but with no recallable reason and no reconsider signal.

This ADR moves the convention into the tier-2 repo-contract, where every
consumer inherits it: the `wontfix` label becomes part of the contract's
vocabulary, `init` materializes it, and the issue gate checks that a `wontfix`
issue carries a written rationale.

The justification is that repo-contract's remit is already exactly this. The
gate owns one question, "is this issue legible", and **Gate clearance** is
defined as legibility, not readiness. A rejection is an issue whose legibility
bar is different: it is not a spec anyone will implement, so what must be
readable is the decision rather than the plan. Checking it is the same job
applied to a second kind of object, not a new job.

## Considered options

**Leave it at tier 1** (prose in personal agent rules). Rejected: it enforces
nothing, applies to no contributor without those dotfiles, and the failure mode
is silent. The convention's whole value is that a future reader can recover why
something was declined, which is precisely what goes missing when nobody checks.

**Ship it as a per-repo opt-in flag** in `.repo-contract.json`. Rejected: that
file holds opt-**outs** from the baseline, never opt-ins to extra rules
(see ADR 0002). Introducing an opt-in there would make the contract's contents
repo-dependent, so "what does repo-contract enforce" would stop having one
answer. A repo that dislikes the check can already waive it the standard way,
with `override:issue-quality` plus a rationale.

**Model it as a numbered field in `rules.js`**, rendered into the Issue Form and
the Author guide like Context or Size. Rejected: an author is not declining
anything at the moment they open an issue, so the form would prompt for a
section nobody should fill in yet. `## Override rationale` already faced this
and is modelled as a conditional `##` section outside `rules.js`; the rejection
rationale takes the same shape, which also keeps it out of the README threshold
table and its drift test.

**Select the check on GitHub's close `state_reason`** (`not_planned`), alone or
OR-ed with the label. Rejected: reading both fields invents contradictory states
the gate would have to adjudicate. The two fields are independent, so a
half-performed ritual lands as closed-as-completed-but-labeled-`wontfix`, or as
labeled-while-still-open. Keying on the label alone reduces the rule to one
sentence, "`wontfix` means a reason is owed", and leaves close bookkeeping to
GitHub.

## Consequences

- **The check is additive, not a mode.** A `wontfix` issue is still graded
  against the work-item fields; the rationale check is one more check that fires
  when its trigger is present, consistent with the gate's existing additive
  design. A declined issue whose original what/why is unreadable is no more
  useful than one with no reason recorded.
- **Applying `wontfix` can degrade an issue's label**, from `issue-quality:pass`
  to `issue-quality:failing`, which no other label does today. This is intended:
  the issue genuinely got worse-specified the moment it claimed a rejection it
  did not record. The gate stays advisory (ADR 0001), so the cost is a label and
  a scorecard line, never a blocked action.
- **`init` now reconciles a label the tool did not mint.** `wontfix` is one of
  GitHub's default labels, unlike the six namespaced strings only this tool
  creates. It is added to the reconciled schema with GitHub's own default
  metadata, so the reconcile is a no-op in any repo that never recoloured it;
  a repo that did gets one PATCH at opt-in, which is what opting into the
  contract means everywhere else.
- **No workflow trigger changes.** Because the selector is a label,
  `labeled`/`unlabeled` already fire; only the workflow's `if:` filter widens to
  match `wontfix`.
- **Pre-existing rejections stay ungraded.** `sweep` is scoped to
  `is:issue is:open`, so `wontfix` issues closed before this lands are never
  backfilled until their label is re-touched. Widening sweep to closed issues
  changes its cost and blast radius and is deliberately deferred.
- **The tier-1 rule becomes a restatement.** The convention now has two homes:
  the personal agent rules that describe the ritual and this repo that enforces
  it. The enforcement is authoritative; the tier-1 copy should point here rather
  than redefine the bar.
