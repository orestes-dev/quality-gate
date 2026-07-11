// Single source of truth for the issue schema the gate enforces.
//
// The GitHub Issue Form (templates/issue-form.yml) is the canonical schema for
// *authoring* an issue; this module is the canonical schema for *validating*
// one. The field HEADINGS below MUST match the Issue Form element labels,
// because GitHub renders each element's `label` as a `### <label>` heading in
// the submitted issue body, and that is what the validator parses.

// Rendered `### ` headings, matching Issue Form element labels exactly.
export const FIELD = {
  CONTEXT: 'Context',
  ACCEPTANCE_CRITERIA: 'Acceptance Criteria',
  OUT_OF_SCOPE: 'Out of Scope',
  SIZE: 'Size',
};

// GitHub renders an empty optional field as this literal. Treat it as absent.
export const NO_RESPONSE = '_No response_';

// Size enum, in ascending order. L/XL are too big for a single agent run.
export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
export const BLOCKING_SIZES = ['L', 'XL'];

// Minimum trimmed length (characters) for prose fields. Presence + min-length
// are both hard errors.
export const MIN_LENGTH = {
  [FIELD.CONTEXT]: 30,
  [FIELD.OUT_OF_SCOPE]: 10,
};

// Maximum length for the narrative field. Exceeding it is a WARNING only: a
// fluff / narrative-bloat detector that flags but never blocks.
export const MAX_LENGTH = {
  [FIELD.CONTEXT]: 1500,
};

// Per-check outcome, worst-wins across a field's rules. The scorecard comment
// renders one line per check with an icon derived from this; the mutually
// exclusive label reflects the worst status across all checks.
export const STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };

// Labels applied by the gate. Mutually exclusive.
export const LABEL = {
  FAILING: 'issue-quality:failing',
  WARNING: 'issue-quality:warning',
  PASS: 'issue-quality:pass',
};

// Metadata so the gate can create the labels with intentional colors and
// descriptions rather than letting GitHub auto-create them gray and blank.
export const LABEL_META = {
  [LABEL.FAILING]: {
    color: 'd93f0b',
    description: 'Issue has failing quality checks; not ready for pickup',
  },
  [LABEL.WARNING]: {
    color: 'fbca04',
    description: 'Issue passes but has non-blocking quality warnings',
  },
  [LABEL.PASS]: {
    color: '0e8a16',
    description: 'Issue meets all quality checks',
  },
};

// Manual escape hatch. Setting this label AND writing a non-empty
// `## Override rationale` section in the issue body bypasses the gate.
export const OVERRIDE_LABEL = 'override:issue-quality';
export const OVERRIDE_HEADING = 'Override rationale';

// Marker embedded in the bot comment so it can be found and updated in place.
export const COMMENT_MARKER = '<!-- issue-quality-gate -->';
