// ── Pure transformation utilities ─────────────────────────────────────────────
// Extracted from server.js so they can be unit-tested independently.

export function pad(n) {
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
  const m = content.match(/^## Epic Title\s*\n+(.+)/m)
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
