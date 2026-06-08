// ── Epic PDF Export ─────────────────────────────────────────────
import { escHtml, showJiraToast, stripFrontmatter, TYPE_LABEL } from './state.js';
import { getAllSprints } from './roadmap.js';
import { topoSortCards, epicColor } from './roadmap-render.js';
import { computeAutoLayout } from './refine-canvas.js';
// Opens a print-ready page in a new tab with:
//   1. Epic header (title, total SP, status)
//   2. Visual plan grid (swimlane layout matching the canvas)
//   3. Description (rendered markdown)
//   4. Story list with details
// The user can then Cmd+P / Ctrl+P → "Save as PDF".

export async function exportEpicToPdf(filename, docType) {
  docType = docType || 'epic';
  showJiraToast('info', 'Preparing export...');

  try {
    // ── 1. Fetch epic content ──────────────────────────────────
    const epicRes = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!epicRes.ok) throw new Error('Could not load epic');
    const { content: epicContent } = await epicRes.json();
    const epicDoc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    const epicTitle = epicDoc?.title || filename;

    // ── 2. Fetch children + links ──────────────────────────────
    const linksRes = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    const linksData = linksRes.ok ? await linksRes.json() : {};
    const children = linksData.children || [];

    // ── 3. Fetch each child's content ──────────────────────────
    const childData = await Promise.all(
      children.map(async (c) => {
        const doc = allDocs.find((d) => d.filename === c.filename);
        let content = '';
        try {
          const res = await fetch(`/api/doc/${c.docType}/${encodeURIComponent(c.filename)}`);
          if (res.ok) content = (await res.json()).content || '';
        } catch {
          /* no-op */
        }
        return {
          filename: c.filename,
          docType: c.docType,
          title: doc?.title || c.title || c.filename,
          storyPoints: doc?.storyPoints || null,
          priority: doc?.priority || 'Medium',
          status: doc?.status || 'Draft',
          jiraId: doc?.jiraId || null,
          jiraUrl: doc?.jiraUrl || null,
          content,
        };
      })
    );

    // ── 4. Compute layout for visual plan ──────────────────────
    const childFilenames = new Set(children.map((c) => c.filename));
    const blocks = [];
    const parallel = [];
    const seenParallel = new Set();
    for (const child of children) {
      const doc = allDocs.find((d) => d.filename === child.filename);
      if (!doc) continue;
      for (const fn of doc.blocks || []) {
        if (childFilenames.has(fn)) blocks.push({ src: child.filename, tgt: fn });
      }
      for (const fn of doc.parallel || []) {
        if (childFilenames.has(fn)) {
          const key = [child.filename, fn].sort().join('|');
          if (!seenParallel.has(key)) {
            seenParallel.add(key);
            parallel.push({ a: child.filename, b: fn });
          }
        }
      }
    }

    let layout = {};
    try {
      const res = await fetch(`/api/canvas/layout/${encodeURIComponent(filename)}`);
      if (res.ok) layout = await res.json();
    } catch {
      /* no-op */
    }
    if (!Object.keys(layout).length && children.length) {
      layout = computeAutoLayout(children, blocks, parallel);
    }

    const totalSP = childData.reduce((sum, c) => sum + (c.storyPoints || 0), 0);

    // ── 5. Build full HTML page ────────────────────────────────
    const html = _buildPrintPage(
      epicTitle,
      docType,
      totalSP,
      epicDoc,
      epicContent,
      childData,
      layout,
      blocks,
      parallel
    );

    // ── 6. Open in new tab → auto-print ────────────────────────
    const win = window.open('', '_blank');
    if (!win) {
      showJiraToast('error', 'Pop-up blocked — please allow pop-ups for this site');
      return;
    }
    win.document.write(html);
    win.document.close();

    showJiraToast('ok', 'Export ready — use Save as PDF in the print dialog');
  } catch (e) {
    showJiraToast('error', `Export failed: ${e.message}`);
  }
}

// ── Full HTML page builder ─────────────────────────────────────

