// ── Unit tests: public/js/skills.js ─────────────────────────────────────────
// Pure card-markup builders backing the Skills view's command editor (#460).
// skills.js only imports pure/DOM-inert modules (state.js -> store.js, and
// actions.js), so no mocking beyond the window shim is needed to reach them.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { renderSkillCard, renderProductContext, SKILL_ACTIONS } =
  await import('../../public/js/skills.js');

function makeSkill(overrides = {}) {
  return {
    name: 'create-stories',
    description: 'Create a user story',
    content: 'Story template body',
    source: 'template',
    ...overrides,
  };
}

// ── renderSkillCard ──────────────────────────────────────────────────────────
describe('renderSkillCard()', () => {
  test('renders the name, description and content of a template skill', () => {
    const html = renderSkillCard(makeSkill());
    assert.match(html, /data-skill="create-stories"/);
    assert.match(html, /<div class="skill-desc">Create a user story<\/div>/);
    assert.match(html, />Story template body<\/textarea>/);
  });

  test('a template skill gets the template badge and no reset button', () => {
    const html = renderSkillCard(makeSkill({ source: 'template' }));
    assert.match(html, /class="skill-badge template"[^>]*>Template</);
    assert.doesNotMatch(html, /btn-skill-reset/);
  });

  test('a custom skill gets the custom badge and a reset button', () => {
    const html = renderSkillCard(makeSkill({ source: 'custom' }));
    assert.match(html, /class="skill-badge custom"[^>]*>Custom</);
    assert.match(html, /btn-skill-reset/);
    assert.match(html, new RegExp(`data-action="${SKILL_ACTIONS.reset}"`));
  });

  test('an unrecognized source falls back to the template badge', () => {
    for (const source of ['', 'example', 'CUSTOM']) {
      const html = renderSkillCard(makeSkill({ source }));
      assert.match(html, /class="skill-badge template"[^>]*>Template</);
      assert.doesNotMatch(html, /btn-skill-reset/);
    }
  });

  test('the display name drops a leading create- prefix and title-cases the rest', () => {
    assert.match(
      renderSkillCard(makeSkill({ name: 'create-stories' })),
      /<span class="skill-name">Stories<\/span>/
    );
    assert.match(
      renderSkillCard(makeSkill({ name: 'refine-epics' })),
      /<span class="skill-name">Refine Epics<\/span>/
    );
    assert.match(
      renderSkillCard(makeSkill({ name: 'backlog-analysis-agent' })),
      /<span class="skill-name">Backlog Analysis Agent<\/span>/
    );
  });

  test('only a leading create- prefix is stripped, not one in the middle', () => {
    assert.match(
      renderSkillCard(makeSkill({ name: 'bug-create-flow' })),
      /<span class="skill-name">Bug Create Flow<\/span>/
    );
  });

  test('wires every button to its typed data-action', () => {
    const html = renderSkillCard(makeSkill({ source: 'custom' }));
    for (const action of [
      SKILL_ACTIONS.toggleCard,
      SKILL_ACTIONS.save,
      SKILL_ACTIONS.improve,
      SKILL_ACTIONS.reset,
    ]) {
      assert.match(html, new RegExp(`data-action="${action}"`));
    }
  });

  test('escapes HTML in the name, description and content', () => {
    const html = renderSkillCard(
      makeSkill({
        name: 'a"b<c',
        description: '<script>alert(1)</script>',
        content: 'a & b',
      })
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /a &amp; b/);
    assert.match(html, /data-skill="a&quot;b&lt;c"/);
  });

  test('escapes the name everywhere it is interpolated, ids included', () => {
    const html = renderSkillCard(makeSkill({ name: 'x"y' }));
    assert.doesNotMatch(html, /id="skill-(chev|body|ta|badge|status)-x"y"/);
    assert.match(html, /id="skill-chev-x&quot;y"/);
    assert.match(html, /id="skill-status-x&quot;y"/);
  });

  test('empty description and content render empty containers', () => {
    const html = renderSkillCard(makeSkill({ description: '', content: '' }));
    assert.match(html, /<div class="skill-desc"><\/div>/);
    assert.match(html, /><\/textarea>/);
  });
});

// ── renderProductContext ─────────────────────────────────────────────────────
describe('renderProductContext()', () => {
  test('renders the context content into the textarea', () => {
    const html = renderProductContext({ content: 'We build MIDAS.', source: 'template' });
    assert.match(html, />We build MIDAS\.<\/textarea>/);
    assert.match(html, /data-skill="product-context"/);
  });

  test('a template context gets the template badge and no reset button', () => {
    const html = renderProductContext({ content: 'x', source: 'template' });
    assert.match(html, /class="skill-badge template"[^>]*>Template</);
    assert.doesNotMatch(html, /btn-skill-reset/);
  });

  test('a custom context gets the custom badge and a reset button', () => {
    const html = renderProductContext({ content: 'x', source: 'custom' });
    assert.match(html, /class="skill-badge custom"[^>]*>Custom</);
    assert.match(html, new RegExp(`data-action="${SKILL_ACTIONS.resetContext}"`));
  });

  test('wires the save button to the typed save-context action', () => {
    const html = renderProductContext({ content: 'x', source: 'template' });
    assert.match(html, new RegExp(`data-action="${SKILL_ACTIONS.saveContext}"`));
    assert.match(html, new RegExp(`data-action="${SKILL_ACTIONS.toggleCard}"`));
  });

  test('escapes HTML in the context content', () => {
    const html = renderProductContext({ content: '<b>bold</b> & "quoted"', source: 'template' });
    assert.doesNotMatch(html, /<b>bold<\/b>/);
    assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; &quot;quoted&quot;/);
  });

  test('ids are always the literal product-context, independent of content', () => {
    const html = renderProductContext({ content: 'anything', source: 'custom' });
    for (const id of ['chev', 'body', 'ta', 'badge', 'status']) {
      assert.match(html, new RegExp(`id="skill-${id}-product-context"`));
    }
  });
});
