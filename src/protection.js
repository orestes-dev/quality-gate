// Detect whether a vendored gate workflow is actually merge-blocking.
//
// Vendoring a workflow buys the check RUNNING, never the check BLOCKING. What
// blocks a merge is a required-status-check rule on the default branch, which
// lives in repository settings that no repo can commit. That is the same split
// ADR 0012 drew for hooks (a vendored hook file is execution; `core.hooksPath` is
// activation), applied to gates: `init` ships the enforcing half's *carrier* and
// cannot ship the enforcement itself.
//
// So the unversioned half drifts silently, and the tool that exists to kill that
// failure mode could not see it. This module reports the gap. It never repairs it
// (ADR 0014): detection is what was missing, and `init` is a routine command that
// must not carry admin scope over five default branches.

import { GATE_CONTEXT, MERGE_BLOCKING_GATE } from "./constants.js";

/** @typedef {import('./github.js').GitHub} GitHub */

/**
 * The verdicts `checkProtection` can reach, worst first. A caller maps these onto
 * exit codes and presentation.
 * @typedef {'not-installed'|'unreadable'|'unprotected'|'not-required'|'required'} ProtectionVerdict
 */

/**
 * @typedef {object} ProtectionResult
 * @property {ProtectionVerdict} verdict
 * @property {string} branch - The default branch inspected ("" when not reached).
 * @property {string} context - The status-check context the gate publishes.
 * @property {string[]} required - Contexts currently required on the branch.
 * @property {string} message - One-line explanation, ready to print.
 */

/**
 * Whether the consumer has the merge-blocking gate's workflow vendored at all.
 * Matches the `pr-readiness*.yml` shape `init` writes, so a repo that suffixed the
 * filename (`pr-readiness-2.yml`) still counts.
 * @param {string[]} workflowFiles - Basenames found in `.github/workflows/`.
 * @returns {boolean}
 */
export function hasMergeBlockingWorkflow(workflowFiles) {
  return workflowFiles.some(
    (f) =>
      f.startsWith(MERGE_BLOCKING_GATE) &&
      (f.endsWith(".yml") || f.endsWith(".yaml")),
  );
}

/**
 * Decide whether the merge-blocking gate is enforced on the default branch.
 *
 * Read-only: every call this makes is a GET, and no verdict triggers a write.
 *
 * The verdicts are deliberately five, not a boolean, because the ways this can be
 * wrong are not interchangeable. `unreadable` in particular must never collapse
 * into `not-required`: the tool would then report a confident, false "your gate is
 * not enforced" to anyone running it without admin scope.
 * @param {object} params
 * @param {GitHub} params.gh
 * @param {string[]} params.workflowFiles - Basenames in `.github/workflows/`.
 * @returns {Promise<ProtectionResult>}
 */
export async function checkProtection({ gh, workflowFiles }) {
  const context = GATE_CONTEXT[MERGE_BLOCKING_GATE];

  if (!hasMergeBlockingWorkflow(workflowFiles)) {
    return {
      verdict: "not-installed",
      branch: "",
      context,
      required: [],
      message:
        "no pr-readiness workflow in .github/workflows/; this repo has not " +
        "opted into the PR gate, so there is nothing to require. Run `init` first.",
    };
  }

  const branch = await gh.getDefaultBranch();
  const {
    contexts,
    protected: isProtected,
    readable,
  } = await gh.getRequiredStatusChecks(branch);

  if (!readable) {
    return {
      verdict: "unreadable",
      branch,
      context,
      required: [],
      message:
        `cannot read branch protection for '${branch}' (403). This is a ` +
        "permissions answer, not a verdict: the rule may well be in place. " +
        "Re-run with a token carrying admin scope on the repository.",
    };
  }

  if (!isProtected) {
    return {
      verdict: "unprotected",
      branch,
      context,
      required: [],
      message:
        `'${branch}' has no branch protection and no ruleset. The ` +
        `${context} check runs on every PR and blocks nothing: any PR can ` +
        "merge while the gate is red, or before it has reported at all.",
    };
  }

  if (!contexts.includes(context)) {
    return {
      verdict: "not-required",
      branch,
      context,
      required: contexts,
      message:
        `'${branch}' is protected, but '${context}' is not among its required ` +
        `status checks (${contexts.join(", ") || "none"}). The gate runs and ` +
        "reports, and merge proceeds regardless of what it reports.",
    };
  }

  return {
    verdict: "required",
    branch,
    context,
    required: contexts,
    message: `'${context}' is a required status check on '${branch}'.`,
  };
}

// Verdicts that mean "the gate is not actually enforcing". `unreadable` is
// excluded on purpose: it is an unknown, and reporting an unknown as drift would
// make the check cry wolf in exactly the repos an operator cannot fix from here.
const DRIFT_VERDICTS = new Set(["unprotected", "not-required"]);

/**
 * Whether a result represents enforcement drift the operator should act on.
 * @param {ProtectionResult} result
 * @returns {boolean}
 */
export function isDrift(result) {
  return DRIFT_VERDICTS.has(result.verdict);
}
