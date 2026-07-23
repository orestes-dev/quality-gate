import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { run } from "./action.js";
import { validate } from "./validator.js";
import { renderComment } from "./report.js";
import { ApiUnavailableError } from "./github.js";
import {
  LABEL,
  OVERRIDE_LABEL,
  OVERRIDE_HEADING,
  STATUS,
  WONTFIX_LABEL,
} from "./constants.js";
import { goodBody } from "./fixtures.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const failingBody = goodBody.replace("### Size", "### Size\n\nL\n");

// A GitHub client stub that records every mutating call. Reads (getIssue,
// findComment) are not recorded; only writes are, so `calls` is exactly the
// set of side effects a run produced.
function fakeGh({ issue, comments = [] }) {
  const calls = [];
  return {
    calls,
    async getIssue() {
      return issue;
    },
    async ensureLabel(name, color, description) {
      calls.push(["ensureLabel", name, color, description]);
    },
    async addLabels(number, labels) {
      calls.push(["addLabels", number, labels]);
    },
    async removeLabel(number, label) {
      calls.push(["removeLabel", number, label]);
    },
    async findComment(_number, predicate) {
      return comments.find(predicate) ?? null;
    },
    async createComment(number, body) {
      calls.push(["createComment", number, body]);
    },
    async updateComment(id, body) {
      calls.push(["updateComment", id, body]);
    },
    async deleteComment(id) {
      calls.push(["deleteComment", id]);
    },
  };
}

const event = { issue: { number: 7 } };

// The load-bearing anti-loop invariant: a run that finds the issue already in
// its correct end state performs ZERO writes, so the label it would apply can
// never re-trigger the workflow into a loop.

test("no writes when a clean issue already carries the pass label and scorecard", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: goodBody, labels: [{ name: LABEL.PASS }] },
    comments: [
      { id: 1, user: { type: "Bot" }, body: renderComment(validate(goodBody)) },
    ],
  });
  await run({ gh, event });
  assert.deepEqual(gh.calls, []);
});

test("a fresh clean issue gets the pass label and a scorecard comment", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: goodBody, labels: [] },
    comments: [],
  });
  const { summary } = await run({ gh, event });
  assert.match(summary, /passing/);
  assert.ok(
    gh.calls.some((c) => c[0] === "addLabels" && c[2].includes(LABEL.PASS)),
  );
  const created = gh.calls.find((c) => c[0] === "createComment");
  assert.ok(created, "expected a scorecard comment on clean pass");
  assert.ok(created[2].includes("Issue Quality Checklist"));
});

test("no writes when a failing issue already carries the label and comment", async () => {
  const result = validate(failingBody);
  const gh = fakeGh({
    issue: { number: 7, body: failingBody, labels: [{ name: LABEL.FAILING }] },
    comments: [{ id: 1, user: { type: "Bot" }, body: renderComment(result) }],
  });
  await run({ gh, event });
  assert.deepEqual(gh.calls, []);
});

test("a fresh failing issue gets the failing label and a comment", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: failingBody, labels: [] },
    comments: [],
  });
  await run({ gh, event });
  assert.ok(
    gh.calls.some((c) => c[0] === "addLabels" && c[2].includes(LABEL.FAILING)),
  );
  assert.ok(gh.calls.some((c) => c[0] === "createComment"));
});

// The gate identifies its own comment by marker AND bot authorship. A human who
// pastes the marker into their own comment must not have it adopted.

test("a human comment carrying the marker is not updated; a bot comment is created instead", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: failingBody, labels: [{ name: LABEL.FAILING }] },
    comments: [
      {
        id: 1,
        user: { type: "User" },
        body: renderComment(validate(failingBody)),
      },
    ],
  });
  await run({ gh, event });
  assert.ok(!gh.calls.some((c) => c[0] === "updateComment"));
  assert.ok(gh.calls.some((c) => c[0] === "createComment"));
});

