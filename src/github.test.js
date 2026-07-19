import { test } from "node:test";
import assert from "node:assert/strict";

import { GitHub, ApiUnavailableError } from "./github.js";

// A fake fetch driven by a queue of scripted outcomes. Each entry is either a
// response spec `{ status, body }` or an Error to throw (a network/timeout
// fault). `calls` counts invocations so a test can assert retry vs no-retry.
function fakeFetch(script) {
  const state = { calls: 0 };
  const fetch = async () => {
    const step = script[state.calls];
    state.calls += 1;
    if (step instanceof Error) throw step;
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.body ?? {},
    };
  };
  return { fetch, state };
}

// Zero backoff keeps the retry tests instant; three attempts matches the default.
function client(fetch) {
  return new GitHub({
    token: "t",
    owner: "o",
    repo: "r",
    fetchImpl: fetch,
    retryAttempts: 3,
    retryBackoffMs: 0,
  });
}

test("a 5xx that clears within the window resolves without failing", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    { status: 502 },
    { status: 200, body: { number: 7, user: { login: "octocat" } } },
  ]);
  const pr = await client(fetch).getPullRequest(7);
  assert.equal(pr.number, 7);
  assert.equal(pr.author, "octocat");
  assert.equal(state.calls, 3, "should retry twice then succeed");
});

test("a persistent 5xx throws ApiUnavailableError carrying the status", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    { status: 503 },
    { status: 503 },
  ]);
  await assert.rejects(client(fetch).getPullRequest(7), (err) => {
    assert.ok(err instanceof ApiUnavailableError);
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(state.calls, 3, "should exhaust exactly retryAttempts attempts");
});

test("a 4xx fails immediately with no retry", async () => {
  const { fetch, state } = fakeFetch([{ status: 404 }]);
  await assert.rejects(client(fetch).getPullRequest(7), (err) => {
    assert.ok(!(err instanceof ApiUnavailableError), "4xx is not an outage");
    assert.match(err.message, /Failed to fetch pull request: 404/);
    return true;
  });
  assert.equal(state.calls, 1, "a 4xx must not be retried");
});

test("a network error retries then succeeds", async () => {
  const { fetch, state } = fakeFetch([
    new Error("ECONNRESET"),
    { status: 200, body: { number: 9 } },
  ]);
  const issue = await client(fetch).getIssue(9);
  assert.equal(issue.number, 9);
  assert.equal(state.calls, 2);
});

test("a persistent network error throws ApiUnavailableError with null status", async () => {
  const { fetch } = fakeFetch([
    new Error("timeout"),
    new Error("timeout"),
    new Error("timeout"),
  ]);
  await assert.rejects(client(fetch).getIssue(9), (err) => {
    assert.ok(err instanceof ApiUnavailableError);
    assert.equal(err.status, null);
    return true;
  });
});

test("getIssue surfaces a persistent 5xx as an outage, not a rule failure", async () => {
  const { fetch } = fakeFetch([
    { status: 500 },
    { status: 500 },
    { status: 500 },
  ]);
  await assert.rejects(
    client(fetch).getIssue(3),
    (err) => err instanceof ApiUnavailableError && err.status === 500,
  );
});

test("a paginated read (#paginate) retries a 5xx on a page", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    {
      status: 200,
      body: [{ sha: "abc", commit: { message: "feat: x\n\nbody" } }],
    },
  ]);
  const commits = await client(fetch).getPullRequestCommits(7);
  assert.deepEqual(commits, [{ sha: "abc", subject: "feat: x" }]);
  assert.equal(state.calls, 2);
});
