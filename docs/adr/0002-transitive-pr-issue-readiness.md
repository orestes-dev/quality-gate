# Transitive PR readiness via native linked issues

A PR is judged partly on the issue it descends from. The gate reads GitHub's own
`closingIssuesReferences` (populated by `Closes #N` or the Development sidebar),
not a body field it parses, so its notion of "connected" is exactly the
relationship that auto-closes the issue on merge: no regex, no second source of
truth. Every same-repo linked issue must be ready (the `pass` / `warning` /
`override` union); one failing linked issue fails the PR, because each closed
issue is a spec the PR claims to satisfy.

## Considered options

Parsing the PR body for `#N` was rejected: it would invent a second linkage
alongside GitHub's, which drift against each other unless the author also writes
a closing keyword. Reusing `closingIssuesReferences` keeps one relationship.

## Consequences

- **Cross-repo links are ignored** for readiness: the workflow token cannot
  reliably read another repo's labels. A PR whose only link is cross-repo fails
  unless overridden, and the scorecard says so rather than silently passing.
- **The consuming workflow must grant `issues: read`.** Reading a linked issue's
  labels goes through the issues API, so a workflow that omits the permission
  reads an empty label set and hard-fails every PR that uses `Closes #N`. The
  template and README call this out; a consumer copying an older permission block
  inherits the failure.
- **Staleness is accepted.** A PR's check depends on another object's mutable
  state, so it can go stale when the linked issue flips to ready after the PR was
  last evaluated. Rather than couple the two gates with cross-object
  re-dispatch, the scorecard instructs the author to re-run the check (an empty
  commit or "Re-run jobs") once the issue is fixed.
