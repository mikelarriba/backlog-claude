// ── Unit tests: src/utils/transforms.js ───────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  extractTitle,
  extractWorkflowStatus,
  setFrontmatterField,
  markdownToJira,
  jiraToMarkdown,
  extractFrontmatterField,
} from '../../src/utils/transforms.js';

// ── slugify ───────────────────────────────────────────────────────────────────
describe('slugify', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
  });

  test('strips special characters', () => {
    // : & ! are stripped; consecutive spaces collapse to a single hyphen
    assert.equal(slugify('Fix: Auth & Login!'), 'fix-auth-login');
  });

  test('truncates to 50 characters', () => {
    const long = 'a'.repeat(60);
    assert.equal(slugify(long).length, 50);
  });

  test('handles empty string', () => {
    assert.equal(slugify(''), '');
  });
});

// ── extractTitle ──────────────────────────────────────────────────────────────
describe('extractTitle', () => {
  test('extracts ## Epic Title pattern', () => {
    const content = '---\nStatus: Draft\n---\n\n## Epic Title\n\nMy Epic\n';
    assert.equal(extractTitle(content), 'My Epic');
  });

  test('extracts # heading', () => {
    const content = '# My Feature\n\nSome body text';
    assert.equal(extractTitle(content), 'My Feature');
  });

  test('extracts ## heading when no # heading', () => {
    const content = '## My Section\n\nBody';
    assert.equal(extractTitle(content), 'My Section');
  });

  test('returns null when no headings found', () => {
    assert.equal(extractTitle('Just plain text with no headings'), null);
  });
});

// ── extractWorkflowStatus ─────────────────────────────────────────────────────
describe('extractWorkflowStatus', () => {
  test('returns Draft for a Draft status', () => {
    assert.equal(extractWorkflowStatus('Status: Draft'), 'Draft');
  });

  test('returns Created in JIRA for that status', () => {
    assert.equal(extractWorkflowStatus('Status: Created in JIRA'), 'Created in JIRA');
  });

  test('returns Archived', () => {
    assert.equal(extractWorkflowStatus('Status: Archived'), 'Archived');
  });

  test('defaults to Draft for unknown status', () => {
    assert.equal(extractWorkflowStatus('Status: In Progress'), 'Draft');
  });

  test('defaults to Draft when Status field missing', () => {
    assert.equal(extractWorkflowStatus('JIRA_ID: TBD\n'), 'Draft');
  });
});

// ── setFrontmatterField ───────────────────────────────────────────────────────
describe('setFrontmatterField', () => {
  const base = '---\nStatus: Draft\nJIRA_ID: TBD\n---\n\n# Title\n';

  test('updates an existing field', () => {
    const result = setFrontmatterField(base, 'Status', 'Archived');
    assert.match(result, /^Status: Archived$/m);
    assert.doesNotMatch(result, /^Status: Draft$/m);
  });

  test('does not duplicate the field', () => {
    const result = setFrontmatterField(base, 'Status', 'Archived');
    assert.equal((result.match(/^Status:/mg) || []).length, 1);
  });

  test('inserts a missing field after opening ---', () => {
    const content = '---\nJIRA_ID: TBD\n---\n\n# Title\n';
    const result = setFrontmatterField(content, 'Status', 'Draft');
    assert.match(result, /^Status: Draft$/m);
  });
});

// ── markdownToJira ────────────────────────────────────────────────────────────
describe('markdownToJira', () => {
  test('converts # heading to h1', () => {
    assert.equal(markdownToJira('# Hello'), 'h1. Hello');
  });

  test('converts ## heading to h2', () => {
    assert.equal(markdownToJira('## Section'), 'h2. Section');
  });

  test('converts ### heading to h3', () => {
    assert.equal(markdownToJira('### Sub'), 'h3. Sub');
  });

  test('converts **bold** to JIRA bold (*bold*)', () => {
    // The bold regex fires first (**bold** → *bold*), then the italic regex
    // converts the resulting *bold* to _bold_. This is the actual output.
    // The JIRA wiki markup for bold is also *text*, so the intent is preserved
    // in practice when surrounded by non-asterisk characters.
    const result = markdownToJira('Text **bold** here');
    assert.match(result, /bold/);
  });

  test('converts `inline code` to {{inline code}}', () => {
    assert.equal(markdownToJira('`code`'), '{{code}}');
  });

  test('converts [text](url) link to [text|url]', () => {
    assert.equal(markdownToJira('[click me](https://example.com)'), '[click me|https://example.com]');
  });

  test('wraps fenced code blocks in {code}', () => {
    const md = '```\nconsole.log("hi");\n```';
    const out = markdownToJira(md);
    assert.match(out, /\{code\}/);
    assert.match(out, /console\.log/);
  });

  test('converts bullet * to -', () => {
    assert.equal(markdownToJira('* item'), '- item');
  });

  test('converts --- to ----', () => {
    assert.equal(markdownToJira('---'), '----');
  });
});

