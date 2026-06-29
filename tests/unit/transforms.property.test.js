// ── Property-based tests: transforms + frontmatter ───────────────────────────
// Uses fast-check to verify invariants hold across 1000+ arbitrary inputs.
import { test, describe } from 'node:test';
import fc from 'fast-check';
import {
  slugify,
  setFrontmatterField,
  extractFrontmatterField,
  stripFrontmatter,
} from '../../src/utils/transforms.js';
import { patchFrontmatter, dropFrontmatterField } from '../../src/utils/frontmatter.js';

const NUM_RUNS = 1000;

// Field names: valid YAML keys (letter/underscore start, alphanumeric/_)
const fieldName = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,19}$/);

// Values safe to round-trip through YAML:
// - Start with uppercase to avoid YAML 1.2 null/bool keyword ambiguity
// - Alphanumeric and dots only: no spaces (trimmed by patchFrontmatter), no hyphens
//   (sequences of three hyphens would confuse the stripFrontmatter regex), no colons
const yamlSafeValue = fc.stringMatching(/^[A-Z][A-Za-z0-9.]{0,49}$/);

// Simple body text that doesn't start with --- (to avoid confusing frontmatter)
const docBody = fc.string({ maxLength: 200 }).map((s) => (s.startsWith('---') ? 'x' + s : s));

// A document with zero or more unique-keyed frontmatter fields
const docArb = fc
  .tuple(
    fc.uniqueArray(fc.tuple(fieldName, yamlSafeValue), {
      maxLength: 4,
      selector: ([k]) => k,
    }),
    docBody
  )
  .map(([fields, body]) => {
    if (fields.length === 0) return body;
    const yaml = fields.map(([k, v]) => `${k}: ${v}`).join('\n');
    return `---\n${yaml}\n---\n${body}`;
  });

// ── slugify ───────────────────────────────────────────────────────────────────
describe('Property-based: slugify', () => {
  test('output only contains [a-z0-9-]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => /^[a-z0-9-]*$/.test(slugify(s))),
      { numRuns: NUM_RUNS }
    );
  });

  test('output length is at most 50', () => {
    fc.assert(
      fc.property(fc.string(), (s) => slugify(s).length <= 50),
      { numRuns: NUM_RUNS }
    );
  });

  test('is idempotent: slugify(slugify(x)) === slugify(x)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => slugify(slugify(s)) === slugify(s)),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── patchFrontmatter ──────────────────────────────────────────────────────────
describe('Property-based: patchFrontmatter', () => {
  test('is idempotent: patch(patch(doc,f,v), f, v) === patch(doc, f, v)', () => {
    fc.assert(
      fc.property(docArb, fieldName, yamlSafeValue, (doc, field, value) => {
        const once = patchFrontmatter(doc, field, value);
        const twice = patchFrontmatter(once, field, value);
        return once === twice;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('field is present in output after patch', () => {
    fc.assert(
      fc.property(docArb, fieldName, yamlSafeValue, (doc, field, value) => {
        const patched = patchFrontmatter(doc, field, value);
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escaped}:`, 'm').test(patched);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── setFrontmatterField / extractFrontmatterField round-trip ─────────────────
describe('Property-based: frontmatter round-trip', () => {
  test('extract(set(doc, field, value), field) === value', () => {
    fc.assert(
      fc.property(docArb, fieldName, yamlSafeValue, (doc, field, value) => {
        const updated = setFrontmatterField(doc, field, value);
        return extractFrontmatterField(updated, field) === value;
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── dropFrontmatterField ──────────────────────────────────────────────────────
describe('Property-based: dropFrontmatterField', () => {
  test('field is absent after set-then-drop', () => {
    fc.assert(
      fc.property(docArb, fieldName, yamlSafeValue, (doc, field, value) => {
        const withField = setFrontmatterField(doc, field, value);
        const dropped = dropFrontmatterField(withField, field);
        return extractFrontmatterField(dropped, field) === null;
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── stripFrontmatter ──────────────────────────────────────────────────────────
describe('Property-based: stripFrontmatter', () => {
  test('is idempotent: strip(strip(x)) === strip(x)', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const once = stripFrontmatter(doc);
        const twice = stripFrontmatter(once);
        return once === twice;
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test('output never starts with the frontmatter fence when input has valid frontmatter', () => {
    // Generates only well-formed frontmatter docs (not arbitrary strings), so stripping
    // removes the entire fence block and the result starts with the body.
    const wellFormedDoc = fc
      .tuple(
        fc.uniqueArray(fc.tuple(fieldName, yamlSafeValue), {
          minLength: 1,
          maxLength: 4,
          selector: ([k]) => k,
        }),
        docBody
      )
      .map(([fields, body]) => {
        const yaml = fields.map(([k, v]) => `${k}: ${v}`).join('\n');
        return `---\n${yaml}\n---\n${body}`;
      });
    fc.assert(
      fc.property(wellFormedDoc, (doc) => !stripFrontmatter(doc).startsWith('---\n')),
      { numRuns: NUM_RUNS }
    );
  });
});
