// ── Export layout: pure data/layout algorithms (no Express/HTTP dependency) ──
// Extracted from routes/export.ts (#341) so these are unit-testable in isolation
// from the route handlers. Anything here must stay pure: no `req`/`res`, no fs.
import type { DocEntry } from '../types.js';

// ── Shared constants ──────────────────────────────────────────────────────────

export const TYPE_LABEL: Record<string, string> = {
  feature: 'Feature',
  epic: 'Epic',
  story: 'Story',
  spike: 'Spike',
  bug: 'Bug',
};

export const BADGE_COLOR: Record<string, string> = {
  epic: '#0066cc',
  feature: '#8b5cf6',
  story: '#2563eb',
  spike: '#b45309',
  bug: '#dc2626',
};

export const CATEGORY_COLORS: Record<string, string> = {
  'User Features': '#16a34a',
  'Platform Features': '#0891b2',
  'Testing Features': '#d97706',
  'Platform Maintenance': '#64748b',
  'Technical Debt': '#dc2626',
};
export const CATEGORY_FALLBACK = '#94a3b8';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, '');
}

export function epicColor(workCategory: string | null | undefined): string {
  return CATEGORY_COLORS[workCategory || ''] || CATEGORY_FALLBACK;
}

// ── Dependency-aware sort (used before rendering issue lists) ─────────────────

export function topoSortCards(docs: DocEntry[]): DocEntry[] {
  const PRIO_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...docs].sort((a, b) => {
    const ra = a.rank ?? 9999;
    const rb = b.rank ?? 9999;
    if (ra !== rb) return ra - rb;
    const pa = PRIO_ORDER[(a.priority || 'medium').toLowerCase()] ?? 2;
    const pb = PRIO_ORDER[(b.priority || 'medium').toLowerCase()] ?? 2;
    return pa - pb;
  });

  const filenameSet = new Set(docs.map((d) => d.filename));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const blockers = (sorted[i].blockedBy || []).filter((f) => filenameSet.has(f));
      for (const bf of blockers) {
        const bi = sorted.findIndex((d) => d.filename === bf);
        if (bi > i) {
          const [item] = sorted.splice(i, 1);
          sorted.splice(bi, 0, item);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return sorted;
}

// ── Auto-layout for the visual dependency grid ────────────────────────────────

export function computeAutoLayout(
  children: Array<{ filename: string }>,
  blocks: Array<{ src: string; tgt: string }>
): Record<string, { col: number; row: number }> {
  const layout: Record<string, { col: number; row: number }> = {};
  if (!children.length) return layout;

  const blockedByMap = new Map<string, string[]>();
  for (const { src, tgt } of blocks) {
    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt)!.push(src);
  }

  const rowMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const child of children) {
    if (!(blockedByMap.get(child.filename) || []).length) {
      rowMap.set(child.filename, 0);
      visited.add(child.filename);
      queue.push(child.filename);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const fn = queue[head++];
    const currentRow = rowMap.get(fn) || 0;
    for (const { src, tgt } of blocks) {
      if (src !== fn) continue;
      const newRow = Math.max(rowMap.get(tgt) || 0, currentRow + 1);
      rowMap.set(tgt, newRow);
      if (!visited.has(tgt)) {
        visited.add(tgt);
        queue.push(tgt);
      }
    }
  }
  for (const child of children) {
    if (!rowMap.has(child.filename)) rowMap.set(child.filename, 0);
  }

  const colSets = new Map<string, string>();
  for (const child of children) colSets.set(child.filename, child.filename);

  function findRoot(fn: string): string {
    if (colSets.get(fn) === fn) return fn;
    const root = findRoot(colSets.get(fn)!);
    colSets.set(fn, root);
    return root;
  }
  function union(a: string, b: string) {
    const ra = findRoot(a),
      rb = findRoot(b);
    if (ra !== rb) colSets.set(ra, rb);
  }
  for (const { src, tgt } of blocks) union(src, tgt);

  const componentCol = new Map<string, number>();
  let nextCol = 0;
  const sortedByRow = [...children].sort(
    (a, b) => (rowMap.get(a.filename) || 0) - (rowMap.get(b.filename) || 0)
  );
  for (const child of sortedByRow) {
    const root = findRoot(child.filename);
    if (!componentCol.has(root)) componentCol.set(root, nextCol++);
  }

  for (const child of children) {
    const col = componentCol.get(findRoot(child.filename)) ?? 0;
    const row = rowMap.get(child.filename) ?? 0;
    layout[child.filename] = { col, row };
  }
  return layout;
}

