// Minimal GitHub REST client using global fetch. Zero dependencies so the
// composite action can run without an `npm install` step on the runner.

// Bound every request so a hung connection cannot stall the whole action; the
// job's own timeout is a far coarser backstop. No retry: a transient failure
// fails the run, and the next issue event re-runs the diff-based gate cleanly.
const REQUEST_TIMEOUT_MS = 10_000;

// Search API paging: 100 results per page, and GitHub caps total search results
// at 1000 (10 full pages), regardless of how many issues actually match.
const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = 10;

function stripTrailingSlashes(url) {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}

export class GitHub {
  constructor({ token, apiUrl, owner, repo }) {
    this.token = token;
    this.apiUrl = stripTrailingSlashes(apiUrl || 'https://api.github.com');
    this.owner = owner;
    this.repo = repo;
  }

  async #request(method, path, body) {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'issue-quality-gate',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res;
  }

  #base() {
    return `/repos/${this.owner}/${this.repo}`;
  }

  // Fetch the issue fresh from the API (see the call site in action.js for why
  // the webhook event payload cannot be trusted here).
  async getIssue(issueNumber) {
    const res = await this.#request(
      'GET',
      `${this.#base()}/issues/${issueNumber}`,
    );
    if (!res.ok) throw new Error(`Failed to fetch issue: ${res.status}`);
    return res.json();
  }

  // Create the label with intentional color/description if it does not exist.
  async ensureLabel(name, color, description) {
    const res = await this.#request(
      'GET',
      `${this.#base()}/labels/${encodeURIComponent(name)}`,
    );
    if (res.ok) return;
    if (res.status !== 404) {
      throw new Error(`Failed to look up label ${name}: ${res.status}`);
    }
    const create = await this.#request('POST', `${this.#base()}/labels`, {
      name,
      color,
      description,
    });
    // 422 = created concurrently by a racing run; treat as success.
    if (!create.ok && create.status !== 422) {
      throw new Error(`Failed to create label ${name}: ${create.status}`);
    }
  }

  async addLabels(issueNumber, labels) {
    if (labels.length === 0) return;
    const res = await this.#request(
      'POST',
      `${this.#base()}/issues/${issueNumber}/labels`,
      { labels },
    );
    if (!res.ok) throw new Error(`Failed to add labels: ${res.status}`);
  }

  async removeLabel(issueNumber, label) {
    const res = await this.#request(
      'DELETE',
      `${this.#base()}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    );
    // 404 = label wasn't present; not an error for our purposes.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to remove label ${label}: ${res.status}`);
    }
  }

  // Find the first comment matching `predicate`, paging lazily and returning as
  // soon as one hits. The gate comment is created early in an issue's life (the
  // first failing/warning run), so on a long thread it lives on the first page
  // and this returns without fetching every comment.
  async findComment(issueNumber, predicate) {
    let page = 1;
    for (;;) {
      const res = await this.#request(
        'GET',
        `${this.#base()}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      );
      if (!res.ok) throw new Error(`Failed to list comments: ${res.status}`);
      const batch = await res.json();
      const hit = batch.find(predicate);
      if (hit) return hit;
      if (batch.length < 100) return null;
      page += 1;
    }
  }

  // Search issues in this repo matching `qualifiers` (a raw search-qualifier
  // string, e.g. `is:issue is:open -label:"x"`). Pages through the results up to
  // the Search API's hard 1000-result cap. Returns `{ totalCount, items }` where
  // `totalCount` is the full match count reported by the API — it can exceed
  // `items.length` when the cap truncates, letting the caller detect a partial
  // sweep and prompt a re-run. `is:issue` in the query excludes pull requests
  // server-side, so `items` never contains a PR.
  async searchIssues(qualifiers) {
    const q = `repo:${this.owner}/${this.repo} ${qualifiers}`;
    const items = [];
    let totalCount = 0;
    for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
      const res = await this.#request(
        'GET',
        `/search/issues?q=${encodeURIComponent(q)}&per_page=${SEARCH_PER_PAGE}&page=${page}`,
      );
      if (!res.ok) throw new Error(`Failed to search issues: ${res.status}`);
      const body = await res.json();
      totalCount = body.total_count;
      items.push(...body.items);
      if (body.items.length < SEARCH_PER_PAGE) break;
    }
    return { totalCount, items };
  }

  async createComment(issueNumber, bodyText) {
    const res = await this.#request(
      'POST',
      `${this.#base()}/issues/${issueNumber}/comments`,
      { body: bodyText },
    );
    if (!res.ok) throw new Error(`Failed to create comment: ${res.status}`);
  }

  async updateComment(commentId, bodyText) {
    const res = await this.#request(
      'PATCH',
      `${this.#base()}/issues/comments/${commentId}`,
      { body: bodyText },
    );
    if (!res.ok) throw new Error(`Failed to update comment: ${res.status}`);
  }

  async deleteComment(commentId) {
    const res = await this.#request(
      'DELETE',
      `${this.#base()}/issues/comments/${commentId}`,
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete comment: ${res.status}`);
    }
  }
}
