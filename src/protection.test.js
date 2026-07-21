import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parse } from "yaml";

import { GATE_CONTEXT, MERGE_BLOCKING_GATE } from "./constants.js";
import {
  checkProtection,
  isDrift,
  hasMergeBlockingWorkflow,
} from "./protection.js";

/** @param {string} rel @returns {string} */
const read = (rel) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const INSTALLED = ["issue-quality.yml", "pr-readiness.yml"];

/**
 * A stub GitHub client exposing only what checkProtection reads.
 * @param {{branch?: string, checks?: object}} opts
 * @returns {any}
 */
const stubGh = ({ branch = "main", checks = {} }) => ({
  getDefaultBranch: async () => branch,
  getRequiredStatusChecks: async () => ({
    contexts: [],
    protected: false,
    readable: true,
    ...checks,
  }),
});

// The job key in the workflow YAML IS the status-check context branch protection
// matches on. The YAML cannot import constants.js, so the two are coupled here:
// renaming a job without renaming the constant would make init's protection report
// look for a context nothing publishes, and report false drift in every repo.
test("each gate workflow's job key matches its GATE_CONTEXT constant", () => {
  for (const [stem, context] of Object.entries(GATE_CONTEXT)) {
    for (const dir of ["templates/workflow", ".github/workflows"]) {
      const doc = parse(read(`${dir}/${stem}.yml`));
      const jobKeys = Object.keys(doc.jobs);
      assert.deepEqual(
        jobKeys,
        [context],
        `${dir}/${stem}.yml must declare exactly one job named '${context}'`,
      );
    }
  }
});

// The whole point of the rename (ADR 0013): a required-status-check rule matches
// by context name, so two gates sharing one name are indistinguishable to it.
test("the three gate contexts are distinct", () => {
  const contexts = Object.values(GATE_CONTEXT);
  assert.equal(new Set(contexts).size, contexts.length);
});

test("detects the vendored merge-blocking workflow by name", () => {
  assert.ok(hasMergeBlockingWorkflow(["pr-readiness.yml"]));
  assert.ok(hasMergeBlockingWorkflow(["pr-readiness-2.yaml"]));
  assert.ok(!hasMergeBlockingWorkflow(["issue-quality.yml", "ci.yml"]));
  assert.ok(!hasMergeBlockingWorkflow([]));
  // A stem match that is not a workflow file must not count.
  assert.ok(!hasMergeBlockingWorkflow(["pr-readiness.md"]));
});

test("reports not-installed when the PR gate was never vendored", async () => {
  const result = await checkProtection({
    gh: stubGh({}),
    workflowFiles: ["issue-quality.yml"],
  });
  assert.equal(result.verdict, "not-installed");
  assert.equal(isDrift(result), false);
});

test("reports the gate enforced when its context is required", async () => {
  const result = await checkProtection({
    gh: stubGh({
      checks: {
        contexts: ["build", GATE_CONTEXT[MERGE_BLOCKING_GATE]],
        protected: true,
      },
    }),
    workflowFiles: INSTALLED,
  });
  assert.equal(result.verdict, "required");
  assert.equal(isDrift(result), false);
});

test("reports drift when the branch is protected but the gate is not required", async () => {
  const result = await checkProtection({
    gh: stubGh({ checks: { contexts: ["build"], protected: true } }),
    workflowFiles: INSTALLED,
  });
  assert.equal(result.verdict, "not-required");
  assert.equal(isDrift(result), true);
  assert.deepEqual(result.required, ["build"]);
});

test("reports drift when the default branch has no protection at all", async () => {
  const result = await checkProtection({
    gh: stubGh({}),
    workflowFiles: INSTALLED,
  });
  assert.equal(result.verdict, "unprotected");
  assert.equal(isDrift(result), true);
});

// A 403 is an unknown, not a verdict. Collapsing it into not-required would tell
// every contributor without admin scope that their gate is unenforced.
test("an unreadable answer is not reported as drift", async () => {
  const result = await checkProtection({
    gh: stubGh({ checks: { readable: false } }),
    workflowFiles: INSTALLED,
  });
  assert.equal(result.verdict, "unreadable");
  assert.equal(isDrift(result), false);
});

// A ruleset alone protects the branch; classic protection may be absent.
test("a ruleset-supplied context counts as required", async () => {
  const result = await checkProtection({
    gh: stubGh({
      checks: {
        contexts: [GATE_CONTEXT[MERGE_BLOCKING_GATE]],
        protected: true,
      },
    }),
    workflowFiles: INSTALLED,
  });
  assert.equal(result.verdict, "required");
});