// ── Doc export data shapes ────────────────────────────────────────────────────

export interface ChildData {
  filename: string;
  docType: string;
  title: string;
  storyPoints: number | null;
  priority: string;
  status: string;
  jiraId: string | null;
  jiraUrl: string | null;
  content: string;
}

// ── Visual dependency grid (SVG + positioned cards) ───────────────────────────

export function renderGrid(
  childData: ChildData[],
  layout: Record<string, { col: number; row: number }>,
  blocks: Array<{ src: string; tgt: string }>,
  parallel: Array<{ a: string; b: string }>,
  epicTitle: string,
  docType: string
): string {
  if (!childData.length) return '';

  const CELL_W = 160,
    CELL_H = 72,
    GUTTER_X = 18,
    GUTTER_Y = 28,
    TOP_OFFSET = 60;

  const positions: Record<string, { col: number; row: number }> = {};
  for (const child of childData) {
    positions[child.filename] = layout[child.filename] || { col: 0, row: 0 };
  }

  const usedCols = [...new Set(Object.values(positions).map((p) => p.col))].sort((a, b) => a - b);
  const usedRows = [...new Set(Object.values(positions).map((p) => p.row))].sort((a, b) => a - b);
  const colRemap = new Map(usedCols.map((c, i) => [c, i]));
  const rowRemap = new Map(usedRows.map((r, i) => [r, i]));
  for (const fn of Object.keys(positions)) {
    positions[fn] = {
      col: colRemap.get(positions[fn].col) ?? 0,
      row: rowRemap.get(positions[fn].row) ?? 0,
    };
  }

  const cols = usedCols.length || 1;
  const rows = usedRows.length || 1;
  const totalW = GUTTER_X + cols * (CELL_W + GUTTER_X);
  const totalH = TOP_OFFSET + rows * (CELL_H + GUTTER_Y) + GUTTER_Y;

  const cellAt = (col: number, row: number) => ({
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: TOP_OFFSET + row * (CELL_H + GUTTER_Y),
  });

  const cardPos: Record<string, { cx: number; cy: number; x: number; y: number }> = {};
  for (const child of childData) {
    const { col, row } = positions[child.filename];
    const { x, y } = cellAt(col, row);
    cardPos[child.filename] = { cx: x + CELL_W / 2, cy: y + CELL_H / 2, x, y };
  }

  const epicCol = BADGE_COLOR[docType] || '#666';

  let svgContent = `<defs>
    <marker id="pdf-arr-sec" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8"/>
    </marker>
    <marker id="pdf-arr-blk" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#ef4444"/>
    </marker>
  </defs>`;

  for (let col = 1; col < cols; col++) {
    const x = GUTTER_X + col * (CELL_W + GUTTER_X) - GUTTER_X / 2;
    svgContent += `<line x1="${x}" y1="${TOP_OFFSET}" x2="${x}" y2="${totalH - GUTTER_Y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 3"/>`;
  }

  const byCols: Record<number, Array<{ fn: string; row: number }>> = {};
  for (const [fn, pos] of Object.entries(positions)) {
    if (!byCols[pos.col]) byCols[pos.col] = [];
    byCols[pos.col].push({ fn, row: pos.row });
  }
  for (const colItems of Object.values(byCols)) {
    colItems.sort((a, b) => a.row - b.row);
    for (let i = 0; i < colItems.length - 1; i++) {
      const hasExplicitBlock = blocks.some(
        (b) =>
          (b.src === colItems[i].fn && b.tgt === colItems[i + 1].fn) ||
          (b.src === colItems[i + 1].fn && b.tgt === colItems[i].fn)
      );
      if (hasExplicitBlock) continue;
      const s = cardPos[colItems[i].fn],
        t = cardPos[colItems[i + 1].fn];
      if (!s || !t) continue;
      const x1 = s.cx,
        y1 = s.y + CELL_H,
        x2 = t.cx,
        y2 = t.y;
      svgContent += `<path d="M${x1},${y1} C${x1},${y1 + 10} ${x2},${y2 - 10} ${x2},${y2}" stroke="#94a3b8" stroke-width="1.5" fill="none" marker-end="url(#pdf-arr-sec)"/>`;
      svgContent += `<text x="${x1 + 4}" y="${y1 + (y2 - y1) / 2}" class="pdf-edge-label">SEC</text>`;
    }
  }

  for (const { src, tgt } of blocks) {
    const s = cardPos[src],
      t = cardPos[tgt];
    if (!s || !t) continue;
    const x1 = s.cx,
      y1 = s.y + CELL_H,
      x2 = t.cx,
      y2 = t.y;
    svgContent += `<path d="M${x1},${y1} C${x1},${y1 + 12} ${x2},${y2 - 12} ${x2},${y2}" stroke="#ef4444" stroke-width="2" fill="none" marker-end="url(#pdf-arr-blk)"/>`;
    svgContent += `<text x="${(x1 + x2) / 2 + 4}" y="${y1 + (y2 - y1) / 2}" class="pdf-edge-label pdf-edge-label-blocks">BLOCKS</text>`;
  }

  for (const { a, b } of parallel) {
    const pa = cardPos[a],
      pb = cardPos[b];
    if (!pa || !pb) continue;
    const x1 = pa.x,
      x2 = pb.x + CELL_W;
    const y = Math.min(pa.y, pb.y) - 10;
    const d = `M${x1},${pa.y - 3} V${y} H${x2} V${pb.y - 3}`;
    svgContent += `<path d="${d}" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5 3" fill="none"/>`;
    svgContent += `<text x="${(x1 + x2) / 2}" y="${y - 3}" text-anchor="middle" class="pdf-edge-label pdf-edge-label-parallel">PARALLEL</text>`;
  }

  let cellsHtml = '';
  for (const child of childData) {
    const { x, y } = cellAt(positions[child.filename].col, positions[child.filename].row);
    cellsHtml += `<div class="grid-cell" style="left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px;"></div>`;
  }

  let cardsHtml = '';
  const INSET = 3;
  for (const child of childData) {
    const { x, y } = cellAt(positions[child.filename].col, positions[child.filename].row);
    const bc = BADGE_COLOR[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const gridJiraLink = child.jiraId
      ? `<a href="${esc(child.jiraUrl || '#')}" style="font-size:7px;color:#0066cc;font-weight:700;">${esc(child.jiraId)}</a>`
      : '';
    cardsHtml += `<div class="grid-card" style="left:${x + INSET}px;top:${y + INSET}px;width:${CELL_W - INSET * 2}px;height:${CELL_H - INSET * 2}px;">
      <div class="grid-card-title">
        <span class="grid-card-type" style="background:${bc}">${esc(TYPE_LABEL[child.docType] || child.docType)}</span>
        ${esc(child.title)}
      </div>
      ${sp || gridJiraLink ? `<div class="grid-card-sp">${sp}${sp && gridJiraLink ? ' &middot; ' : ''}${gridJiraLink}</div>` : ''}
    </div>`;
  }

  const nodeW = Math.min(200, totalW - 20);
  const nodeX = (totalW - nodeW) / 2;
  const epicNodeHtml = `<div class="grid-epic-node" style="left:${nodeX}px;top:8px;width:${nodeW}px;border-color:${epicCol};color:${epicCol};">
    <span style="font-size:7px;text-transform:uppercase;letter-spacing:0.05em;">${esc(TYPE_LABEL[docType] || docType)}</span>
    <div>${esc(epicTitle)}</div>
  </div>`;

  return `<div class="sec-title">Visual Plan</div>
<div class="grid-wrap" style="width:${totalW}px;height:${totalH}px;">
  <svg class="grid-svg" width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>
  ${epicNodeHtml}
  ${cellsHtml}
  ${cardsHtml}
</div>`;
}

// ── Roadmap export data shapes ────────────────────────────────────────────────

export interface SprintEntry {
  name: string;
  capacity?: number;
}

export interface EpicMapEntry {
  epicDoc: DocEntry | null;
  sprints: Set<string>;
  storyCount: number;
  totalSP: number;
}
