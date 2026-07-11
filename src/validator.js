// Deterministic, dependency-free validator: presence, min/max length,
// checklist item count, enum membership only.
//
// Parsing is done with plain string operations (no regex): the submitted issue
// body is a sequence of `### <label>` sections produced by the Issue Form.

import {
  FIELD,
  NO_RESPONSE,
  SIZES,
  BLOCKING_SIZES,
  MIN_LENGTH,
  MAX_LENGTH,
  LABEL,
  STATUS,
  OVERRIDE_HEADING,
} from './schema.js';

// Checklist item prefixes we accept, matching GitHub's task-list rendering:
// any of the `-`/`*`/`+` bullets, checked (`[x]`/`[X]`) or unchecked (`[ ]`).
const BULLETS = ['-', '*', '+'];
const BOXES = ['[ ]', '[x]', '[X]'];
const CHECKLIST_PREFIXES = BULLETS.flatMap((bullet) =>
  BOXES.map((box) => `${bullet} ${box}`),
);

// The only headings that delimit a section. GitHub renders each Issue Form
// field label as `### <label>`; the override rationale is a hand-written
// `## Override rationale`. Restricting boundaries to this set means arbitrary
// headings or fenced code blocks *inside* a field (e.g. a shell `## comment`
// pasted into Context) no longer mis-split the body.
const KNOWN_HEADINGS = new Set([...Object.values(FIELD), OVERRIDE_HEADING]);

// Return the heading text of a markdown h2/h3 line (`## ` or `### `), or null.
function parseHeading(line) {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === '#') hashes += 1;
  if (hashes < 2 || line[hashes] !== ' ') return null;
  return line.slice(hashes + 1).trim();
}

// Split a submitted issue body into a { heading: text } map. Only the known
// schema headings act as section boundaries; every other line is content.
export function parseSections(body) {
  const sections = {};
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections[current] = buffer.join('\n').trim();
  };

  for (const rawLine of String(body ?? '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const heading = parseHeading(line);
    if (heading !== null && KNOWN_HEADINGS.has(heading)) {
      flush();
      current = heading;
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return sections;
}

// True when the body carries a non-empty `## Override rationale` section.
export function hasOverrideRationale(body) {
  const sections = parseSections(body);
  const rationale = sections[OVERRIDE_HEADING];
  return typeof rationale === 'string' && rationale.trim().length > 0;
}

// A field is "present" when it has non-empty content that is not the
// Issue Form's placeholder for an empty response.
function fieldValue(sections, heading) {
  const raw = sections[heading];
  if (raw === undefined) return '';
  const trimmed = raw.trim();
  if (trimmed === NO_RESPONSE) return '';
  return trimmed;
}

// Count checklist items that carry actual text. A bare `- [ ]` (the Issue
// Form's prefill) is not a verifiable outcome, so it does not count.
function countChecklistItems(text) {
  let count = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const prefix = CHECKLIST_PREFIXES.find((p) => line.startsWith(p));
    if (prefix === undefined) continue;
    if (line.slice(prefix.length).trim().length > 0) count += 1;
  }
  return count;
}

// One check result. `message` describes the outcome for its status (why it
// failed, or a short confirmation when it passed) and is rendered verbatim into
// the scorecard line for `label`.
const check = (key, label, status, message) => ({ key, label, status, message });

// A prose field: presence + min-length are hard; an optional max-length is a
// warning-only fluff detector. Worst status wins, so one line covers the field.
function checkProse(sections, key, heading) {
  const value = fieldValue(sections, heading);
  if (value === '') return check(key, heading, STATUS.FAIL, 'missing or empty');
  const min = MIN_LENGTH[heading];
  if (min && value.length < min) {
    return check(
      key,
      heading,
      STATUS.FAIL,
      `too short (${value.length} chars, need at least ${min})`,
    );
  }
  const max = MAX_LENGTH[heading];
  if (max && value.length > max) {
    return check(
      key,
      heading,
      STATUS.WARN,
      `long (${value.length} chars, over ${max}); trim narrative bloat`,
    );
  }
  return check(key, heading, STATUS.PASS, `present (${value.length} chars)`);
}

// Acceptance Criteria: a checklist with at least one non-empty item.
function checkAcceptanceCriteria(sections) {
  const key = 'acceptance-criteria';
  const heading = FIELD.ACCEPTANCE_CRITERIA;
  const value = fieldValue(sections, heading);
  if (value === '') return check(key, heading, STATUS.FAIL, 'missing or empty');
  const items = countChecklistItems(value);
  if (items < 1) {
    return check(
      key,
      heading,
      STATUS.FAIL,
      'must contain at least one checklist item (`- [ ]`)',
    );
  }
  return check(
    key,
    heading,
    STATUS.PASS,
    `${items} checklist item${items === 1 ? '' : 's'}`,
  );
}

// Size: enum membership + L/XL blocks as too large to land as one issue. Both hard.
function checkSize(sections) {
  const key = 'size';
  const heading = FIELD.SIZE;
  const size = fieldValue(sections, heading) || null;
  if (size === null) return { check: check(key, heading, STATUS.FAIL, 'missing'), size };
  if (!SIZES.includes(size)) {
    return {
      check: check(key, heading, STATUS.FAIL, `must be one of ${SIZES.join(', ')}`),
      size,
    };
  }
  if (BLOCKING_SIZES.includes(size)) {
    return {
      check: check(
        key,
        heading,
        STATUS.FAIL,
        `${size} is too big to land as one issue; split it into smaller issues`,
      ),
      size,
    };
  }
  return { check: check(key, heading, STATUS.PASS, size), size };
}

// Validate a submitted issue body. Returns a full per-check scorecard so the
// bot comment can show every check (pass included), not just the failures:
//   { checks: {key,label,status,message}[], size: string|null }.
export function validate(body) {
  const sections = parseSections(body);
  const size = checkSize(sections);
  const checks = [
    checkProse(sections, 'context', FIELD.CONTEXT),
    checkAcceptanceCriteria(sections),
    checkProse(sections, 'out-of-scope', FIELD.OUT_OF_SCOPE),
    size.check,
  ];
  return { checks, size: size.size };
}

// Convenience predicates over a scorecard, so call sites need not know the
// STATUS strings.
export const failures = (checks) => checks.filter((c) => c.status === STATUS.FAIL);
export const warnings = (checks) => checks.filter((c) => c.status === STATUS.WARN);

// Which mutually-exclusive quality label the scorecard implies: worst wins.
export function labelFor({ checks }) {
  if (checks.some((c) => c.status === STATUS.FAIL)) return LABEL.FAILING;
  if (checks.some((c) => c.status === STATUS.WARN)) return LABEL.WARNING;
  return LABEL.PASS;
}
