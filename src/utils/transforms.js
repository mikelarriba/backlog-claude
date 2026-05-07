// ── Pure transformation utilities ─────────────────────────────────────────────
// Extracted from server.js so they can be unit-tested independently.

function pad(n) {
  return String(n).padStart(2, '0');
}

export function isoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
}

export const WORKFLOW_STATUSES = ['Draft', 'Created in JIRA', 'Archived'];

export function extractTitle(content) {
  // Template placeholder headings ("## Epic Title", "## Story Title", etc.) → grab the next non-empty line
  const m = content.match(/^## \w[\w ]* Title\s*\n+(.+)/m)
    || content.match(/^# (.+)/m)
    || content.match(/^## (.+)/m);
  return m ? m[1].trim() : null;
}

export function extractWorkflowStatus(content) {
  const m = content.match(/^Status:\s*(.+)$/m);
  if (m) {
    const val = m[1].trim();
    return WORKFLOW_STATUSES.includes(val) ? val : 'Draft';
  }
  return 'Draft';
}

export function setFrontmatterField(content, field, value) {
  const re = new RegExp(`^(${field}:\\s*).*$`, 'm');
  if (re.test(content)) return content.replace(re, `$1${value}`);
  return content.replace(/^---\n/, `---\n${field}: ${value}\n`);
}

export function extractFrontmatterField(content, field) {
  const m = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

export function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

export function jiraToMarkdown(jira) {
  if (!jira) return '';
  let text = jira;

  // Code blocks: {code:lang}...{code} and {code}...{code} and {noformat}...{noformat}
  text = text.replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g, (_, code) => `\`\`\`\n${code.trim()}\n\`\`\``);
  text = text.replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, (_, code) => `\`\`\`\n${code.trim()}\n\`\`\``);

  // Lists — JIRA uses # for ordered, - for unordered (already markdown for -)
  // Must run BEFORE heading conversion: h1./h2. etc. are different from list markers (#/##),
  // but after heading conversion they'd both be # lines and the list step would eat headings.
  text = text.replace(/^(#+) (.+)$/gm, (_, hashes, content) => {
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

  // Links: [label|url] → [label](url), [url] → url
  text = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '[$1]($2)');
  text = text.replace(/\[([^\]|]+)\]/g, '$1');

  // Tables: || header || → | header | and | cell | → | cell |
  text = text.replace(/^\|\|(.+)\|\|$/gm, (_, inner) => {
    const cells = inner.split('||').map(c => c.trim());
    const row   = `| ${cells.join(' | ')} |`;
    const sep   = `| ${cells.map(() => '---').join(' | ')} |`;
    return `${row}\n${sep}`;
  });
  // Remaining single-pipe rows are already markdown table rows
  text = text.replace(/^\|(.+)\|$/gm, (_, inner) => {
    const cells = inner.split('|').map(c => c.trim());
    return `| ${cells.join(' | ')} |`;
  });

  // Quote block: {quote}...{quote} → blockquote
  text = text.replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_, body) =>
    body.trim().split('\n').map(l => `> ${l}`).join('\n')
  );

  // Remove unknown remaining JIRA macros like {color:...} {color}, {panel}...{panel}, {expand}...
  text = text.replace(/\{[^}]+\}/g, '');

  return text.trim();
}

export function markdownToJira(md) {
  const blocks = [];
  let text = md.replace(/```[\w]*\n([\s\S]*?)```/gm, (_, code) => {
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

  return text.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => `{code}\n${blocks[i]}{code}`);
}
