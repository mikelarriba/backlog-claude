// ── Safe YAML frontmatter helpers ────────────────────────────────────────────
// Uses js-yaml to parse (safe, handles all YAML quirks) but writes individual
// field updates line-by-line so values are not re-quoted by the serializer.
import jsYaml from 'js-yaml';

const FENCE = '---';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split document into parsed metadata and body text. */
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const lines = content.split('\n');
  if (lines[0].trimEnd() !== FENCE) return { meta: {}, body: content };

  const closeIdx = lines.indexOf(FENCE, 1);
  if (closeIdx === -1) return { meta: {}, body: content };

  const yamlBlock = lines.slice(1, closeIdx).join('\n');
  const body = lines.slice(closeIdx + 1).join('\n');

  let parsed: unknown;
  try {
    parsed = jsYaml.load(yamlBlock);
  } catch (_err) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, string> = {};
  if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      meta[k] = v === null || v === undefined ? '' : String(v);
    }
  }
  return { meta, body };
}

/**
 * Set (or insert) a single frontmatter field.
 * Uses line-by-line manipulation so the output is plain `field: value` without
 * yaml quoting, which matches the existing format expected by callers.
 * Sanitises the value by stripping newlines to prevent block injection.
 */
export function patchFrontmatter(content: string, field: string, value: string | number): string {
  const safeValue = String(value).replace(/[\r\n]/g, ' ').trim();

  const lines = content.split('\n');
  if (lines[0].trimEnd() !== FENCE) {
    return `${FENCE}\n${field}: ${safeValue}\n${FENCE}\n${content}`;
  }

  const closeIdx = lines.indexOf(FENCE, 1);
  if (closeIdx === -1) {
    lines.splice(1, 0, `${field}: ${safeValue}`);
    return lines.join('\n');
  }

  const fieldRe = new RegExp(`^${escapeRegex(field)}:\\s*`);
  for (let i = 1; i < closeIdx; i++) {
    if (fieldRe.test(lines[i])) {
      lines[i] = `${field}: ${safeValue}`;
      return lines.join('\n');
    }
  }

  // Field not present — insert right after the opening fence
  lines.splice(1, 0, `${field}: ${safeValue}`);
  return lines.join('\n');
}

/** Remove a single frontmatter field, preserving all others. */
export function dropFrontmatterField(content: string, field: string): string {
  const lines = content.split('\n');
  if (lines[0].trimEnd() !== FENCE) return content;

  const closeIdx = lines.indexOf(FENCE, 1);
  if (closeIdx === -1) return content;

  const fieldRe = new RegExp(`^${escapeRegex(field)}:\\s*`);
  const relIdx = lines.slice(1, closeIdx).findIndex(l => fieldRe.test(l));
  if (relIdx === -1) return content;

  lines.splice(1 + relIdx, 1);
  return lines.join('\n');
}

/** Read a single frontmatter field using the js-yaml parser. */
export function readFrontmatterField(content: string, field: string): string | null {
  const { meta } = parseFrontmatter(content);
  return field in meta ? (meta[field] ?? null) : null;
}
