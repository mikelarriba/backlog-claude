export function parseStorySections(content) {
  const fmMatch = content.match(/^---[\s\S]*?---\n?/);
  const frontmatter = fmMatch ? fmMatch[0] : '';
  const body = content.slice(frontmatter.length).trim();
  const sections = body.split(/(?=^## Story \d+[:\s])/m).map(s => s.trim()).filter(Boolean);
  return { frontmatter, sections };
}

export function serializeStoryFile(frontmatter, sections) {
  return `${frontmatter}\n${sections.join('\n\n')}\n`;
}

export function extractStoryTitle(section) {
  const m = section.match(/^## (.+)$/m);
  return m ? m[1].trim() : 'Untitled Story';
}