function _buildPrintPage(
  epicTitle,
  docType,
  totalSP,
  epicDoc,
  epicContent,
  childData,
  layout,
  blocks,
  parallel
) {
  const status = epicDoc?.status || 'Draft';
  const priority = epicDoc?.priority || '';
  const count = childData.length;
  const descHtml = _renderDesc(epicContent);
  const gridHtml = _renderGrid(childData, layout, blocks, parallel || [], epicTitle, docType);
  const listHtml = _renderStoryCards(childData);
  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const badgeColor = {
    epic: '#0066cc',
    feature: '#8b5cf6',
    story: '#2563eb',
    spike: '#b45309',
    bug: '#dc2626',
  };
  const bc = badgeColor[docType] || '#666';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${_esc(epicTitle)}</title>
<style>
  /* ── Reset & base ─────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a2e; font-size: 11px; line-height: 1.55;
    padding: 32px 36px; max-width: 780px; margin: 0 auto;
  }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
    .story-card { page-break-inside: avoid; }
  }

  /* ── Print banner ─────────────────────────────────────── */
  .print-banner {
    background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;
    padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: #0369a1;
    display: flex; align-items: center; gap: 10px;
  }
  .print-banner button {
    background: #0284c7; color: #fff; border: none; border-radius: 6px;
    padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .print-banner button:hover { background: #0369a1; }

  /* ── Header ───────────────────────────────────────────── */
  .hdr-badge {
    display: inline-block; padding: 3px 10px; border-radius: 5px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: #fff; background: ${bc}; vertical-align: middle; margin-right: 6px;
  }
  .hdr-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; line-height: 1.3; }
  .hdr-meta  { font-size: 11px; color: #64748b; margin-bottom: 20px; }
  .hdr-meta b { color: #334155; }

  /* ── Section titles ───────────────────────────────────── */
  .sec-title {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #64748b; margin: 24px 0 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;
  }

  /* ── Grid (visual plan) ───────────────────────────────── */
  .grid-wrap { position: relative; overflow: hidden; margin-bottom: 8px; }
  .grid-epic-node {
    position: absolute; text-align: center;
    background: #fff; border: 2px solid; border-radius: 6px;
    padding: 4px 8px; font-size: 9px; font-weight: 700;
    box-sizing: border-box; line-height: 1.3;
  }
  .grid-cell {
    position: absolute; border: 1.5px dashed #cbd5e1;
    border-radius: 7px; box-sizing: border-box;
  }
  .grid-card {
    position: absolute; background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 6px; padding: 6px 8px; box-sizing: border-box; overflow: hidden;
  }
  .grid-card-type {
    display: inline-block; padding: 1px 5px; border-radius: 3px;
    font-size: 7px; font-weight: 700; text-transform: uppercase;
    color: #fff; margin-right: 4px; vertical-align: middle;
  }
  .grid-card-title { font-size: 9px; font-weight: 600; line-height: 1.35; }
  .grid-card-sp { font-size: 8px; color: #64748b; margin-top: 3px; }
  .grid-svg { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
  .pdf-edge-label { font-size: 7px; fill: #94a3b8; font-family: sans-serif; }
  .pdf-edge-label-blocks { fill: #ef4444; font-weight: 700; }
  .pdf-edge-label-parallel { fill: #3b82f6; font-weight: 700; }

  /* ── Description ──────────────────────────────────────── */
  .desc { font-size: 11px; line-height: 1.65; }
  .desc h1 { font-size: 16px; margin: 14px 0 6px; }
  .desc h2 { font-size: 14px; margin: 12px 0 5px; }
  .desc h3 { font-size: 12px; margin: 10px 0 4px; }
  .desc ul, .desc ol { padding-left: 20px; margin: 5px 0; }
  .desc li { margin: 2px 0; }
  .desc p { margin: 5px 0; }
  .desc code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
  .desc pre { background: #f1f5f9; padding: 10px; border-radius: 6px; font-size: 9px; overflow-x: auto; }
  .desc table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  .desc th, .desc td { border: 1px solid #e2e8f0; padding: 4px 8px; font-size: 10px; text-align: left; }
  .desc th { background: #f8fafc; font-weight: 600; }

  /* ── Story cards ──────────────────────────────────────── */
  .story-card {
    border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 12px 14px; margin-bottom: 12px;
  }
  .story-card-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .story-card-title { font-size: 13px; font-weight: 600; }
  .story-card-sp {
    font-size: 10px; font-weight: 700; color: #64748b;
    background: #f1f5f9; padding: 2px 7px; border-radius: 4px; white-space: nowrap;
  }
  .story-card-body { font-size: 10px; line-height: 1.55; color: #334155; }
  .story-card-body h1, .story-card-body h2, .story-card-body h3 { font-size: 11px; margin: 8px 0 4px; }
  .story-card-body ul, .story-card-body ol { padding-left: 18px; margin: 4px 0; }
  .story-card-body li { margin: 2px 0; }
  .story-card-body p { margin: 4px 0; }
  .story-card-body pre { font-size: 9px; }
  .story-card-body table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  .story-card-body th, .story-card-body td { border: 1px solid #e2e8f0; padding: 3px 6px; font-size: 9px; }

  /* ── Footer ───────────────────────────────────────────── */
  .footer {
    margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; text-align: right;
  }
</style>
</head>
<body>

<div class="no-print print-banner">
  <span>Your export is ready.</span>
  <button onclick="window.print()">Save as PDF</button>
  <span style="color:#64748b">or press Cmd+P / Ctrl+P</span>
</div>

<div class="hdr-title">
  <span class="hdr-badge">${_esc(TYPE_LABEL[docType] || docType)}</span>
  ${_esc(epicTitle)}
</div>
<div class="hdr-meta">
  ${totalSP ? `<b>${totalSP}</b> Story Points &middot; ` : ''}
  <b>${count}</b> item${count !== 1 ? 's' : ''}
  ${priority ? ` &middot; Priority: <b>${priority}</b>` : ''}
  &middot; Status: <b>${status}</b>
  ${epicDoc?.jiraId ? ` &middot; JIRA: <a href="${_esc(epicDoc.jiraUrl || '#')}" style="color:#0066cc;font-weight:700;">${_esc(epicDoc.jiraId)}</a>` : ''}
</div>

${gridHtml}
${descHtml}
${listHtml}

<div class="footer">Exported on ${dateStr} &middot; MIDAS Backlog</div>

<script>
  // Auto-trigger print after a short delay for rendering
  setTimeout(() => window.print(), 400);
</script>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────

function _esc(s) {
  return escHtml(s);
}

function _renderDesc(epicContent) {
  const stripped = stripFrontmatter(epicContent).replace(/\n## Comments\b[\s\S]*$/, '');
  if (!stripped.trim()) return '';
  return `<div class="sec-title">Description</div><div class="desc">${marked.parse(stripped)}</div>`;
}

function _renderGrid(childData, layout, blocks, parallel, epicTitle, docType) {
  if (!childData.length) return '';

  // ── Dimensions (scaled for print page ~700px wide) ────────────
  const CELL_W = 160;
  const CELL_H = 72;
  const GUTTER_X = 18;
  const GUTTER_Y = 28;
  const TOP_OFFSET = 60; // space for epic title node

  const positions = {};
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

  const cellAt = (col, row) => ({
    x: GUTTER_X + col * (CELL_W + GUTTER_X),
    y: TOP_OFFSET + row * (CELL_H + GUTTER_Y),
  });

  // card centres for arrows
  const cardPos = {};
  for (const child of childData) {
    const { col, row } = positions[child.filename];
    const { x, y } = cellAt(col, row);
    cardPos[child.filename] = { cx: x + CELL_W / 2, cy: y + CELL_H / 2, x, y };
  }

  const badgeColor = {
    epic: '#0066cc',
    feature: '#8b5cf6',
    story: '#2563eb',
    spike: '#b45309',
    bug: '#dc2626',
  };
  const epicColor = badgeColor[docType] || '#666';

  // ── SVG: lane dividers ────────────────────────────────────────
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

  // ── SVG: SEC arrows (same column, consecutive rows, no explicit BLOCKS) ──
  const byCols = {};
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

  // ── SVG: BLOCKS arrows (red) ──────────────────────────────────
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

  // ── SVG: PARALLEL brackets (blue dashed) ─────────────────────
  for (const { a, b } of parallel || []) {
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

  // ── Grid cells (dashed backgrounds) ──────────────────────────
  let cellsHtml = '';
  for (const child of childData) {
    const { x, y } = cellAt(positions[child.filename].col, positions[child.filename].row);
    cellsHtml += `<div class="grid-cell" style="left:${x}px;top:${y}px;width:${CELL_W}px;height:${CELL_H}px;"></div>`;
  }

  // ── Cards ─────────────────────────────────────────────────────
  let cardsHtml = '';
  const INSET = 3;
  for (const child of childData) {
    const { x, y } = cellAt(positions[child.filename].col, positions[child.filename].row);
    const bc = badgeColor[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const gridJiraLink = child.jiraId
      ? `<a href="${_esc(child.jiraUrl || '#')}" style="font-size:7px;color:#0066cc;font-weight:700;">${_esc(child.jiraId)}</a>`
      : '';
    cardsHtml += `<div class="grid-card" style="left:${x + INSET}px;top:${y + INSET}px;width:${CELL_W - INSET * 2}px;height:${CELL_H - INSET * 2}px;">
      <div class="grid-card-title">
        <span class="grid-card-type" style="background:${bc}">${_esc(TYPE_LABEL[child.docType] || child.docType)}</span>
        ${_esc(child.title)}
      </div>
      ${sp || gridJiraLink ? `<div class="grid-card-sp">${sp}${sp && gridJiraLink ? ' &middot; ' : ''}${gridJiraLink}</div>` : ''}
    </div>`;
  }

  // ── Epic title node (top centre) ─────────────────────────────
  const nodeW = Math.min(200, totalW - 20);
  const nodeX = (totalW - nodeW) / 2;
  const epicNodeHtml = `<div class="grid-epic-node" style="left:${nodeX}px;top:8px;width:${nodeW}px;border-color:${epicColor};color:${epicColor};">
    <span style="font-size:7px;text-transform:uppercase;letter-spacing:0.05em;">${_esc(TYPE_LABEL[docType] || docType)}</span>
    <div>${_esc(epicTitle)}</div>
  </div>`;

  return `<div class="sec-title">Visual Plan</div>
<div class="grid-wrap" style="width:${totalW}px;height:${totalH}px;">
  <svg class="grid-svg" width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>
  ${epicNodeHtml}
  ${cellsHtml}
  ${cardsHtml}
</div>`;
}

function _renderStoryCards(childData) {
  if (!childData.length) return '';
  const badgeColor = {
    epic: '#0066cc',
    feature: '#8b5cf6',
    story: '#2563eb',
    spike: '#b45309',
    bug: '#dc2626',
  };

  let html = '<div class="sec-title">Stories &amp; Items</div>';
  for (const child of childData) {
    const bc = badgeColor[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const stripped = stripFrontmatter(child.content).replace(/\n## Comments\b[\s\S]*$/, '');
    const body = stripped.trim()
      ? marked.parse(stripped)
      : '<em style="color:#94a3b8">No description</em>';

    const jiraLink = child.jiraId
      ? `<a href="${_esc(child.jiraUrl || '#')}" style="font-size:9px;color:#0066cc;font-weight:700;white-space:nowrap;">${_esc(child.jiraId)}</a>`
      : '';
    html += `<div class="story-card">
      <div class="story-card-hdr">
        <div class="story-card-title">
          <span class="grid-card-type" style="background:${bc}">${TYPE_LABEL[child.docType] || child.docType}</span>
          ${_esc(child.title)}
          ${jiraLink ? `&nbsp;${jiraLink}` : ''}
        </div>
        ${sp ? `<span class="story-card-sp">${sp}</span>` : ''}
      </div>
      <div class="story-card-body">${body}</div>
    </div>`;
  }
  return html;
}

// ── Roadmap PDF Export ──────────────────────────────────────────
// Opens a dialog with options, then builds a print-ready landscape
// report in a new tab, following the same pattern as exportEpicToPdf.

export function openRoadmapExportDialog() {
  document.getElementById('roadmap-export-overlay').classList.add('show');
}

export function closeRoadmapExportDialog() {
  document.getElementById('roadmap-export-overlay').classList.remove('show');
}

export async function executeRoadmapExport() {
  const includeRoadmap = document.getElementById('rexp-roadmap-graphic').checked;
  const includeTitles = document.getElementById('rexp-issue-titles').checked;
  const includeDescs = document.getElementById('rexp-issue-descriptions').checked;
  const includeCharts = document.getElementById('rexp-distribution-charts').checked;
  const hideEmptyEpics = document.getElementById('rexp-hide-empty-epics').checked;

  if (!includeRoadmap && !includeTitles && !includeDescs && !includeCharts) {
    showJiraToast('error', 'Select at least one section to export');
    return;
  }

  closeRoadmapExportDialog();
  showJiraToast('info', 'Preparing roadmap report...');

  try {
    const sprints = getAllSprints();
    const piFilter = [..._roadmapVisiblePis].join(' + ') || null;
    const leafTypes = new Set(['story', 'spike', 'bug']);
    const epicTypes = new Set(['epic']);

    // Visible leaf docs (same logic as renderStoryPanel)
    const visibleLeafs = allDocs.filter(
      (d) => leafTypes.has(d.docType) && d.fixVersion && _roadmapVisiblePis.has(d.fixVersion)
    );

    // Build epic map (same logic as renderEpicPanel)
    const epicMap = new Map();
    for (const leaf of visibleLeafs) {
      const key = leaf.parentFilename || '__none__';
      if (!epicMap.has(key)) {
        const epicDoc = leaf.parentFilename
          ? allDocs.find((d) => d.filename === leaf.parentFilename)
          : null;
        epicMap.set(key, { epicDoc, sprints: new Set(), storyCount: 0, totalSP: 0 });
      }
      const entry = epicMap.get(key);
      entry.storyCount++;
      entry.totalSP += Number(leaf.storyPoints) || 0;
      if (leaf.sprint) entry.sprints.add(leaf.sprint);
    }
    for (const d of allDocs) {
      if (epicTypes.has(d.docType) && !epicMap.has(d.filename)) {
        epicMap.set(d.filename, { epicDoc: d, sprints: new Set(), storyCount: 0, totalSP: 0 });
      }
    }

    // Sort epics same as renderEpicPanel
    const epicEntries = [...epicMap.entries()].sort(([ka, a], [kb, b]) => {
      if (ka === '__none__') return 1;
      if (kb === '__none__') return -1;
      const ra = a.epicDoc?.rank != null ? a.epicDoc.rank : 9999;
      const rb = b.epicDoc?.rank != null ? b.epicDoc.rank : 9999;
      if (ra !== rb) return ra - rb;
      return kb.localeCompare(ka);
    });

    // Fetch descriptions if needed
    let contentMap = {};
    if (includeDescs) {
      const fetches = visibleLeafs.map(async (d) => {
        try {
          const res = await fetch(`/api/doc/${d.docType}/${encodeURIComponent(d.filename)}`);
          if (res.ok) {
            const data = await res.json();
            contentMap[d.filename] = data.content || '';
          }
        } catch {
          /* no-op */
        }
      });
      await Promise.all(fetches);
    }

    const html = _buildRoadmapPrintPage({
      sprints,
      epicEntries,
      visibleLeafs,
      contentMap,
      piFilter,
      includeRoadmap,
      includeTitles,
      includeDescs,
      includeCharts,
      hideEmptyEpics,
    });

    const win = window.open('', '_blank');
    if (!win) {
      showJiraToast('error', 'Pop-up blocked — please allow pop-ups');
      return;
    }
    win.document.write(html);
    win.document.close();
    showJiraToast('ok', 'Report ready — use Save as PDF in the print dialog');
  } catch (e) {
    showJiraToast('error', `Export failed: ${e.message}`);
  }
}

// ── Roadmap print page builder ──────────────────────────────────

function _buildRoadmapPrintPage(opts) {
  const {
    sprints,
    epicEntries,
    visibleLeafs,
    contentMap,
    piFilter,
    includeRoadmap,
    includeTitles,
    includeDescs,
    includeCharts,
    hideEmptyEpics,
  } = opts;

  const piLabel =
    piFilter || [piSettings.currentPi, piSettings.nextPi].filter(Boolean).join(' + ') || 'All';
  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const totalSP = visibleLeafs.reduce((s, d) => s + (Number(d.storyPoints) || 0), 0);
  const issueCount = visibleLeafs.length;
  const epicCount = epicEntries.filter(([k]) => k !== '__none__').length;

  let sections = '';
  if (includeRoadmap) sections += _renderRoadmapTimeline(sprints, epicEntries, hideEmptyEpics);
  if (includeCharts) sections += _renderRoadmapCharts(visibleLeafs);
  if (includeTitles) sections += _renderRoadmapIssueTitles(sprints, visibleLeafs);
  if (includeDescs) sections += _renderRoadmapIssueDescs(sprints, visibleLeafs, contentMap);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Roadmap Report — ${_esc(piLabel)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a2e; font-size: 11px; line-height: 1.55;
    padding: 28px 32px; margin: 0 auto;
  }
  @page { size: A4 landscape; margin: 10mm; }
  @media print {
    html { width: 297mm; }
    body { padding: 0; width: 100%; }
    .no-print { display: none !important; }
    .rm-print-card, .rm-issue-row { page-break-inside: avoid; }
  }

  /* ── Print banner ────────────────────────────────────── */
  .print-banner {
    background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;
    padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: #0369a1;
    display: flex; align-items: center; gap: 10px;
  }
  .print-banner button {
    background: #0284c7; color: #fff; border: none; border-radius: 6px;
    padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .print-banner button:hover { background: #0369a1; }

  /* ── Header ──────────────────────────────────────────── */
  .rpt-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .rpt-meta  { font-size: 11px; color: #64748b; margin-bottom: 20px; }
  .rpt-meta b { color: #334155; }

  /* ── Section titles ──────────────────────────────────── */
  .sec-title {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #64748b; margin: 28px 0 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;
  }

  /* ── Timeline grid ───────────────────────────────────── */
  .rm-tl-table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  .rm-tl-table th {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    color: #64748b; padding: 6px 4px; border-bottom: 2px solid #e2e8f0;
    text-align: center; white-space: nowrap;
  }
  .rm-tl-table th:first-child { text-align: left; width: 320px; min-width: 260px; }
  .rm-tl-table th:not(:first-child) { width: 60px; min-width: 50px; }
  .rm-tl-row td { padding: 4px 2px; height: 32px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  .rm-tl-row td:first-child {
    padding: 4px 8px; font-size: 12px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;
  }
  .rm-tl-epic-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    margin-right: 5px; vertical-align: middle;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rm-tl-meta { font-size: 9px; color: #94a3b8; font-weight: 400; margin-left: 6px; }
  .rm-tl-epic-link {
    font-size: 9px; font-weight: 700; color: #0066cc; text-decoration: none;
    font-family: SFMono-Regular, Menlo, monospace;
  }
  .rm-tl-epic-link:hover { text-decoration: underline; }
  .rm-tl-bar {
    height: 20px; border-radius: 4px; opacity: 0.85;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    display: flex; align-items: center; padding: 0 6px; overflow: hidden;
  }
  .rm-tl-bar-key {
    font-size: 8px; font-weight: 700; color: #fff; text-decoration: none;
    white-space: nowrap; text-shadow: 0 0 3px rgba(0,0,0,0.3);
    font-family: SFMono-Regular, Menlo, monospace;
  }
  .rm-tl-bar-key:hover { text-decoration: underline; }

  /* ── Issue titles table ──────────────────────────────── */
  .rm-it-table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  .rm-it-table th {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    color: #64748b; padding: 5px 6px; border-bottom: 2px solid #e2e8f0; text-align: left;
  }
  .rm-it-table td {
    font-size: 10px; padding: 5px 6px; border-bottom: 1px solid #f1f5f9;
  }
  .rm-it-sprint-hdr td {
    font-size: 11px; font-weight: 700; padding: 10px 6px 4px;
    border-bottom: 1px solid #cbd5e1; color: #334155;
  }
  .rm-it-type {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 8px; font-weight: 700; text-transform: uppercase; color: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rm-it-key {
    font-size: 9px; font-weight: 700; color: #0066cc; text-decoration: none;
    font-family: SFMono-Regular, Menlo, monospace; white-space: nowrap;
  }
  .rm-it-key:hover { text-decoration: underline; }

  /* ── Issue description cards ─────────────────────────── */
  .rm-print-card {
    border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 12px 14px; margin-bottom: 12px;
  }
  .rm-print-card-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .rm-print-card-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px; }
  .rm-print-card-key {
    font-size: 10px; font-weight: 700; color: #0066cc; text-decoration: none;
    font-family: SFMono-Regular, Menlo, monospace; white-space: nowrap;
  }
  .rm-print-card-key:hover { text-decoration: underline; }
  .rm-print-card-sp {
    font-size: 10px; font-weight: 700; color: #64748b;
    background: #f1f5f9; padding: 2px 7px; border-radius: 4px; white-space: nowrap;
  }
  .rm-print-card-body { font-size: 10px; line-height: 1.55; color: #334155; }
  .rm-print-card-body h1, .rm-print-card-body h2, .rm-print-card-body h3 { font-size: 11px; margin: 8px 0 4px; }
  .rm-print-card-body ul, .rm-print-card-body ol { padding-left: 18px; margin: 4px 0; }
  .rm-print-card-body li { margin: 2px 0; }
  .rm-print-card-body p { margin: 4px 0; }
  .rm-print-card-body pre { font-size: 9px; background: #f1f5f9; padding: 8px; border-radius: 4px; overflow-x: auto; }
  .rm-print-card-body code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
  .rm-print-card-body table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  .rm-print-card-body th, .rm-print-card-body td { border: 1px solid #e2e8f0; padding: 3px 6px; font-size: 9px; }

  /* ── Charts ──────────────────────────────────────────── */
  .rm-charts-wrap { display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 16px; }
  .rm-chart-box { flex: 1; min-width: 300px; }
  .rm-chart-title { font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 8px; }

  /* ── Footer ──────────────────────────────────────────── */
  .rpt-footer {
    margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; text-align: right;
  }
</style>
</head>
<body>

<div class="no-print print-banner">
  <span>Your roadmap report is ready.</span>
  <button onclick="window.print()">Save as PDF</button>
  <span style="color:#64748b">or press Cmd+P / Ctrl+P</span>
</div>

<div class="rpt-title">Roadmap Report</div>
<div class="rpt-meta">
  PI: <b>${_esc(piLabel)}</b>
  &middot; <b>${epicCount}</b> epic${epicCount !== 1 ? 's' : ''}
  &middot; <b>${issueCount}</b> issue${issueCount !== 1 ? 's' : ''}
  &middot; <b>${totalSP}</b> Story Points
  &middot; Exported on <b>${dateStr}</b>
</div>

${sections}

<div class="rpt-footer">Exported on ${dateStr} &middot; MIDAS Backlog</div>

<script>
  setTimeout(() => window.print(), 400);
</script>
</body>
</html>`;
}

// ── Roadmap timeline (epic bars across sprint columns) ──────────

function _renderRoadmapTimeline(sprints, epicEntries, hideEmptyEpics) {
  if (!sprints.length) return '';

  const N = sprints.length;
  const sprintIdx = new Map(sprints.map((s, i) => [s.name, i]));

  // Header row
  let headerCells = '<th>Epic</th>';
  for (const s of sprints) headerCells += `<th>${_esc(s.name)}</th>`;

  // Epic rows
  let rowsHtml = '';
  for (const [key, { epicDoc, sprints: sprintSet, storyCount, totalSP }] of epicEntries) {
    // Skip epics with no stories in any sprint if the option is enabled
    if (hideEmptyEpics && sprintSet.size === 0) continue;
    const isNone = key === '__none__';
    const title = epicDoc?.title || (isNone ? 'Unlinked Stories' : key);
    const color = isNone ? '#94a3b8' : epicColor(key);
    const meta = `${storyCount} item${storyCount !== 1 ? 's' : ''} · ${totalSP} SP`;

    // Compute sprint span
    const indices = [...sprintSet].filter((s) => sprintIdx.has(s)).map((s) => sprintIdx.get(s));
    const minIdx = indices.length ? Math.min(...indices) : -1;
    const maxIdx = indices.length ? Math.max(...indices) : -1;

    const jiraId = epicDoc?.jiraId || null;
    const jiraUrl = jiraId ? epicDoc?.jiraUrl || `${jiraBase}/browse/${jiraId}` : null;
    const epicLabel = isNone
      ? _esc(title)
      : jiraId
        ? `<a href="${_esc(jiraUrl)}" class="rm-tl-epic-link">${_esc(jiraId)}</a> ${_esc(title)}`
        : _esc(title);

    let cells = `<td><span class="rm-tl-epic-dot" style="background:${color}"></span>${epicLabel}<span class="rm-tl-meta">${_esc(meta)}</span></td>`;

    for (let i = 0; i < N; i++) {
      if (minIdx >= 0 && i === minIdx) {
        const span = maxIdx - minIdx + 1;
        const barLabel = jiraId
          ? `<a href="${_esc(jiraUrl)}" class="rm-tl-bar-key">${_esc(jiraId)}</a>`
          : '';
        cells += `<td colspan="${span}"><div class="rm-tl-bar" style="background:${color}">${barLabel}</div></td>`;
        i = maxIdx; // skip spanned columns
      } else if (minIdx >= 0 && i > minIdx && i <= maxIdx) {
        continue; // covered by colspan
      } else {
        cells += '<td></td>';
      }
    }

    rowsHtml += `<tr class="rm-tl-row">${cells}</tr>`;
  }

  return `<div class="sec-title">Roadmap Timeline</div>
<table class="rm-tl-table">
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>`;
}

// ── Issue titles table (grouped by sprint) ──────────────────────

function _renderRoadmapIssueTitles(sprints, visibleLeafs) {
  if (!visibleLeafs.length) return '';

  const badgeColor = { story: '#2563eb', spike: '#b45309', bug: '#dc2626' };

  // Group by sprint
  const grouped = new Map();
  const unassigned = [];
  for (const s of sprints) grouped.set(s.name, []);
  for (const d of visibleLeafs) {
    if (d.sprint && grouped.has(d.sprint)) grouped.get(d.sprint).push(d);
    else unassigned.push(d);
  }

  let html =
    '<th>Type</th><th>Key</th><th>Title</th><th>Priority</th><th>SP</th><th>Parent</th><th>Team</th><th>Category</th>';
  let rows = '';

  const renderGroup = (label, docs) => {
    if (!docs.length) return '';
    const sorted = topoSortCards(docs);
    let out = `<tr class="rm-it-sprint-hdr"><td colspan="8">${_esc(label)}</td></tr>`;
    for (const d of sorted) {
      const bc = badgeColor[d.docType] || '#666';
      const parent = d.parentFilename ? allDocs.find((p) => p.filename === d.parentFilename) : null;
      const keyCell = d.jiraId
        ? `<a href="${_esc(d.jiraUrl || `${jiraBase}/browse/${d.jiraId}`)}" class="rm-it-key">${_esc(d.jiraId)}</a>`
        : '—';
      out += `<tr class="rm-issue-row">
        <td><span class="rm-it-type" style="background:${bc}">${TYPE_LABEL[d.docType] || d.docType}</span></td>
        <td>${keyCell}</td>
        <td>${_esc(d.title)}</td>
        <td>${_esc(d.priority || 'Medium')}</td>
        <td>${d.storyPoints || '—'}</td>
        <td>${parent ? _esc(parent.title) : '—'}</td>
        <td>${_esc(d.team || '—')}</td>
        <td>${_esc(d.workCategory || '—')}</td>
      </tr>`;
    }
    return out;
  };

  for (const s of sprints) {
    rows += renderGroup(s.name, grouped.get(s.name) || []);
  }
  if (unassigned.length) rows += renderGroup('Unassigned', unassigned);

  return `<div class="sec-title">Issue Titles</div>
<table class="rm-it-table">
  <thead><tr>${html}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

// ── Issue descriptions (story cards with markdown) ──────────────

function _renderRoadmapIssueDescs(sprints, visibleLeafs, contentMap) {
  if (!visibleLeafs.length) return '';

  const badgeColor = { story: '#2563eb', spike: '#b45309', bug: '#dc2626' };

  // Group by sprint
  const grouped = new Map();
  const unassigned = [];
  for (const s of sprints) grouped.set(s.name, []);
  for (const d of visibleLeafs) {
    if (d.sprint && grouped.has(d.sprint)) grouped.get(d.sprint).push(d);
    else unassigned.push(d);
  }

  let html = '';
  const renderGroup = (label, docs) => {
    if (!docs.length) return '';
    const sorted = topoSortCards(docs);
    let out = `<div class="sec-title" style="margin-top:20px">${_esc(label)}</div>`;
    for (const d of sorted) {
      const bc = badgeColor[d.docType] || '#666';
      const sp = d.storyPoints ? `${d.storyPoints} SP` : '';
      const raw = contentMap[d.filename] || '';
      const stripped = stripFrontmatter(raw).replace(/\n## Comments\b[\s\S]*$/, '');
      const body = stripped.trim()
        ? marked.parse(stripped)
        : '<em style="color:#94a3b8">No description</em>';
      const descKeyLink = d.jiraId
        ? `<a href="${_esc(d.jiraUrl || `${jiraBase}/browse/${d.jiraId}`)}" class="rm-print-card-key">${_esc(d.jiraId)}</a>`
        : '';

      out += `<div class="rm-print-card">
        <div class="rm-print-card-hdr">
          <div class="rm-print-card-title">
            <span class="rm-it-type" style="background:${bc}">${TYPE_LABEL[d.docType] || d.docType}</span>
            ${descKeyLink}
            ${_esc(d.title)}
          </div>
          ${sp ? `<span class="rm-print-card-sp">${sp}</span>` : ''}
        </div>
        <div class="rm-print-card-body">${body}</div>
      </div>`;
    }
    return out;
  };

  for (const s of sprints) {
    html += renderGroup(s.name, grouped.get(s.name) || []);
  }
  if (unassigned.length) html += renderGroup('Unassigned', unassigned);

  return `<div class="sec-title">Issue Descriptions</div>${html}`;
}

// ── Distribution charts (SVG horizontal bar charts) ─────────────

function _renderRoadmapCharts(visibleLeafs) {
  if (!visibleLeafs.length) return '';

  const COLORS = [
    '#3B82F6',
    '#8B5CF6',
    '#10B981',
    '#14B8A6',
    '#F59E0B',
    '#EC4899',
    '#06B6D4',
    '#6366F1',
  ];
  const BAR_H = 28;
  const BAR_GAP = 8;
  const CHART_W = 460;
  const LABEL_X = 5;
  const BAR_X = 160;
  const BAR_MAX_W = CHART_W - BAR_X - 10;

  // Aggregate by team
  const teamDist = {};
  const catDist = {};
  for (const d of visibleLeafs) {
    const team = d.team || 'Unassigned';
    const cat = d.workCategory || 'Uncategorized';
    teamDist[team] = (teamDist[team] || 0) + (Number(d.storyPoints) || 0);
    catDist[cat] = (catDist[cat] || 0) + (Number(d.storyPoints) || 0);
  }

  const buildChart = (title, dist) => {
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    const maxVal = Math.max(...entries.map((e) => e[1]), 1);
    const totalVal = entries.reduce((s, e) => s + e[1], 0);
    const svgH = entries.length * (BAR_H + BAR_GAP) + 10;

    let bars = '';
    entries.forEach(([label, value], i) => {
      const y = i * (BAR_H + BAR_GAP) + 5;
      const w = Math.max((value / maxVal) * BAR_MAX_W, 2);
      const color = COLORS[i % COLORS.length];
      const pct = totalVal > 0 ? Math.round((value / totalVal) * 100) : 0;

      bars += `<text x="${LABEL_X}" y="${y + BAR_H / 2 + 4}" font-size="10" font-weight="600" fill="#334155">${_esc(label)}</text>`;
      bars += `<rect x="${BAR_X}" y="${y}" width="${w}" height="${BAR_H}" rx="4" fill="${color}" opacity="0.85"/>`;
      bars += `<text x="${BAR_X + w + 6}" y="${y + BAR_H / 2 + 4}" font-size="9" fill="#64748b">${value} SP (${pct}%)</text>`;
    });

    return `<div class="rm-chart-box">
      <div class="rm-chart-title">${_esc(title)}</div>
      <svg width="${CHART_W}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>
    </div>`;
  };

  const teamChart = buildChart('Story Points by Team', teamDist);
  const catChart = buildChart('Story Points by Category', catDist);

  return `<div class="sec-title">Distribution</div>
<div class="rm-charts-wrap">${teamChart}${catChart}</div>`;
}