test("a human comment carrying the marker is not deleted on a clean pass", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: goodBody, labels: [{ name: LABEL.PASS }] },
    comments: [
      {
        id: 1,
        user: { type: "User" },
        body: renderComment(validate(failingBody)),
      },
    ],
  });
  await run({ gh, event });
  assert.ok(!gh.calls.some((c) => c[0] === "deleteComment"));
});

// Override: label + a written rationale strips every quality label but keeps the
// scorecard, re-rendered with an override banner, regardless of whether the body
// would otherwise pass or fail. Every run leaves a comment behind.

test("override with rationale strips the quality label and keeps an annotated scorecard", async () => {
  const body = [
    failingBody,
    "",
    `## ${OVERRIDE_HEADING}`,
    "",
    "Spike, not real work.",
  ].join("\n");
  const gh = fakeGh({
    issue: {
      number: 7,
      body,
      labels: [{ name: OVERRIDE_LABEL }, { name: LABEL.FAILING }],
    },
    comments: [
      {
        id: 1,
        user: { type: "Bot" },
        body: renderComment(validate(failingBody)),
      },
    ],
  });
  const { summary } = await run({ gh, event });
  assert.match(summary, /overridden/);
  assert.ok(
    gh.calls.some((c) => c[0] === "removeLabel" && c[2] === LABEL.FAILING),
  );
  assert.ok(!gh.calls.some((c) => c[0] === "deleteComment"));
  assert.ok(!gh.calls.some((c) => c[0] === "addLabels"));
  const updated = gh.calls.find((c) => c[0] === "updateComment");
  assert.ok(updated, "expected the scorecard to be updated, not removed");
  assert.ok(updated[2].includes("Gate overridden"));
  assert.ok(updated[2].includes("Issue Quality Checklist"));
});

test("override with rationale is a no-op once the label is cleared and the banner is in place", async () => {
  const body = [
    goodBody,
    "",
    `## ${OVERRIDE_HEADING}`,
    "",
    "Spike, not real work.",
  ].join("\n");
  const gh = fakeGh({
    issue: { number: 7, body, labels: [{ name: OVERRIDE_LABEL }] },
    comments: [
      {
        id: 1,
        user: { type: "Bot" },
        body: renderComment(validate(body), { overridden: true }),
      },
    ],
  });
  await run({ gh, event });
  assert.deepEqual(gh.calls, []);
});

test("override label without a rationale warns and keeps the gate applied", async () => {
  const gh = fakeGh({
    issue: { number: 7, body: goodBody, labels: [{ name: OVERRIDE_LABEL }] },
    comments: [],
  });
  await run({ gh, event });
  assert.ok(
    gh.calls.some((c) => c[0] === "addLabels" && c[2].includes(LABEL.WARNING)),
  );
  const created = gh.calls.find((c) => c[0] === "createComment");
  assert.ok(created, "expected a comment to be created");
  assert.ok(created[2].includes(OVERRIDE_HEADING));
});

// A GitHub outage past the retry window (ApiUnavailableError from the object
// fetch) must NOT read as a rule verdict: the run fails, posts a distinct outage
// notice on the object, and applies no quality label.

test("an outage during the object fetch fails without applying a quality label", async () => {
  const created = [];
  const labelCalls = [];
  const gh = {
    async getIssue() {
      throw new ApiUnavailableError(503);
    },
    async findComment() {
      return null;
    },
    async createComment(number, body) {
      created.push(body);
    },
    async addLabels(number, labels) {
      labelCalls.push(labels);
    },
    async ensureLabel() {},
    async removeLabel() {},
    async updateComment() {},
  };
  const { summary, status } = await run({ gh, event });
  assert.equal(status, STATUS.FAIL);
  assert.match(summary, /GitHub API unavailable \(503\)/);
  assert.equal(
    labelCalls.length,
    0,
    "an outage must not apply a quality label",
  );
  assert.equal(
    created.length,
    1,
    "the outage should be annotated on the object",
  );
  assert.match(created[0], /GitHub API unavailable/);
  assert.match(created[0], /not.*a rule violation/i);
});

