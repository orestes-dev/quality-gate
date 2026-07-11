#!/usr/bin/env node
// CLI entry for `npx github:orestes-dev/issue-quality-gate <command>`.
//
//   init             Drop the Issue Form + thin workflow into the current repo.
//   validate <file>  Run the validator against an issue body file (pre-flight).
//   sweep            Backfill labels + scorecards across a repo's open issues.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { validate, failures } from '../src/validator.js';
import { renderCli } from '../src/report.js';
import { GitHub } from '../src/github.js';
import { sweep } from '../src/sweep.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const TEMPLATES = [
  {
    from: join(ROOT, 'templates', 'issue-form.yml'),
    to: join('.github', 'ISSUE_TEMPLATE', 'task.yml'),
  },
  {
    from: join(ROOT, 'templates', 'workflow.yml'),
    to: join('.github', 'workflows', 'issue-quality.yml'),
  },
];

function cmdInit() {
  // Soft guard against the one silent foot-gun: run from a subdirectory and the
  // files land where GitHub never looks. `.github/` is only read at the repo
  // root, whose worktree carries a `.git` entry (a directory in a normal clone,
  // a file in a linked worktree). Warn but proceed: scaffolding into a fresh
  // dir before `git init` is legitimate.
  if (!existsSync(resolve(process.cwd(), '.git'))) {
    console.warn(
      'warning: no .git in the current directory. GitHub only reads .github/ ' +
        'from the repository root; run this there or the workflow will not run.',
    );
  }

  for (const { from, to } of TEMPLATES) {
    const dest = resolve(process.cwd(), to);
    if (existsSync(dest)) {
      console.log(`skip   ${to} (already exists)`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(from, 'utf8'));
    console.log(`create ${to}`);
  }
  console.log(
    '\nDone. Commit both files to opt this repo into the issue quality gate.\n' +
      'The gate only labels issues going forward. To backfill labels + scorecards ' +
      'onto the existing open backlog, run: issue-quality-gate sweep',
  );
}

function cmdValidate(file) {
  if (!file) {
    console.error('usage: issue-quality-gate validate <file>');
    process.exit(2);
  }
  const body = readFileSync(resolve(process.cwd(), file), 'utf8');
  const result = validate(body);
  console.log(renderCli(result));
  process.exit(failures(result.checks).length > 0 ? 1 : 0);
}

// `sweep` runs locally on demand, not in CI, so it borrows the operator's own
// GitHub CLI session for both credentials and repo context instead of demanding
// a GITHUB_TOKEN and a --repo flag. `gh` is already how this workflow talks to
// GitHub everywhere else.
function gh(args, hint) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' }).trim();
  } catch {
    console.error(`error: \`gh ${args.join(' ')}\` failed. ${hint}`);
    process.exit(2);
  }
}

async function cmdSweep() {
  const token = gh(
    ['auth', 'token'],
    'Install the GitHub CLI and run `gh auth login`.',
  );
  const { owner, name } = JSON.parse(
    gh(
      ['repo', 'view', '--json', 'owner,name'],
      'Run this from inside a GitHub repository clone.',
    ),
  );
  const client = new GitHub({
    token,
    apiUrl: process.env.GITHUB_API_URL,
    owner: owner.login,
    repo: name,
  });

  const { swept, failed, totalCount, capped } = await sweep({
    gh: client,
    log: (line) => console.log(line),
  });

  const tally = `swept ${swept}, failed ${failed.length}`;
  console.log(`\n${tally}`);
  if (capped) {
    console.log(
      `note: ${totalCount} issues matched but the Search API caps results at ` +
        '1000. Swept issues drop out of the query, so re-run `sweep` to continue.',
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'init':
      return cmdInit();
    case 'validate':
      return cmdValidate(rest[0]);
    case 'sweep':
      return cmdSweep();
    default:
      console.error(
        'usage: issue-quality-gate <init|validate|sweep>\n' +
          '  init             scaffold the Issue Form + workflow into this repo\n' +
          '  validate <file>  validate an issue body file (exit 1 on hard errors)\n' +
          '  sweep            backfill labels + scorecards on a repo\'s open issues',
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
