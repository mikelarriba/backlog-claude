// ── In-memory document index ──────────────────────────────────────────────────
// Builds a Map<filename, metadata> by scanning all doc dirs once on startup.
// Invalidate individual entries on write; full rebuild after batch operations.
import fs from 'fs';
import path from 'path';
import {
  extractTitle, extractWorkflowStatus,
  extractFrontmatterField,
} from '../utils/transforms.js';

export function createDocIndex({ TYPE_CONFIG }) {
  const _map = new Map(); // Map<filename, entry>

  function _buildEntry(docType, dir, filename) {
    const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);

    let parentFilename = null;
    let parentType     = null;
    if (docType === 'epic') {
      const val = extractFrontmatterField(content, 'Feature_ID');
      if (val && val !== 'TBD') { parentFilename = val; parentType = 'feature'; }
    } else if (['story', 'spike', 'bug'].includes(docType)) {
      const val = extractFrontmatterField(content, 'Epic_ID');
      if (val && val !== 'TBD') { parentFilename = val; parentType = 'epic'; }
    }

    const fixVersion  = extractFrontmatterField(content, 'Fix_Version');
    const jiraId      = extractFrontmatterField(content, 'JIRA_ID');
    const jiraUrl     = extractFrontmatterField(content, 'JIRA_URL');
    const storyPoints = extractFrontmatterField(content, 'Story_Points');
    const sprint      = extractFrontmatterField(content, 'Sprint');
    const priority    = extractFrontmatterField(content, 'Priority') || 'Medium';

    let body = content;
    if (body.startsWith('---')) {
      const end = body.indexOf('\n---', 3);
      if (end > -1) body = body.slice(end + 4);
    }
    body = body.replace(/^#{1,2}\s+.+$/m, '').trim();
    body = body.replace(/_No description in JIRA\._/gi, '').replace(/\bTBD\b/g, '').trim();

    return {
      filename,
      docType,
      title:          extractTitle(content) || filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''),
      date:           dateMatch ? dateMatch[1] : '',
      status:         extractWorkflowStatus(content),
      fixVersion:     fixVersion  && fixVersion  !== 'TBD' ? fixVersion  : null,
      jiraId:         jiraId      && jiraId      !== 'TBD' ? jiraId      : null,
      jiraUrl:        jiraUrl     || null,
      storyPoints:    storyPoints && storyPoints !== 'TBD' ? Number(storyPoints) || null : null,
      sprint:         sprint      && sprint      !== 'TBD' ? sprint      : null,
      priority,
      parentFilename,
      parentType,
      hasDescription: body.length > 30,
    };
  }

  function build() {
    _map.clear();
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep')) {
        try { _map.set(f, _buildEntry(docType, dir, f)); } catch { /* skip unreadable */ }
      }
    }
    return docIndex;
  }

  // Return all entries sorted newest-first (same order as GET /api/docs).
  function getAll() {
    return Array.from(_map.values()).sort((a, b) => b.filename.localeCompare(a.filename));
  }

  // O(1) single-entry lookup.
  function get(filename) {
    return _map.get(filename) || null;
  }

  // Rebuild a single entry after a write; remove it after a delete.
  function invalidate(docType, filename) {
    const cfg = TYPE_CONFIG[docType];
    if (!cfg) { _map.delete(filename); return; }
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) { _map.delete(filename); return; }
    try { _map.set(filename, _buildEntry(docType, cfg.dir(), filename)); } catch { _map.delete(filename); }
  }

  // Full rebuild — use after batch operations that touch many files.
  function invalidateAll() {
    build();
  }

  // O(1) replacement for the O(n) findLocalFileByJiraId disk scan.
  function findByJiraId(jiraId) {
    if (!jiraId || jiraId === 'TBD') return null;
    for (const entry of _map.values()) {
      if (entry.jiraId === jiraId) return { docType: entry.docType, filename: entry.filename };
    }
    return null;
  }

  const docIndex = { build, getAll, get, invalidate, invalidateAll, findByJiraId };
  return docIndex;
}