test("annotating the outage is best-effort: a failing write still yields a red verdict", async () => {
  const gh = {
    async getIssue() {
      throw new ApiUnavailableError(null);
    },
    async findComment() {
      throw new ApiUnavailableError(null);
    },
  };
  const { summary, status } = await run({ gh, event });
  assert.equal(status, STATUS.FAIL);
  assert.match(summary, /GitHub API unavailable \(network error\)/);
});

test("a 4xx-style read error still throws (a missing object is a real failure)", async () => {
  const gh = {
    async getIssue() {
      throw new Error("Failed to fetch issue: 404");
    },
  };
  await assert.rejects(run({ gh, event }), /Failed to fetch issue: 404/);
});

// The workflow `if:` filter hardcodes JS-side strings in YAML (it cannot import
// the constants). Guard each coupling so a rename cannot silently leave the
// trigger filter stale: the override label name, the issue-quality:* prefix the
// self-heal branch matches, and the bot sender login the human check excludes.
const QUALITY_PREFIX = LABEL.FAILING.slice(0, LABEL.FAILING.indexOf(":") + 1);
const GATE_SENDER = "github-actions[bot]";

// The template only: the installed copy under `.github/workflows/` is asserted
// byte-identical to it in `scaffolds.test.js`, so checking both paths here would
// restate a claim byte-equality already subsumes (ADR 0018).
test("the issue workflow couples the trigger filter to the schema strings", () => {
  const rel = "templates/workflow/issue-quality.yml";
  const yaml = read(rel);
  assert.ok(
    yaml.includes(`github.event.label.name == '${OVERRIDE_LABEL}'`),
    `${rel} is missing the override-label trigger guard`,
  );
  assert.ok(
    yaml.includes(`startsWith(github.event.label.name, '${QUALITY_PREFIX}')`),
    `${rel} is missing the quality-label self-heal guard`,
  );
  assert.ok(
    yaml.includes(`github.event.sender.login != '${GATE_SENDER}'`),
    `${rel} is missing the human-sender guard`,
  );
  assert.ok(
    yaml.includes(`github.event.label.name == '${WONTFIX_LABEL}'`),
    `${rel} is missing the wontfix (Rejection) trigger guard`,
  );
});

// --- drift: action.yml's `object` input dispatches to command files that exist ---

// The narrower mitigation ADR 0018 accepted in place of the dropped `uses: ./`
// self-test. Nothing else executes `action.yml`, so its one piece of routing
// logic, the `object` input to command-file mapping, is asserted here: each
// value the composite dispatches on must resolve to a file `src/commands/`
// actually ships, and the run step must invoke that path.
const OBJECT_COMMANDS = {
  issue: "action",
  pr: "pr",
  commit: "commit",
};

test("every action.yml `object` value dispatches to an existing command file", () => {
  const action = parse(read("action.yml"));
  const step = action.runs.steps.find((s) => s.name === "Run gate");

  // The gate runs whatever COMMAND resolves to, so the coupling is only real if
  // the command name is what the run line interpolates.
  assert.equal(
    step.run.trim(),
    'node "$GITHUB_ACTION_PATH/src/commands/${COMMAND}.js"',
  );

  const expression = step.env.COMMAND;
  for (const [object, command] of Object.entries(OBJECT_COMMANDS)) {
    assert.ok(
      existsSync(join(ROOT, "src", "commands", `${command}.js`)),
      `object: ${object} dispatches to src/commands/${command}.js, which does not exist`,
    );
    // `issue` is the fallthrough: it is named by the input default, not by a
    // comparison in the expression.
    const dispatch =
      object === action.inputs.object.default
        ? `|| '${command}'`
        : `inputs.object == '${object}' && '${command}'`;
    assert.ok(
      expression.includes(dispatch),
      `action.yml no longer dispatches object: ${object} to ${command}.js`,
    );
  }
});
