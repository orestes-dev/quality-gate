import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseOnly,
  refuseDeselection,
  resolveSelection,
  SelectionError,
  ONLY_FLAG,
} from "./selection.js";
import { SCAFFOLD, SCAFFOLD_IDS } from "./constants.js";

// A prompt stub: records what it was offered and returns a scripted answer, so
// the precedence rules are testable with no terminal.
function fakePrompt(answer) {
  const calls = [];
  return {
    calls,
    fn: async (offer, installed) => {
      calls.push({ offer, installed });
      return answer;
    },
  };
}

/** The default: never asked, nothing recorded. */
const resolve_ = (overrides = {}) =>
  resolveSelection({
    argv: [],
    recorded: [],
    interactive: false,
    prompt: async () => [],
    ...overrides,
  });

test("--only accepts a comma-separated list, normalized to manifest order", () => {
  assert.deepEqual(parseOnly([ONLY_FLAG, "git-hooks,quality-gates"]), [
    SCAFFOLD.QUALITY_GATES,
    SCAFFOLD.GIT_HOOKS,
  ]);
});

test("--only accepts repetition and tolerates whitespace", () => {
  assert.deepEqual(
    parseOnly([ONLY_FLAG, " git-hooks , ", ONLY_FLAG, "commit-hygiene"]),
    [SCAFFOLD.COMMIT_HYGIENE, SCAFFOLD.GIT_HOOKS],
  );
});

test("an absent --only returns null, handing off to the next precedence step", () => {
  assert.equal(parseOnly(["--force"]), null);
});

// Exit 2, the same code an unknown command uses: a malformed request, not a
// refused one. The message teaches the vocabulary rather than just rejecting.
test("--only with an unknown id is a usage error listing the known ids", () => {
  assert.throws(
    () => parseOnly([ONLY_FLAG, "issue-quality"]),
    (err) => {
      assert.ok(err instanceof SelectionError);
      assert.equal(err.code, 2);
      assert.match(err.message, /unknown scaffold 'issue-quality'/);
      for (const id of SCAFFOLD_IDS) assert.match(err.message, new RegExp(id));
      return true;
    },
  );
});

test("--only with no value is a usage error", () => {
  assert.throws(() => parseOnly([ONLY_FLAG]), /needs a comma-separated list/);
  assert.throws(
    () => parseOnly([ONLY_FLAG, "--force"]),
    /needs a comma-separated list/,
  );
});

// A run that would install nothing is an error on both paths, so `[]` never
// reaches the manifest.
test("--only that names nothing is a usage error", () => {
  assert.throws(
    () => parseOnly([ONLY_FLAG, ",  ,"]),
    (err) => {
      assert.ok(err instanceof SelectionError);
      assert.equal(err.code, 2);
      assert.match(err.message, /installs nothing/);
      return true;
    },
  );
});

test("refuseDeselection passes a selection that keeps everything installed", () => {
  refuseDeselection(SCAFFOLD_IDS, [SCAFFOLD.GIT_HOOKS]);
  refuseDeselection([SCAFFOLD.GIT_HOOKS], [SCAFFOLD.GIT_HOOKS]);
  refuseDeselection([SCAFFOLD.GIT_HOOKS], []);
});

// `init` only ever adds. The refusal names both exits, since either may be the
// one the operator meant.
test("refuseDeselection names what would drop and points at uninstall", () => {
  assert.throws(
    () => refuseDeselection([SCAFFOLD.QUALITY_GATES], [SCAFFOLD.GIT_HOOKS]),
    (err) => {
      assert.ok(err instanceof SelectionError);
      assert.equal(err.code, 1);
      assert.match(err.message, /would drop git-hooks/);
      assert.match(err.message, /widen the selection/);
      assert.match(err.message, /repo-contract uninstall git-hooks/);
      return true;
    },
  );
});

