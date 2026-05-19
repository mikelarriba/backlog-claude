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
        content,
      };
    }));

    // ── 4. Compute layout for visual plan ──────────────────────
    const childFilenames = new Set(children.map(c => c.filename));
    const blocks = [];
    for (const child of children) {
      const doc = allDocs.find(d => d.filename === child.filename);
      if (!doc) continue;
      for (const fn of (doc.blocks || [])) {
        if (childFilenames.has(fn)) blocks.push({ src: child.filename, tgt: fn });
      }
    }

    let layout = {};
    try {
      const res = await fetch(`/api/canvas/layout/${encodeURIComponent(filename)}`);
      if (res.ok) layout = await res.json();
    } catch {}
    if (!Object.keys(layout).length && children.length) {
      layout = computeAutoLayout(children, blocks, []);
    }

    const totalSP = childData.reduce((sum, c) => sum + (c.storyPoints || 0), 0);

    // ── 5. Build full HTML page ────────────────────────────────
    const html = _buildPrintPage(epicTitle, docType, totalSP, epicDoc, epicContent, childData, layout, blocks);

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

function _buildPrintPage(epicTitle, docType, totalSP, epicDoc, epicContent, childData, layout, blocks) {
  const status   = epicDoc?.status || 'Draft';
  const priority = epicDoc?.priority || '';
  const count    = childData.length;
  const descHtml = _renderDesc(epicContent);
  const gridHtml = _renderGrid(childData, layout, blocks);
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
  .grid-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .grid-cell {
    flex: 1; min-height: 56px; border: 1.5px dashed #cbd5e1;
    border-radius: 8px; padding: 4px;
  }
  .grid-card {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 7px 9px; height: 100%;
  }
  .grid-card-type {
    display: inline-block; padding: 1px 5px; border-radius: 3px;
    font-size: 7px; font-weight: 700; text-transform: uppercase;
    color: #fff; margin-right: 4px; vertical-align: middle;
  }
  .grid-card-title { font-size: 9px; font-weight: 600; line-height: 1.35; }
  .grid-card-sp { font-size: 8px; color: #64748b; margin-top: 3px; }
  .grid-arrow { text-align: center; color: #ef4444; font-size: 11px; font-weight: 700; padding: 2px 0; }

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
  const stripped = stripFrontmatter(epicContent);
  if (!stripped.trim()) return '';
  return `<div class="sec-title">Description</div><div class="desc">${marked.parse(stripped)}</div>`;
}

function _renderGrid(childData, layout, blocks) {
  if (!childData.length) return '';

  const maxCol = Math.max(0, ...Object.values(layout).map(p => p.col));
  const maxRow = Math.max(0, ...Object.values(layout).map(p => p.row));
  const cols = maxCol + 1;
  const rows = maxRow + 1;

  const cellMap = {};
  for (const child of childData) {
    const pos = layout[child.filename] || { col: 0, row: 0 };
    cellMap[`${pos.col},${pos.row}`] = child;
  }

  const badgeColor = { epic: '#0066cc', feature: '#8b5cf6', story: '#2563eb', spike: '#b45309', bug: '#dc2626' };

  let html = '<div class="sec-title">Visual Plan</div>';
  for (let row = 0; row < rows; row++) {
    if (row > 0) {
      let hasArrow = false;
      for (const b of blocks) {
        const sp = layout[b.src], tp = layout[b.tgt];
        if (sp && tp && sp.row < row && tp.row === row) { hasArrow = true; break; }
      }
      if (hasArrow) html += '<div class="grid-arrow">&#9660; BLOCKS</div>';
    }

    html += '<div class="grid-row">';
    for (let col = 0; col < cols; col++) {
      const child = cellMap[`${col},${row}`];
      if (child) {
        const bc = badgeColor[child.docType] || '#666';
        const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
        html += `<div class="grid-cell"><div class="grid-card">
          <div class="grid-card-title">
            <span class="grid-card-type" style="background:${bc}">${TYPE_LABEL[child.docType] || child.docType}</span>
            ${_esc(child.title)}
          </div>
          ${sp ? `<div class="grid-card-sp">${sp}</div>` : ''}
        </div></div>`;
      } else {
        html += '<div class="grid-cell"></div>';
      }
    }
    html += '</div>';
  }
  return html;
}

function _renderStoryCards(childData) {
  if (!childData.length) return '';
  const badgeColor = { epic: '#0066cc', feature: '#8b5cf6', story: '#2563eb', spike: '#b45309', bug: '#dc2626' };

  let html = '<div class="sec-title">Stories &amp; Items</div>';
  for (const child of childData) {
    const bc = badgeColor[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const stripped = stripFrontmatter(child.content);
    const body = stripped.trim() ? marked.parse(stripped) : '<em style="color:#94a3b8">No description</em>';

    html += `<div class="story-card">
      <div class="story-card-hdr">
        <div class="story-card-title">
          <span class="grid-card-type" style="background:${bc}">${TYPE_LABEL[child.docType] || child.docType}</span>
          ${_esc(child.title)}
        </div>
        ${sp ? `<span class="story-card-sp">${sp}</span>` : ''}
      </div>
      <div class="story-card-body">${body}</div>
    </div>`;
  }
  return html;
}
