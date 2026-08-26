// ── Unit tests: src/services/aiPromptBuilder.js (#421) ──────────────────────────
// Pure prompt-construction functions with no dedicated unit tests before this
// file (only reached transitively through route-level integration tests).
// Covers a representative case per builder plus the placeholder-preservation
// contract buildImprovePrompt documents.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeneratePrompt,
  buildUpgradePrompt,
  buildImprovePrompt,
  buildConfluenceAnalysisPrompt,
  buildSplitStoryPrompt,
} from '../../src/services/aiPromptBuilder.js';

describe('buildGeneratePrompt', () => {
  test('substitutes $ARGUMENTS into the given command template', () => {
    const prompt = buildGeneratePrompt(
      'epic',
      'Do the thing: $ARGUMENTS',
      'idea.md',
      'Raw idea content'
    );
    assert.equal(prompt, 'Do the thing: File: idea.md\n\nRaw idea content');
  });

  test('falls back to a generic COVE prompt when no command template is given', () => {
    const prompt = buildGeneratePrompt('epic', null, 'idea.md', 'Raw idea content');
    assert.match(prompt, /Generate a complete epic using the COVE Framework/);
    assert.match(prompt, /File: idea\.md/);
    assert.match(prompt, /Raw idea content/);
  });
});

describe('buildUpgradePrompt', () => {
  test('includes the current content, trimmed feedback, and inbox history', () => {
    const prompt = buildUpgradePrompt(
      'story',
      'Current story body',
      '  Make it sharper  ',
      '\n\nOriginal idea history'
    );
    assert.match(prompt, /Current story body/);
    assert.match(prompt, /Make it sharper/);
    assert.doesNotMatch(prompt, / {2}Make it sharper {2}/);
    assert.match(prompt, /Original idea history/);
    assert.match(prompt, /Preserve all COVE sections and YAML frontmatter structure/);
  });

  test('appends nothing after the content fence when inboxHistory is empty', () => {
    const prompt = buildUpgradePrompt('epic', 'Body', 'Feedback', '');
    assert.match(prompt, /---\n\nFeedback to apply:/);
  });

  test('appends the given inbox history right after the content fence', () => {
    const prompt = buildUpgradePrompt('epic', 'Body', 'Feedback', '\n\nOriginal idea history');
    assert.match(prompt, /---\n\nOriginal idea history\n\nFeedback to apply:/);
  });
});

describe('buildImprovePrompt', () => {
  test('preserves the $ARGUMENTS and {{PRODUCT_CONTEXT}} placeholders verbatim and includes the input template', () => {
    const template = '---\nfoo: bar\n---\n\n{{PRODUCT_CONTEXT}}\n\n$ARGUMENTS';
    const prompt = buildImprovePrompt(template);
    assert.match(prompt, /\$ARGUMENTS/);
    assert.match(prompt, /\{\{PRODUCT_CONTEXT\}\}/);
    assert.match(prompt, /Return ONLY the improved command template/);
    assert.ok(prompt.includes(template), 'the original template must be embedded verbatim');
  });
});

