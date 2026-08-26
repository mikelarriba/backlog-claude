// ── Integration tests: src/routes/skills.ts ───────────────────────────────────
// Skills routes previously had zero real test coverage — tests/e2e/skills.spec.js
// mocks the AI-improve response and never exercises the actual handlers. These
// tests hit the real route handlers through the running app.
//
// NOTE: skills.ts resolves `.claude/commands/<name>.md` and `.product-context.md`
// relative to the real project rootDir (server.ts passes __dirname, and unlike
// docs/inbox there is no TEST_DOCS_ROOT-style override for it) — so PUT/DELETE
// here touch real files in this checkout. Every test that writes snapshots the
// prior state and restores it in `after()`, following the same pattern already
// used by tests/integration/settings.test.js for `.pi-settings.json`.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers/testApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const COMMANDS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');
const PRODUCT_CONTEXT_PATH = path.join(PROJECT_ROOT, '.product-context.md');

// A skill name that is not the one used by other tests below, so save/reset
// tests fully own their target file and can't race each other's snapshots.
const SKILL = 'create-spikes';
const SKILL_PATH = path.join(COMMANDS_DIR, `${SKILL}.md`);

let api, stop;

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function restore(p, snapshot) {
  if (snapshot === null) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* no-op */
    }
  } else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, snapshot);
  }
}

let _prevSkillFile;
let _prevProductContext;

before(async () => {
  ({ api, stop } = await startTestApp());
  _prevSkillFile = readIfExists(SKILL_PATH);
  _prevProductContext = readIfExists(PRODUCT_CONTEXT_PATH);
});

after(async () => {
  await stop();
  restore(SKILL_PATH, _prevSkillFile);
  restore(PRODUCT_CONTEXT_PATH, _prevProductContext);
});

// ── GET /api/skills ────────────────────────────────────────────────────────────
describe('GET /api/skills', () => {
  test('returns 200 with all 8 known skills', async () => {
    const { status, data } = await api('GET', '/api/skills');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.skills));
    assert.equal(data.skills.length, 8);
  });

  test('each skill has name, description, content, and source', async () => {
    const { data } = await api('GET', '/api/skills');
    for (const skill of data.skills) {
      assert.equal(typeof skill.name, 'string');
      assert.equal(typeof skill.description, 'string');
      assert.equal(typeof skill.content, 'string');
      assert.ok(['custom', 'example'].includes(skill.source));
    }
  });
});

