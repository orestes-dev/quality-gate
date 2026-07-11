// `init`: scaffold the Issue Form + thin workflow into the current repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const TEMPLATES = [
  {
    // Consumer's copy is UI-only; the gate reads structure from its own checkout.
    from: join(ROOT, '.github', 'ISSUE_TEMPLATE', 'task.yml'),
    to: join('.github', 'ISSUE_TEMPLATE', 'task.yml'),
  },
  {
    from: join(ROOT, 'templates', 'workflow.yml'),
    to: join('.github', 'workflows', 'issue-quality.yml'),
  },
];

/**
 * Copy the Issue Form and workflow into the current working directory, skipping
 * files that already exist. Warns (but proceeds) when not at a repo root.
 * @returns {void}
 */
export function init() {
  // Soft guard: `.github/` is only read at the repo root. Warn but proceed;
  // scaffolding into a fresh dir before `git init` is legitimate.
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