describe('buildConfluenceAnalysisPrompt', () => {
  test('renders each issue with its key, summary, and description', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      issues: [
        { key: 'EAMDM-1', summary: 'Add login flow', description: 'Users need to log in.' },
        { key: 'EAMDM-2', summary: 'Add logout flow', description: '  ' },
      ],
    });
    assert.match(prompt, /### EAMDM-1: Add login flow/);
    assert.match(prompt, /Users need to log in\./);
    assert.match(prompt, /### EAMDM-2: Add logout flow/);
    assert.match(prompt, /_No description provided\._/);
    assert.match(prompt, /"action": "Create" \| "Update" \| "Delete"/);
  });

  test('falls back to "(no summary)" when summary is empty', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      issues: [{ key: 'EAMDM-3', summary: '', description: 'Some text' }],
    });
    assert.match(prompt, /### EAMDM-3: \(no summary\)/);
  });

  test('handles an empty issues array', () => {
    const prompt = buildConfluenceAnalysisPrompt({ issues: [] });
    assert.match(prompt, /JIRA issues:\n---\n\n---/);
  });

  // ── Epic mode (#556) ──────────────────────────────────────────────────────
  test('renders an "Epics and their closed stories" block per epic, with its closed children, when epics is passed', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      epics: [
        {
          epic: { key: 'EAMDM-10', summary: 'Auth revamp epic', description: 'Overall goal.' },
          children: [
            { key: 'EAMDM-11', summary: 'Add SSO login', description: 'Users can log in via SSO.' },
            { key: 'EAMDM-12', summary: 'Fix redirect bug', description: '' },
          ],
        },
      ],
    });
    assert.match(prompt, /Epics and their closed stories:/);
    assert.match(prompt, /### EAMDM-10: Auth revamp epic/);
    assert.match(prompt, /Overall goal\./);
    assert.match(prompt, /Closed child stories/);
    assert.match(prompt, /#### EAMDM-11: Add SSO login/);
    assert.match(prompt, /Users can log in via SSO\./);
    assert.match(prompt, /#### EAMDM-12: Fix redirect bug/);
    assert.match(prompt, /_No description provided\._/);
    // The flat "JIRA issues:" label must not appear in epic mode.
    assert.doesNotMatch(prompt, /JIRA issues:/);
  });

  test('an epic with no closed children says so explicitly, rather than an empty block', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      epics: [
        {
          epic: { key: 'EAMDM-20', summary: 'Internal cleanup epic', description: 'Refactor.' },
          children: [],
        },
      ],
    });
    assert.match(prompt, /_No closed child stories/);
  });

  test('multiple epics are each rendered, separated', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      epics: [
        { epic: { key: 'EAMDM-30', summary: 'Epic A', description: 'A' }, children: [] },
        { epic: { key: 'EAMDM-31', summary: 'Epic B', description: 'B' }, children: [] },
      ],
    });
    assert.match(prompt, /### EAMDM-30: Epic A/);
    assert.match(prompt, /### EAMDM-31: Epic B/);
  });

  test('still outputs the strict JSON-array contract and empty-array instruction in epic mode', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      epics: [{ epic: { key: 'EAMDM-40', summary: 'Epic', description: '' }, children: [] }],
    });
    assert.match(prompt, /"action": "Create" \| "Update" \| "Delete"/);
    assert.match(prompt, /If no Confluence changes are needed, output an empty JSON array: \[\]/);
  });

  test('falls back to the flat issues rendering when epics is an empty array', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      issues: [{ key: 'EAMDM-50', summary: 'Flat issue', description: 'Flat description.' }],
      epics: [],
    });
    assert.match(prompt, /JIRA issues:/);
    assert.match(prompt, /### EAMDM-50: Flat issue/);
    assert.doesNotMatch(prompt, /Epics and their closed stories:/);
  });

  test('back-compat: the flat issues-only path (no epics key at all) is unchanged, empty-array instruction retained', () => {
    const prompt = buildConfluenceAnalysisPrompt({
      issues: [{ key: 'EAMDM-60', summary: 'Flat issue', description: 'Flat description.' }],
    });
    assert.match(prompt, /JIRA issues:/);
    assert.match(prompt, /If no Confluence changes are needed, output an empty JSON array: \[\]/);
  });

  // ── existingPages / Confluence grounding (#557) ────────────────────────────
  describe('existingPages', () => {
    test('replaces the "not yet implemented" disclaimer with the real page list when present and non-empty', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-70', summary: 'Issue', description: 'Desc' }],
        existingPages: [
          { title: 'Upload API', hierarchyPath: 'MIDAS > API Reference' },
          { title: 'Getting Started', hierarchyPath: 'MIDAS' },
        ],
      });
      assert.doesNotMatch(prompt, /Confluence read access is not yet implemented/);
      assert.match(prompt, /current Confluence page tree/);
      assert.match(prompt, /- Upload API \(MIDAS > API Reference\)/);
      assert.match(prompt, /- Getting Started \(MIDAS\)/);
      assert.match(prompt, /EXACT existing title from the list above/);
      assert.match(prompt, /Only use "Create" for pages that genuinely do not exist/);
    });

    test('renders a page with an empty hierarchyPath without a trailing " ()"', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-71', summary: 'Issue', description: 'Desc' }],
        existingPages: [{ title: 'Root Page', hierarchyPath: '' }],
      });
      assert.match(prompt, /- Root Page\n/);
      assert.doesNotMatch(prompt, /Root Page \(\)/);
    });

    test('retains the disclaimer exactly as before when existingPages is absent', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-72', summary: 'Issue', description: 'Desc' }],
      });
      assert.match(prompt, /Confluence read access is not yet implemented/);
      assert.doesNotMatch(prompt, /current Confluence page tree/);
    });

    test('retains the disclaimer when existingPages is an empty array', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-73', summary: 'Issue', description: 'Desc' }],
        existingPages: [],
      });
      assert.match(prompt, /Confluence read access is not yet implemented/);
    });

    test('works together with epics mode: both the epic rendering and the page list appear', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        epics: [
          {
            epic: { key: 'EAMDM-80', summary: 'Epic', description: 'Epic desc' },
            children: [{ key: 'EAMDM-81', summary: 'Child', description: 'Child desc' }],
          },
        ],
        existingPages: [{ title: 'Auth Guide', hierarchyPath: 'MIDAS > Auth' }],
      });
      assert.match(prompt, /Epics and their closed stories:/);
      assert.match(prompt, /### EAMDM-80: Epic/);
      assert.match(prompt, /current Confluence page tree/);
      assert.match(prompt, /- Auth Guide \(MIDAS > Auth\)/);
      assert.doesNotMatch(prompt, /Confluence read access is not yet implemented/);
    });
  });

  // ── documentationGuidance (#558) ────────────────────────────────────────────
  describe('documentationGuidance', () => {
    test('includes a "Documentation depth guidance" section with the given text when passed', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-90', summary: 'Issue', description: 'Desc' }],
        documentationGuidance: 'Only document user-facing changes. Skip internal refactors.',
      });
      assert.match(prompt, /Documentation depth guidance/);
      assert.match(prompt, /Only document user-facing changes\. Skip internal refactors\./);
      assert.match(prompt, /return an empty JSON array: \[\]/);
    });

    test('is absent from the prompt when not passed', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-91', summary: 'Issue', description: 'Desc' }],
      });
      assert.doesNotMatch(prompt, /Documentation depth guidance/);
    });

    test('is absent when passed as an empty/whitespace-only string', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        issues: [{ key: 'EAMDM-92', summary: 'Issue', description: 'Desc' }],
        documentationGuidance: '   ',
      });
      assert.doesNotMatch(prompt, /Documentation depth guidance/);
    });

    test('composes with epics and existingPages — all three can coexist', () => {
      const prompt = buildConfluenceAnalysisPrompt({
        epics: [
          {
            epic: { key: 'EAMDM-93', summary: 'Epic', description: 'Epic desc' },
            children: [{ key: 'EAMDM-94', summary: 'Child', description: 'Child desc' }],
          },
        ],
        existingPages: [{ title: 'Auth Guide', hierarchyPath: 'MIDAS > Auth' }],
        documentationGuidance: 'Prefer updating existing pages over creating new ones.',
      });
      assert.match(prompt, /Epics and their closed stories:/);
      assert.match(prompt, /### EAMDM-93: Epic/);
      assert.match(prompt, /current Confluence page tree/);
      assert.match(prompt, /- Auth Guide \(MIDAS > Auth\)/);
      assert.match(prompt, /Documentation depth guidance/);
      assert.match(prompt, /Prefer updating existing pages over creating new ones\./);
    });
  });
});

