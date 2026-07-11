// Human-readable rendering of a validation scorecard, shared by the CI bot
// comment and the pre-flight CLI output. Both show every check, pass included,
// so a clean issue gets positive confirmation rather than silence.

import { COMMENT_MARKER, STATUS, OVERRIDE_LABEL, OVERRIDE_HEADING } from './schema.js';

const ICON = {
  [STATUS.PASS]: '✅',
  [STATUS.WARN]: '⚠️',
  [STATUS.FAIL]: '❌',
};

const FIX_FOOTER =
  `> Fix the failing checks, or add the \`${OVERRIDE_LABEL}\` label with an ` +
  `\`## ${OVERRIDE_HEADING}\` section in the issue body to bypass.`;
const WARN_FOOTER = '> All required checks pass. Warnings are informational.';
const PASS_FOOTER = '> All checks pass. This issue meets the structural quality bar.';

function footer(checks) {
  if (checks.some((c) => c.status === STATUS.FAIL)) return FIX_FOOTER;
  if (checks.some((c) => c.status === STATUS.WARN)) return WARN_FOOTER;
  return PASS_FOOTER;
}

// Markdown body for the bot comment. Includes the hidden marker so the comment
// can be located and updated in place on later runs.
export function renderComment({ checks }) {
  const lines = [COMMENT_MARKER, '### Issue Quality Checklist', ''];
  for (const c of checks) {
    lines.push(`- ${ICON[c.status]} **${c.label}**: ${c.message}`);
  }
  lines.push('', footer(checks));
  return lines.join('\n');
}

// Plain-text report for terminal / CLI output.
export function renderCli({ checks }) {
  const worst = checks.some((c) => c.status === STATUS.FAIL)
    ? 'FAILED'
    : checks.some((c) => c.status === STATUS.WARN)
      ? 'passed with warnings'
      : 'passed';
  const lines = [`Issue quality gate: ${worst}`];
  for (const c of checks) {
    lines.push(`  ${ICON[c.status]} ${c.label}: ${strip(c.message)}`);
  }
  return lines.join('\n');
}

// Drop markdown bold/code markers for terminal readability.
function strip(text) {
  return text.split('**').join('').split('`').join('');
}