// ── GET /api/skills/:name ─────────────────────────────────────────────────────
describe('GET /api/skills/:name', () => {
  test('returns 200 with the skill content for a known skill', async () => {
    const { status, data } = await api('GET', `/api/skills/${SKILL}`);
    assert.equal(status, 200);
    assert.equal(data.name, SKILL);
    assert.ok(data.content.length > 0);
    assert.ok(['custom', 'example'].includes(data.source));
  });

  test('returns 400 VALIDATION_ERROR for an unknown skill name', async () => {
    const { status, data } = await api('GET', '/api/skills/not-a-real-skill');
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  // The 404 (neither custom nor example file present) branch depends on repo
  // state this suite must not assume — it's covered deterministically in
  // tests/unit/skillsRoutes.test.js using an isolated rootDir with no
  // .claude/commands(.example) directories at all.
});

// ── PUT /api/skills/:name ─────────────────────────────────────────────────────
describe('PUT /api/skills/:name', () => {
  test('returns 400 VALIDATION_ERROR for an unknown skill name', async () => {
    const { status, data } = await api('PUT', '/api/skills/not-a-real-skill', {
      content: 'anything',
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 VALIDATION_ERROR for empty content', async () => {
    const { status, data } = await api('PUT', `/api/skills/${SKILL}`, { content: '' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('saves custom content and echoes it back with source=custom', async () => {
    const content =
      '---\nname: create-spikes\ndescription: "Integration test override"\n---\n\nCustom body.';
    const { status, data } = await api('PUT', `/api/skills/${SKILL}`, { content });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.name, SKILL);
    assert.equal(data.source, 'custom');
    assert.equal(data.description, 'Integration test override');

    // The file must actually land on disk.
    assert.ok(fs.existsSync(SKILL_PATH));
    assert.equal(fs.readFileSync(SKILL_PATH, 'utf-8'), content);

    // And a subsequent GET must reflect the saved custom content.
    const get = await api('GET', `/api/skills/${SKILL}`);
    assert.equal(get.data.source, 'custom');
    assert.equal(get.data.content, content);
  });
});

// ── DELETE /api/skills/:name ──────────────────────────────────────────────────
describe('DELETE /api/skills/:name', () => {
  test('returns 400 VALIDATION_ERROR for an unknown skill name', async () => {
    const { status, data } = await api('DELETE', '/api/skills/not-a-real-skill');
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('resets a custom skill back to the example template', async () => {
    // Ensure there is a custom file to reset first.
    await api('PUT', `/api/skills/${SKILL}`, { content: 'Custom content to be reset' });
    assert.ok(fs.existsSync(SKILL_PATH));

    const { status, data } = await api('DELETE', `/api/skills/${SKILL}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.source, 'example');
    assert.equal(fs.existsSync(SKILL_PATH), false, 'custom file should be removed');
  });

  test('is idempotent — resetting again (no custom file) still returns 200', async () => {
    assert.equal(fs.existsSync(SKILL_PATH), false);
    const { status, data } = await api('DELETE', `/api/skills/${SKILL}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);
  });
});

// ── PUT /api/skills/:name/improve ─────────────────────────────────────────────
describe('PUT /api/skills/:name/improve', () => {
  test('returns 400 VALIDATION_ERROR for an unknown skill name', async () => {
    const { status, data } = await api('PUT', '/api/skills/not-a-real-skill/improve', {
      content: 'some content',
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 VALIDATION_ERROR for empty content', async () => {
    const { status, data } = await api('PUT', `/api/skills/${SKILL}/improve`, { content: '' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns the AI-improved content (mocked provider)', async () => {
    // startTestApp sets MOCK_CLAUDE=1, so callClaude() resolves deterministically.
    const { status, data } = await api('PUT', `/api/skills/${SKILL}/improve`, {
      content: 'Original template content',
    });
    assert.equal(status, 200);
    assert.equal(typeof data.improved, 'string');
    assert.ok(data.improved.length > 0);
  });
});

// ── documentation-guidance skill (#558) ───────────────────────────────────────
// Regression check that step 1 (registering the name in KNOWN_SKILLS) needed
// no route code changes: this skill round-trips through get/edit/reset/delete
// exactly like any other known skill, following the same pattern as the
// `create-spikes` tests above but with its own isolated file/snapshot.
describe('documentation-guidance skill (get/edit/reset/delete, no route changes needed)', () => {
  const DOC_GUIDANCE_SKILL = 'documentation-guidance';
  const DOC_GUIDANCE_PATH = path.join(COMMANDS_DIR, `${DOC_GUIDANCE_SKILL}.md`);
  let prevFile;

  before(() => {
    prevFile = readIfExists(DOC_GUIDANCE_PATH);
  });

  after(() => {
    restore(DOC_GUIDANCE_PATH, prevFile);
  });

  test('GET /api/skills/:name returns the example template', async () => {
    const { status, data } = await api('GET', `/api/skills/${DOC_GUIDANCE_SKILL}`);
    assert.equal(status, 200);
    assert.equal(data.name, DOC_GUIDANCE_SKILL);
    assert.ok(data.content.length > 0);
    assert.ok(['custom', 'example'].includes(data.source));
  });

  test('PUT /api/skills/:name saves custom content and echoes it back with source=custom', async () => {
    const content =
      '---\nname: documentation-guidance\ndescription: "Integration test override"\n---\n\nCustom guidance body.';
    const { status, data } = await api('PUT', `/api/skills/${DOC_GUIDANCE_SKILL}`, { content });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.name, DOC_GUIDANCE_SKILL);
    assert.equal(data.source, 'custom');
    assert.equal(data.description, 'Integration test override');

    assert.ok(fs.existsSync(DOC_GUIDANCE_PATH));
    assert.equal(fs.readFileSync(DOC_GUIDANCE_PATH, 'utf-8'), content);

    const get = await api('GET', `/api/skills/${DOC_GUIDANCE_SKILL}`);
    assert.equal(get.data.source, 'custom');
    assert.equal(get.data.content, content);
  });

  test('PUT /api/skills/:name/improve returns AI-improved content (mocked provider)', async () => {
    const { status, data } = await api('PUT', `/api/skills/${DOC_GUIDANCE_SKILL}/improve`, {
      content: 'Original guidance content',
    });
    assert.equal(status, 200);
    assert.equal(typeof data.improved, 'string');
    assert.ok(data.improved.length > 0);
  });

  test('DELETE /api/skills/:name resets the custom skill back to the example template', async () => {
    assert.ok(fs.existsSync(DOC_GUIDANCE_PATH), 'custom file from the PUT test above should exist');

    const { status, data } = await api('DELETE', `/api/skills/${DOC_GUIDANCE_SKILL}`);
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.source, 'example');
    assert.equal(fs.existsSync(DOC_GUIDANCE_PATH), false, 'custom file should be removed');
  });
});

// ── Product Context: GET/PUT/DELETE /api/settings/product-context ────────────
describe('Product Context settings', () => {
  test('GET returns content and source', async () => {
    const { status, data } = await api('GET', '/api/settings/product-context');
    assert.equal(status, 200);
    assert.equal(typeof data.content, 'string');
    assert.ok(['custom', 'example'].includes(data.source));
  });

  test('PUT rejects empty content with 400 VALIDATION_ERROR', async () => {
    const { status, data } = await api('PUT', '/api/settings/product-context', { content: '' });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('PUT saves custom content, GET reflects it, DELETE resets to example', async () => {
    const custom = '# My Product\n\nIntegration-test product context.';
    const put = await api('PUT', '/api/settings/product-context', { content: custom });
    assert.equal(put.status, 200);
    assert.equal(put.data.success, true);
    assert.equal(put.data.source, 'custom');
    assert.equal(fs.readFileSync(PRODUCT_CONTEXT_PATH, 'utf-8'), custom);

    const get = await api('GET', '/api/settings/product-context');
    assert.equal(get.data.source, 'custom');
    assert.equal(get.data.content, custom);

    const del = await api('DELETE', '/api/settings/product-context');
    assert.equal(del.status, 200);
    assert.equal(del.data.success, true);
    assert.equal(del.data.source, 'example');
    assert.equal(fs.existsSync(PRODUCT_CONTEXT_PATH), false);
  });
});
