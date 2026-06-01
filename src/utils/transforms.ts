// ── Pure transformation utilities ─────────────────────────────────────────────
// Extracted from server.js so they can be unit-tested independently.
import { patchFrontmatter, dropFrontmatterField, readFrontmatterField } from './frontmatter.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
}

export const WORKFLOW_STATUSES: string[] = ['Draft', 'Created in JIRA', 'Archived'];

export function extractTitle(content: string): string | null {
  // Template placeholder headings ("## Epic Title", "## Story Title", etc.) -> grab the next non-empty line
  // Check ## before # — documents use ## for the title; # may appear inside JIRA descriptions
  const m = content.match(/^## \w[\w ]* Title\s*\n+(.+)/m)
    || content.match(/^## (.+)/m)
    || content.match(/^# (.+)/m);
  return m ? m[1].trim() : null;
}

export function extractWorkflowStatus(content: string): string {
  const m = content.match(/^Status:\s*(.+)$/m);
  if (m) {
    const val = m[1].trim();
    return WORKFLOW_STATUSES.includes(val) ? val : 'Draft';
  }
  return 'Draft';
}

export function setFrontmatterField(content: string, field: string, value: string | number): string {
  return patchFrontmatter(content, field, value);
}

export function removeFrontmatterField(content: string, field: string): string {
  return dropFrontmatterField(content, field);
}

export function extractFrontmatterField(content: string, field: string): string | null {
  return readFrontmatterField(content, field);
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

export function jiraToMarkdown(jira: string): string {
  if (!jira) return '';
  let text = jira;

  // Code blocks: {code:lang}...{code} and {code}...{code} and {noformat}...{noformat}
  text = text.replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g, (_, code: string) => `\`\`\`\n${code.trim()}\n\`\`\``);
  text = text.replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, (_, code: string) => `\`\`\`\n${code.trim()}\n\`\`\``);

  // Lists — JIRA uses # for ordered, - for unordered (already markdown for -)
  // Must run BEFORE heading conversion: h1./h2. etc. are different from list markers (#/##),
  // but after heading conversion they'd both be # lines and the list step would eat headings.
  text = text.replace(/^(#+) (.+)$/gm, (_, hashes: string, content: string) => {
    const depth = hashes.length;
    return `${'   '.repeat(depth - 1)}1. ${content}`;
  });

  // Headings
  text = text.replace(/^h1\. (.+)$/gm, '# $1');
  text = text.replace(/^h2\. (.+)$/gm, '## $1');
  text = text.replace(/^h3\. (.+)$/gm, '### $1');
  text = text.replace(/^h4\. (.+)$/gm, '#### $1');
  text = text.replace(/^h5\. (.+)$/gm, '##### $1');
  text = text.replace(/^h6\. (.+)$/gm, '###### $1');

  // Bold: *text* → **text** (must not convert italic _ already done)
  text = text.replace(/\*([^*\n]+)\*/g, '**$1**');

  // Italic: _text_ stays as _text_ in markdown
  // Monospace: {{text}} → `text`
  text = text.replace(/\{\{([^}]+)\}\}/g, '`$1`');

  // Strikethrough: -text- → ~~text~~ (only when surrounded by spaces or line boundaries)
  text = text.replace(/(^|\s)-([^-\n]+)-(\s|$)/g, '$1~~$2~~$3');

  // Horizontal rule
  text = text.replace(/^----$/gm, '---');

  // Links: [label|url] → [label](url), bare [url] → url
  // Negative lookahead (?!\() prevents stripping brackets from already-converted [label](url)
  text = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '[$1]($2)');
  text = text.replace(/\[([^\]|]+)\](?!\()/g, '$1');

  // Tables: || header || → | header | and | cell | → | cell |
  text = text.replace(/^\|\|(.+)\|\|$/gm, (_, inner: string) => {
    const cells = inner.split('||').map(c => c.trim());
    const row   = `| ${cells.join(' | ')} |`;
    const sep   = `| ${cells.map(() => '---').join(' | ')} |`;
    return `${row}\n${sep}`;
  });
  // Remaining single-pipe rows are already markdown table rows
  text = text.replace(/^\|(.+)\|$/gm, (_, inner: string) => {
    const cells = inner.split('|').map(c => c.trim());
    return `| ${cells.join(' | ')} |`;
  });

  // Quote block: {quote}...{quote} → blockquote
  text = text.replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_, body: string) =>
    body.trim().split('\n').map(l => `> ${l}`).join('\n')
  );

  // Remove unknown remaining JIRA macros like {color:...} {color}, {panel}...{panel}, {expand}...
  text = text.replace(/\{[^}]+\}/g, '');

  return text.trim();
}

export function markdownToJira(md: string): string {
  const blocks: string[] = [];
  let text = md.replace(/```[\w]*\n([\s\S]*?)```/gm, (_, code: string) => {
    blocks.push(code);
    return `\x00CODEBLOCK${blocks.length - 1}\x00`;
  });

  text = text
    .replace(/^#### (.+)$/gm, 'h4. $1')
    .replace(/^### (.+)$/gm,  'h3. $1')
    .replace(/^## (.+)$/gm,   'h2. $1')
    .replace(/^# (.+)$/gm,    'h1. $1')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '_$1_')
    .replace(/^\* (.+)$/gm, '- $1')
    .replace(/`([^`]+)`/g, '{{$1}}')
    .replace(/^---+$/gm, '----')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');

  return text.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i: string) => `{code}\n${blocks[Number(i)]}{code}`);
}