describe('buildSplitStoryPrompt', () => {
  test('embeds all split parameters into the frontmatter template and requirements', () => {
    const prompt = buildSplitStoryPrompt({
      content: 'Original story content',
      count: 3,
      epicId: '2026-01-01-my-epic.md',
      fixVersion: 'PI-2026.1',
      priority: 'High',
      perStorySP: 2,
      sprintList: 'Sprint 1, Sprint 2, Sprint 3',
    });
    assert.match(prompt, /Split into exactly 3 user stories/);
    assert.match(prompt, /Original story content/);
    assert.match(prompt, /Epic_ID: 2026-01-01-my-epic\.md/);
    assert.match(prompt, /Fix_Version: PI-2026\.1/);
    assert.match(prompt, /Priority: High/);
    assert.match(prompt, /Story_Points: 2/);
    assert.match(prompt, /Sprint assignments: Sprint 1, Sprint 2, Sprint 3/);
    assert.match(prompt, /===SPLIT===/);
  });

  test('accepts a string perStorySP value (e.g. "TBD")', () => {
    const prompt = buildSplitStoryPrompt({
      content: 'x',
      count: 2,
      epicId: 'e.md',
      fixVersion: 'TBD',
      priority: 'Medium',
      perStorySP: 'TBD',
      sprintList: 'TBD',
    });
    assert.match(prompt, /Story_Points: TBD/);
  });
});
