// ── Epic PDF Export ─────────────────────────────────────────────
// Opens a print-ready page in a new tab with:
//   1. Epic header (title, total SP, status)
//   2. Visual plan grid (swimlane layout matching the canvas)
//   3. Description (rendered markdown)
//   4. Story list with details
// The user can then Cmd+P / Ctrl+P → "Save as PDF".

async function exportEpicToPdf(filename, docType) {
  docType = docType || 'epic';
  showJiraToast('info', 'Preparing export...');

  try {
    // ── 1. Fetch epic content ──────────────────────────────────
    const epicRes = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!epicRes.ok) throw new Error('Could not load epic');
    const { content: epicContent } = await epicRes.json();
    const epicDoc = allDocs.find(d => d.filename === filename && d.docType === docType);
    const epicTitle = epicDoc?.title || filename;

    // ── 2. Fetch children + links ──────────────────────────────
    const linksRes = await fetch(`/api/links/${docType}/${encodeURIComponent(filename)}`);
    const linksData = linksRes.ok ? await linksRes.json() : {};
    const children = linksData.children || [];

    // ── 3. Fetch each child's content ──────────────────────────
    const childData = await Promise.all(children.map(async c => {
      const doc = allDocs.find(d => d.filename === c.filename);
      let content = '';
      try {
        const res = await fetch(`/api/doc/${c.docType}/${encodeURIComponent(c.filename)}`);
        if (res.ok) content = (await res.json()).content || '';
      } catch {}
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
    }));

    // ── 4. Compute layout for visual plan ──────────────────────
    const childFilenames = new Set(children.map(c => c.filename));
    const blocks = [];
    const parallel = [];
    const seenParallel = new Set();
    for (const child of children) {
      const doc = allDocs.find(d => d.filename === child.filename);
      if (!doc) continue;
      for (const fn of (doc.blocks || [])) {
        if (childFilenames.has(fn)) blocks.push({ src: child.filename, tgt: fn });
      }
      for (const fn of (doc.parallel || [])) {
        if (childFilenames.has(fn)) {
          const key = [child.filename, fn].sort().join('|');
          if (!seenParallel.has(key)) { seenParallel.add(key); parallel.push({ a: child.filename, b: fn }); }
        }
      }
    }

    let layout = {};
    try {
      const res = await fetch(`/api/canvas/layout/${encodeURIComponent(filename)}`);
      if (res.ok) layout = await res.json();
    } catch {}
    if (!Object.keys(layout).length && children.length) {
      layout = computeAutoLayout(children, blocks, parallel);
    }

    const totalSP = childData.reduce((sum, c) => sum + (c.storyPoints || 0), 0);

    // ── 5. Build full HTML page ────────────────────────────────
    const html = _buildPrintPage(epicTitle, docType, totalSP, epicDoc, epicContent, childData, layout, blocks, parallel);

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

function _buildPrintPage(epicTitle, docType, totalSP, epicDoc, epicContent, childData, layout, blocks, parallel) {
  const status   = epicDoc?.status || 'Draft';
  const priority = epicDoc?.priority || '';
  const count    = childData.length;
  const descHtml = _renderDesc(epicContent);
  const gridHtml = _renderGrid(childData, layout, blocks, parallel || [], epicTitle, docType);
  const listHtml = _renderStoryCards(childData);
  const dateStr  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const badgeColor = { epic: '#0066cc', feature: '#8b5cf6', story: '#2563eb', spike: '#b45309', bug: '#dc2626' };
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

<div class="footer">Exported on ${dateStr} &middot; Backlog Claude</div>

<script>
  // Auto-trigger print after a short delay for rendering
  setTimeout(() => window.print(), 400);
</script>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────

function _esc(s) { return escHtml(s); }

function _renderDesc(epicContent) {
  const stripped = stripFrontmatter(epicContent).replace(/\n## Comments\b[\s\S]*$/, '');
  if (!stripped.trim()) return '';
  return `<div class="sec-title">Description</div><div class="desc">${marked.parse(stripped)}</div>`;
}

function _renderGrid(childData, layout, blocks, parallel, epicTitle, docType) {
  if (!childData.length) return '';

  // ── Dimensions (scaled for print page ~700px wide) ────────────
  const CELL_W  = 160;
  const CELL_H  = 72;
  const GUTTER_X = 18;
  const GUTTER_Y = 28;
  const TOP_OFFSET = 60; // space for epic title node

  const positions = {};
  for (const child of childData) {
    positions[child.filename] = layout[child.filename] || { col: 0, row: 0 };
  }

  const usedCols = [...new Set(Object.values(positions).map(p => p.col))].sort((a, b) => a - b);
  const usedRows = [...new Set(Object.values(positions).map(p => p.row))].sort((a, b) => a - b);
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

  const badgeColor = { epic: '#0066cc', feature: '#8b5cf6', story: '#2563eb', spike: '#b45309', bug: '#dc2626' };
  const epicColor  = badgeColor[docType] || '#666';

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
      const hasExplicitBlock = blocks.some(b =>
        (b.src === colItems[i].fn && b.tgt === colItems[i + 1].fn) ||
        (b.src === colItems[i + 1].fn && b.tgt === colItems[i].fn)
      );
      if (hasExplicitBlock) continue;
      const s = cardPos[colItems[i].fn], t = cardPos[colItems[i + 1].fn];
      if (!s || !t) continue;
      const x1 = s.cx, y1 = s.y + CELL_H, x2 = t.cx, y2 = t.y;
      svgContent += `<path d="M${x1},${y1} C${x1},${y1 + 10} ${x2},${y2 - 10} ${x2},${y2}" stroke="#94a3b8" stroke-width="1.5" fill="none" marker-end="url(#pdf-arr-sec)"/>`;
      svgContent += `<text x="${x1 + 4}" y="${y1 + (y2 - y1) / 2}" class="pdf-edge-label">SEC</text>`;
    }
  }

  // ── SVG: BLOCKS arrows (red) ──────────────────────────────────
  for (const { src, tgt } of blocks) {
    const s = cardPos[src], t = cardPos[tgt];
    if (!s || !t) continue;
    const x1 = s.cx, y1 = s.y + CELL_H, x2 = t.cx, y2 = t.y;
    svgContent += `<path d="M${x1},${y1} C${x1},${y1 + 12} ${x2},${y2 - 12} ${x2},${y2}" stroke="#ef4444" stroke-width="2" fill="none" marker-end="url(#pdf-arr-blk)"/>`;
    svgContent += `<text x="${(x1 + x2) / 2 + 4}" y="${y1 + (y2 - y1) / 2}" class="pdf-edge-label pdf-edge-label-blocks">BLOCKS</text>`;
  }

  // ── SVG: PARALLEL brackets (blue dashed) ─────────────────────
  for (const { a, b } of (parallel || [])) {
    const pa = cardPos[a], pb = cardPos[b];
    if (!pa || !pb) continue;
    const x1 = pa.x, x2 = pb.x + CELL_W;
    const y  = Math.min(pa.y, pb.y) - 10;
    const d  = `M${x1},${pa.y - 3} V${y} H${x2} V${pb.y - 3}`;
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
  const badgeColor = { epic: '#0066cc', feature: '#8b5cf6', story: '#2563eb', spike: '#b45309', bug: '#dc2626' };

  let html = '<div class="sec-title">Stories &amp; Items</div>';
  for (const child of childData) {
    const bc = badgeColor[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const stripped = stripFrontmatter(child.content).replace(/\n## Comments\b[\s\S]*$/, '');
    const body = stripped.trim() ? marked.parse(stripped) : '<em style="color:#94a3b8">No description</em>';

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
