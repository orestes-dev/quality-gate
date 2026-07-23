import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCAFFOLDS } from "./scaffolds.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- drift: the Dogfood instance equals the canonical bundle, with no exception ---

// `init` writes every `SCAFFOLDS[].files` entry into a consumer verbatim, and this
// repo's own installed copies are one such install (the Dogfood instance). So the
// claim `src/scaffolds.js` makes in prose, "every destination is a byte-for-byte
// copy of its source", is asserted here once for the whole manifest rather than
// per file: a new scaffold file is drift-checked the moment it joins the table,
// with no test to remember to write (ADR 0003, ADR 0018).
for (const { id, files } of SCAFFOLDS) {
  for (const { from, to } of files) {
    test(`${id}: ${to} is byte-identical to its templates source`, () => {
      assert.equal(
        readFileSync(join(ROOT, to), "utf8"),
        readFileSync(from, "utf8"),
      );
    });
  }
}