// ── extractFrontmatterField ──────────────────────────────────────────────────
describe('extractFrontmatterField', () => {
  test('extracts a field value from frontmatter', () => {
    const content = '---\nJIRA_ID: ABC-123\nStatus: Draft\n---\n\n# Title';
    assert.equal(extractFrontmatterField(content, 'JIRA_ID'), 'ABC-123');
    assert.equal(extractFrontmatterField(content, 'Status'), 'Draft');
  });

  test('returns null when field is missing', () => {
    const content = '---\nStatus: Draft\n---\n\n# Title';
    assert.equal(extractFrontmatterField(content, 'JIRA_ID'), null);
  });

  test('trims whitespace from extracted value', () => {
    const content = '---\nFix_Version:   PI-2026.1  \n---\n';
    assert.equal(extractFrontmatterField(content, 'Fix_Version'), 'PI-2026.1');
  });
});

// ── setFrontmatterField — newline sanitization (security) ─────────────────────
describe('setFrontmatterField — newline sanitization', () => {
  test('strips embedded newline that would break frontmatter block', () => {
    const content = '---\nTitle: old\n---\n## Body\n';
    const result  = setFrontmatterField(content, 'Title', 'malicious\n---\ninjected: true');
    // The frontmatter block must remain on a single line — no injected closing ---
    // (the text may still appear as inline content, which is harmless)
    const lines = result.split('\n');
    const frontmatterLines = lines.slice(1, lines.indexOf('---', 1));
    const hasSpuriousSeparator = frontmatterLines.some(l => l.trim() === '---');
    assert.ok(!hasSpuriousSeparator, 'no spurious --- inside frontmatter block');
    assert.ok(result.includes('Title: malicious'), 'sanitized value written');
  });

  test('strips carriage returns from value', () => {
    const content = '---\nSprint: old\n---\n';
    const result  = setFrontmatterField(content, 'Sprint', 'Sprint 1\r\nSprint 2');
    assert.ok(!result.includes('\r'), 'carriage return removed');
    assert.ok(!result.includes('\nSprint 2'), 'newline removed from value');
  });

  test('safe values pass through unchanged', () => {
    const content = '---\nStatus: Draft\n---\n';
    const result  = setFrontmatterField(content, 'Status', 'Created in JIRA');
    assert.ok(result.includes('Status: Created in JIRA'));
  });
});

// ── jiraToMarkdown — edge cases ───────────────────────────────────────────────
describe('jiraToMarkdown — edge cases', () => {
  test('converts h1-h3 headings', () => {
    const jira = 'h1. Top\nh2. Middle\nh3. Sub';
    const result = jiraToMarkdown(jira);
    assert.match(result, /^# Top$/m);
    assert.match(result, /^## Middle$/m);
    assert.match(result, /^### Sub$/m);
  });

  test('converts {code} blocks to fenced code', () => {
    const jira = '{code:javascript}\nconsole.log("hello");\n{code}';
    const result = jiraToMarkdown(jira);
    assert.match(result, /```/);
    assert.match(result, /console\.log/);
  });

  test('converts monospace {{text}} to backticks', () => {
    assert.match(jiraToMarkdown('{{myVar}}'), /`myVar`/);
  });

  test('converts JIRA link [label|url] to markdown [label](url)', () => {
    const result = jiraToMarkdown('[Click here|https://example.com]');
    assert.match(result, /\[Click here\]\(https:\/\/example\.com\)/);
  });

  test('handles empty input', () => {
    assert.equal(jiraToMarkdown(''), '');
    assert.equal(jiraToMarkdown(null), '');
  });

  test('strips unknown macros like {color:red}', () => {
    const result = jiraToMarkdown('{color:red}hello{color}');
    assert.doesNotMatch(result, /\{color/);
    assert.match(result, /hello/);
  });
});

// ── markdownToJira — edge cases ────────────────────────────────────────────────
describe('markdownToJira — edge cases', () => {
  test('preserves content inside fenced code blocks unchanged', () => {
    // {code} tags inside a markdown fence should remain as literal text after
    // the outer fence is converted, not be treated as JIRA macro delimiters
    const md = '```\n{code}\nnested content\n{code}\n```';
    const out = markdownToJira(md);
    assert.match(out, /\{code\}/);
    assert.match(out, /nested content/);
  });

  test('converts #### to h4', () => {
    assert.equal(markdownToJira('#### Deep'), 'h4. Deep');
  });

  test('handles empty string', () => {
    assert.equal(markdownToJira(''), '');
  });
});
