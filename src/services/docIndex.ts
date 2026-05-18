// ── In-memory document index ──────────────────────────────────────────────────
// Builds a Map<filename, metadata> by scanning all doc dirs once on startup.
// Invalidate individual entries on write; full rebuild after batch operations.
import fs from 'fs';
import path from 'path';
import {
  extractTitle, extractWorkflowStatus,
  extractFrontmatterField,
} from '../utils/transforms.js';
import type { DocEntry, DocIndexInstance, TypeConfig } from '../types.js';

export function createDocIndex({ TYPE_CONFIG }: { TYPE_CONFIG: TypeConfig }): DocIndexInstance {
  const _map = new Map<string, DocEntry>();

  function _buildEntry(docType: string, dir: string, filename: string): DocEntry {
    const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);

    let parentFilename: string | null = null;
    let parentType: string | null = null;
    if (docType === 'epic') {
      const val = extractFrontmatterField(content, 'Feature_ID');
      if (val && val !== 'TBD') { parentFilename = val; parentType = 'feature'; }
    } else if (['story', 'spike', 'bug'].includes(docType)) {
      const val = extractFrontmatterField(content, 'Epic_ID');
      if (val && val !== 'TBD') { parentFilename = val; parentType = 'epic'; }
    }

    const fixVersion   = extractFrontmatterField(content, 'Fix_Version');
    const jiraId       = extractFrontmatterField(content, 'JIRA_ID');
    const jiraUrl      = extractFrontmatterField(content, 'JIRA_URL');
    const storyPoints  = extractFrontmatterField(content, 'Story_Points');
    const sprint       = extractFrontmatterField(content, 'Sprint');
    const priority     = extractFrontmatterField(content, 'Priority') || 'Medium';
    const rankRaw      = extractFrontmatterField(content, 'Rank');
    const blocksRaw    = extractFrontmatterField(content, 'Blocks');
    const blockedByRaw = extractFrontmatterField(content, 'Blocked_By');
    const parallelRaw  = extractFrontmatterField(content, 'Parallel');
    const blocks    = blocksRaw    ? blocksRaw.split(',').map(s => s.trim()).filter(s => s && s !== 'TBD') : [];
    const blockedBy = blockedByRaw ? blockedByRaw.split(',').map(s => s.trim()).filter(s => s && s !== 'TBD') : [];
    const parallel  = parallelRaw  ? parallelRaw.split(',').map(s => s.trim()).filter(s => s && s !== 'TBD') : [];
    const teamRaw       = extractFrontmatterField(content, 'Team');
    const workCatRaw    = extractFrontmatterField(content, 'Work_Category');

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
      rank:           rankRaw && !isNaN(Number(rankRaw)) ? Number(rankRaw) : null,
      priority,
      parentFilename,
      parentType,
      blocks,
      blockedBy,
      parallel,
      team:         teamRaw    && teamRaw    !== 'TBD' ? teamRaw    : null,
      workCategory: workCatRaw && workCatRaw !== 'TBD' ? workCatRaw : null,
      hasDescription: body.length > 30,
    };
  }

  async function build(): Promise<DocIndexInstance> {
    _map.clear();
    // Collect all (docType, dir, filename) tuples first so we can yield evenly
    const entries: Array<{ docType: string; dir: string; f: string }> = [];
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep')) {
        entries.push({ docType, dir, f });
      }
    }
    // Process files and yield to the event loop every 50 entries so the server
    // stays responsive during a full rebuild with large doc sets.
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && i % 50 === 0) await new Promise(r => setImmediate(r));
      const { docType, dir, f } = entries[i];
      try { _map.set(f, _buildEntry(docType, dir, f)); } catch { /* skip unreadable */ }
    }
    return docIndex;
  }

  // Return all entries sorted newest-first (same order as GET /api/docs).
  function getAll(): DocEntry[] {
    return Array.from(_map.values()).sort((a, b) => b.filename.localeCompare(a.filename));
  }

  // O(1) single-entry lookup.
  function get(filename: string): DocEntry | null {
    return _map.get(filename) || null;
  }

  // Rebuild a single entry after a write; remove it after a delete.
  function invalidate(docType: string, filename: string): void {
    const cfg = TYPE_CONFIG[docType];
    if (!cfg) { _map.delete(filename); return; }
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) { _map.delete(filename); return; }
    try { _map.set(filename, _buildEntry(docType, cfg.dir(), filename)); } catch { _map.delete(filename); }
  }

  // Full async rebuild — use after batch operations that touch many files.
  async function invalidateAll(): Promise<void> {
    await build();
  }

  // O(1) replacement for the O(n) findLocalFileByJiraId disk scan.
  function findByJiraId(jiraId: string): { docType: string; filename: string } | null {
    if (!jiraId || jiraId === 'TBD') return null;
    for (const entry of _map.values()) {
      if (entry.jiraId === jiraId) return { docType: entry.docType, filename: entry.filename };
    }
    return null;
  }

  const docIndex: DocIndexInstance = { build, getAll, get, invalidate, invalidateAll, findByJiraId };
  return docIndex;
}