test("precedence: --only beats the prompt, the record, and all-in", async () => {
  const prompt = fakePrompt([SCAFFOLD.COMMIT_HYGIENE]);
  const { ids, source } = await resolve_({
    argv: [ONLY_FLAG, "git-hooks"],
    recorded: [SCAFFOLD.GIT_HOOKS],
    interactive: true,
    prompt: prompt.fn,
  });
  assert.deepEqual(ids, [SCAFFOLD.GIT_HOOKS]);
  assert.equal(source, ONLY_FLAG);
  assert.equal(prompt.calls.length, 0, "the flag answers the question");
});

test("--only is refused before anything is asked or installed", async () => {
  const prompt = fakePrompt([]);
  await assert.rejects(
    resolve_({
      argv: [ONLY_FLAG, "quality-gates"],
      recorded: [SCAFFOLD.GIT_HOOKS],
      interactive: true,
      prompt: prompt.fn,
    }),
    /would drop git-hooks/,
  );
});

// The prompt offers only what is absent, which is what makes deselection
// unrepresentable rather than merely rejected.
test("precedence: a TTY prompts, and is offered only the absent scaffolds", async () => {
  const prompt = fakePrompt([SCAFFOLD.COMMIT_HYGIENE]);
  const { ids, source } = await resolve_({
    recorded: [SCAFFOLD.GIT_HOOKS],
    interactive: true,
    prompt: prompt.fn,
  });
  assert.deepEqual(prompt.calls[0].offer, [
    SCAFFOLD.QUALITY_GATES,
    SCAFFOLD.COMMIT_HYGIENE,
  ]);
  assert.deepEqual(prompt.calls[0].installed, [SCAFFOLD.GIT_HOOKS]);
  // Unioned with the record, never replacing it.
  assert.deepEqual(ids, [SCAFFOLD.COMMIT_HYGIENE, SCAFFOLD.GIT_HOOKS]);
  assert.equal(source, "prompt");
});

// The common re-run and `--force` upgrade path: nothing left to offer, so the
// run never stops for input.
test("a fully-installed repo is never prompted, even on a TTY", async () => {
  const prompt = fakePrompt([]);
  const { ids, source } = await resolve_({
    recorded: [...SCAFFOLD_IDS],
    interactive: true,
    prompt: prompt.fn,
  });
  assert.equal(prompt.calls.length, 0);
  assert.deepEqual(ids, SCAFFOLD_IDS);
  assert.equal(source, "recorded");
});

test("a cancelled prompt installs nothing and leaves the record alone", async () => {
  await assert.rejects(
    resolve_({
      recorded: [SCAFFOLD.GIT_HOOKS],
      interactive: true,
      prompt: async () => null,
    }),
    (err) => {
      assert.ok(err instanceof SelectionError);
      assert.equal(err.code, 1);
      assert.match(err.message, /Cancelled/);
      assert.match(err.message, /recorded selection is unchanged/);
      return true;
    },
  );
});

test("a prompt that adds nothing to an empty record is refused", async () => {
  await assert.rejects(
    resolve_({ recorded: [], interactive: true, prompt: async () => [] }),
    /nothing to install/,
  );
});

test("a prompt that adds nothing keeps a non-empty record", async () => {
  const { ids } = await resolve_({
    recorded: [SCAFFOLD.GIT_HOOKS],
    interactive: true,
    prompt: async () => [],
  });
  assert.deepEqual(ids, [SCAFFOLD.GIT_HOOKS]);
});

test("precedence: a non-interactive run honours the recorded selection", async () => {
  const { ids, source } = await resolve_({
    recorded: [SCAFFOLD.GIT_HOOKS],
    interactive: false,
  });
  assert.deepEqual(ids, [SCAFFOLD.GIT_HOOKS]);
  assert.equal(source, "recorded");
});

// The tail that keeps a scripted `init` in a pre-manifest repo behaving exactly
// as it did before the manifest existed.
test("precedence: a bare non-interactive run with no record installs all-in", async () => {
  const { ids, source } = await resolve_({ recorded: [], interactive: false });
  assert.deepEqual(ids, SCAFFOLD_IDS);
  assert.equal(source, "all-in");
});
