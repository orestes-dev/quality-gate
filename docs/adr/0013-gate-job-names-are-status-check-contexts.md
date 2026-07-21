# Each gate's workflow job is named for the gate, because that name is its status-check context

All three vendored workflows declared their single job as `repo-contract`:

```yaml
jobs:
  repo-contract:
    runs-on: ubuntu-latest
```

The job key is not cosmetic. GitHub publishes a check-run named after the job,
and a required-status-check rule (classic branch protection or a ruleset) matches
**by that name**. So the name every gate shared was the only handle branch
protection had on any of them, with three consequences:

- **`pr-readiness` was not a context that existed anywhere.** The README, the
  workflow filename, and the label namespace all say `pr-readiness`, so that is
  the string an operator reaches for when configuring branch protection. Adding
  it as a required check would have wedged the default branch forever, waiting on
  a context nothing publishes.
- **The three gates were indistinguishable to a rule.** "Require the PR gate but
  not commit hygiene" was inexpressible: one name covered both, and a repo that
  vendors both workflows publishes two check-runs sharing it.
- **The observable symptom was two identically-named checks on every PR.** Which
  is which is not recoverable from the rollup, for a human or a tool.

Each gate's job is now named for the gate: `issue-quality`, `pr-readiness`,
`commit-hygiene`. The context an operator would guess from the docs is now the
context that exists, and each gate is independently requirable.

The name is now load-bearing, so it is owned in code (`GATE_CONTEXT` in
`src/constants.js`, keyed by workflow filename stem) and restated in the YAML,
which cannot import a module. `src/protection.test.js` drift-tests the coupling in
both directions: each workflow, template and dogfood alike, must declare exactly
one job whose key equals its constant, and the three contexts must be distinct.
That is the same accepted-duplication-plus-drift-test pattern the workflow pair
and the Author guides already use.

## Why this was safe to do now, and would not have been later

A context rename breaks any branch protection rule that requires the old name: the
rule keeps waiting on a check-run that will never appear again, and every PR
wedges. That is normally a migration with a careful ordering.

Here it cost nothing, because a fleet-wide audit found **no repository requiring
`repo-contract`, and no repository requiring any repo-contract context at all**.
Three of five default branches had no protection whatsoever. Nothing could break,
because nothing was wired up. The window closes the moment the first repo requires
the context, which is exactly what ADR 0014's `init` report is meant to prompt, so
the rename had to land first.

## Considered options

- **Keep `repo-contract` and have the detection look for it.** Rejected: it makes
  the tool's own docs wrong about their most operationally important string, and
  permanently forecloses requiring one gate without the other.
- **Derive the context from the vendored workflow at check time** (parse the local
  `pr-readiness*.yml` and read its job key). Rejected as the primary mechanism: it
  is more code, and it treats a value repo-contract owns as if it were a
  consumer's free choice. A consumer who renames the job has drifted from a
  drift-checked file, which is already an error the tool reports.
- **Name jobs after the tool but publish a distinct check via `name:`.** Rejected:
  it adds a second naming surface for the same string and leaves the job key,
  which is what a reader sees in the YAML, still misleading.
- **Rename only `pr-readiness`, since it is the only merge-blocking gate.**
  Rejected: it leaves two gates colliding on `repo-contract` for the same reason,
  and the inconsistency would read as an accident rather than a rule.

## Consequences

- Every consumer must re-vendor (`init --force`) to pick up the new job names.
  Until they do, their published context stays `repo-contract` and `init`'s
  protection report reads the gate as not required, which is accurate: it is not,
  and could not have been.
- A consumer that had already required `repo-contract` would wedge on re-vendor.
  None exists today; a future one must add the new context before re-vendoring.
- The three `pr-readiness:*` / `issue-quality:*` / `commit-hygiene:*` label
  namespaces, the workflow filenames, the concurrency group prefixes, and now the
  job names all use the same per-gate string. That consistency is the point: there
  is one name per gate, used everywhere.
