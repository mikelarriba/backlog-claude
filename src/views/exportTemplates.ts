// ── Export templates: CSS + HTML string builders for print/export pages ──────
// Extracted from routes/export.ts (#341). Everything here composes markup out
// of already-computed data (see services/exportLayout.ts) — no fs/Express deps.
import type { DocEntry } from '../types.js';
import {
  TYPE_LABEL,
  BADGE_COLOR,
  esc,
  escAttr,
  stripFrontmatter,
  epicColor,
  topoSortCards,
  renderGrid,
  type ChildData,
  type SprintEntry,
  type EpicMapEntry,
} from '../services/exportLayout.js';

// ── Markdown rendering wrapper (deferred to browser via marked.umd.js) ────────
// Embeds raw markdown as a data attribute; an inline script renders it after load.
function mdPlaceholder(raw: string): string {
  if (!raw.trim()) return '';
  return `<span class="md-placeholder" data-md="${escAttr(raw)}"></span>`;
}

// ── Doc export HTML builder ───────────────────────────────────────────────────

export function renderStoryCards(childData: ChildData[]): string {
  if (!childData.length) return '';

  let html = '<div class="sec-title">Stories &amp; Items</div>';
  for (const child of childData) {
    const bc = BADGE_COLOR[child.docType] || '#666';
    const sp = child.storyPoints ? `${child.storyPoints} SP` : '';
    const stripped = stripFrontmatter(child.content).replace(/\n## Comments\b[\s\S]*$/, '');
    const body = stripped.trim()
      ? mdPlaceholder(stripped)
      : '<em style="color:#94a3b8">No description</em>';
    const jiraLink = child.jiraId
      ? `<a href="${esc(child.jiraUrl || '#')}" style="font-size:9px;color:#0066cc;font-weight:700;white-space:nowrap;">${esc(child.jiraId)}</a>`
      : '';

    html += `<div class="story-card">
      <div class="story-card-hdr">
        <div class="story-card-title">
          <span class="grid-card-type" style="background:${bc}">${esc(TYPE_LABEL[child.docType] || child.docType)}</span>
          ${esc(child.title)}
          ${jiraLink ? `&nbsp;${jiraLink}` : ''}
        </div>
        ${sp ? `<span class="story-card-sp">${sp}</span>` : ''}
      </div>
      <div class="story-card-body">${body}</div>
    </div>`;
  }
  return html;
}

// Common print-page CSS
export const PRINT_CSS = `
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
  .hdr-badge {
    display: inline-block; padding: 3px 10px; border-radius: 5px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    color: #fff; vertical-align: middle; margin-right: 6px;
  }
  .hdr-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; line-height: 1.3; }
  .hdr-meta  { font-size: 11px; color: #64748b; margin-bottom: 20px; }
  .hdr-meta b { color: #334155; }
  .sec-title {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #64748b; margin: 24px 0 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;
  }
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
  .footer {
    margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; text-align: right;
  }
`;

// Inline script to render markdown placeholders using marked (loaded from server)
const MD_RENDER_SCRIPT = `
<script src="/public/js/vendor/marked.umd.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.md-placeholder').forEach(function(el) {
      var raw = el.getAttribute('data-md') || '';
      el.outerHTML = marked.parse(raw);
    });
    setTimeout(function() { window.print(); }, 500);
  });
</script>
`;

export function buildDocPrintPage(opts: {
  epicTitle: string;
  docType: string;
  totalSP: number;
  epicDoc: DocEntry;
  epicContent: string;
  childData: ChildData[];
  layout: Record<string, { col: number; row: number }>;
  blocks: Array<{ src: string; tgt: string }>;
  parallel: Array<{ a: string; b: string }>;
}): string {
  const { epicTitle, docType, totalSP, epicDoc, epicContent, childData, layout, blocks, parallel } =
    opts;
  const status = epicDoc?.status || 'Draft';
  const priority = epicDoc?.priority || '';
  const count = childData.length;
  const bc = BADGE_COLOR[docType] || '#666';

  const stripped = stripFrontmatter(epicContent).replace(/\n## Comments\b[\s\S]*$/, '');
  const descHtml = stripped.trim()
    ? `<div class="sec-title">Description</div><div class="desc">${mdPlaceholder(stripped)}</div>`
    : '';

  const gridHtml = renderGrid(childData, layout, blocks, parallel, epicTitle, docType);
  const listHtml = renderStoryCards(childData);

  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(epicTitle)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="no-print print-banner">
  <span>Your export is ready.</span>
  <button onclick="window.print()">Save as PDF</button>
  <span style="color:#64748b">or press Cmd+P / Ctrl+P</span>
</div>
<div class="hdr-title">
  <span class="hdr-badge" style="background:${bc}">${esc(TYPE_LABEL[docType] || docType)}</span>
  ${esc(epicTitle)}
</div>
<div class="hdr-meta">
  ${totalSP ? `<b>${totalSP}</b> Story Points &middot; ` : ''}
  <b>${count}</b> item${count !== 1 ? 's' : ''}
  ${priority ? ` &middot; Priority: <b>${priority}</b>` : ''}
  &middot; Status: <b>${status}</b>
  ${epicDoc?.jiraId ? ` &middot; JIRA: <a href="${esc(epicDoc.jiraUrl || '#')}" style="color:#0066cc;font-weight:700;">${esc(epicDoc.jiraId)}</a>` : ''}
</div>
${gridHtml}
${descHtml}
${listHtml}
<div class="footer">Exported on ${dateStr} &middot; MIDAS Backlog</div>
${MD_RENDER_SCRIPT}
</body>
</html>`;
}

// ── Roadmap export HTML builder ───────────────────────────────────────────────

export function renderRoadmapTimeline(
  sprints: SprintEntry[],
  epicEntries: Array<[string, EpicMapEntry]>,
  hideEmptyEpics: boolean
): string {
  if (!sprints.length) return '';

  const N = sprints.length;
  const sprintIdx = new Map(sprints.map((s, i) => [s.name, i]));

  let headerCells = '<th>Epic</th>';
  for (const s of sprints) headerCells += `<th>${esc(s.name)}</th>`;

  let rowsHtml = '';
  for (const [key, { epicDoc, sprints: sprintSet, storyCount, totalSP }] of epicEntries) {
    if (hideEmptyEpics && sprintSet.size === 0) continue;
    const isNone = key === '__none__';
    const title = epicDoc?.title || (isNone ? 'Unlinked Stories' : key);
    const color = isNone ? '#94a3b8' : epicColor(epicDoc?.workCategory);
    const meta = `${storyCount} item${storyCount !== 1 ? 's' : ''} · ${totalSP} SP`;

    const indices = [...sprintSet]
      .filter((s) => sprintIdx.has(s))
      .map((s) => sprintIdx.get(s) as number);
    const minIdx = indices.length ? Math.min(...indices) : -1;
    const maxIdx = indices.length ? Math.max(...indices) : -1;

    const jiraId = epicDoc?.jiraId || null;
    const jiraUrl = jiraId ? epicDoc?.jiraUrl || null : null;
    const epicLabel = isNone
      ? esc(title)
      : jiraId && jiraUrl
        ? `<a href="${esc(jiraUrl)}" class="rm-tl-epic-link">${esc(jiraId)}</a> ${esc(title)}`
        : esc(title);

    let cells = `<td><span class="rm-tl-epic-dot" style="background:${color}"></span>${epicLabel}<span class="rm-tl-meta">${esc(meta)}</span></td>`;

    for (let i = 0; i < N; i++) {
      if (minIdx >= 0 && i === minIdx) {
        const span = maxIdx - minIdx + 1;
        const barLabel =
          jiraId && jiraUrl
            ? `<a href="${esc(jiraUrl)}" class="rm-tl-bar-key">${esc(jiraId)}</a>`
            : '';
        cells += `<td colspan="${span}"><div class="rm-tl-bar" style="background:${color}">${barLabel}</div></td>`;
        i = maxIdx;
      } else if (minIdx >= 0 && i > minIdx && i <= maxIdx) {
        continue;
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

export function renderRoadmapIssueTitles(
  sprints: SprintEntry[],
  visibleLeafs: DocEntry[],
  allDocs: DocEntry[]
): string {
  if (!visibleLeafs.length) return '';

  const grouped = new Map<string, DocEntry[]>();
  const unassigned: DocEntry[] = [];
  for (const s of sprints) grouped.set(s.name, []);
  for (const d of visibleLeafs) {
    if (d.sprint && grouped.has(d.sprint)) grouped.get(d.sprint)!.push(d);
    else unassigned.push(d);
  }

  const header =
    '<th>Type</th><th>Key</th><th>Title</th><th>Priority</th><th>SP</th><th>Parent</th><th>Team</th><th>Category</th>';

  const renderGroup = (label: string, docs: DocEntry[]): string => {
    if (!docs.length) return '';
    const sorted = topoSortCards(docs);
    let out = `<tr class="rm-it-sprint-hdr"><td colspan="8">${esc(label)}</td></tr>`;
    for (const d of sorted) {
      const bc = BADGE_COLOR[d.docType] || '#666';
      const parent = d.parentFilename ? allDocs.find((p) => p.filename === d.parentFilename) : null;
      const keyCell = d.jiraId
        ? `<a href="${esc(d.jiraUrl || '#')}" class="rm-it-key">${esc(d.jiraId)}</a>`
        : '—';
      out += `<tr class="rm-issue-row">
        <td><span class="rm-it-type" style="background:${bc}">${TYPE_LABEL[d.docType] || d.docType}</span></td>
        <td>${keyCell}</td>
        <td>${esc(d.title)}</td>
        <td>${esc(d.priority || 'Medium')}</td>
        <td>${d.storyPoints || '—'}</td>
        <td>${parent ? esc(parent.title) : '—'}</td>
        <td>${esc(d.team || '—')}</td>
        <td>${esc(d.workCategory || '—')}</td>
      </tr>`;
    }
    return out;
  };

  let rows = '';
  for (const s of sprints) rows += renderGroup(s.name, grouped.get(s.name) || []);
  if (unassigned.length) rows += renderGroup('Unassigned', unassigned);

  return `<div class="sec-title">Issue Titles</div>
<table class="rm-it-table">
  <thead><tr>${header}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderRoadmapIssueDescs(
  sprints: SprintEntry[],
  visibleLeafs: DocEntry[],
  contentMap: Record<string, string>
): string {
  if (!visibleLeafs.length) return '';

  const grouped = new Map<string, DocEntry[]>();
  const unassigned: DocEntry[] = [];
  for (const s of sprints) grouped.set(s.name, []);
  for (const d of visibleLeafs) {
    if (d.sprint && grouped.has(d.sprint)) grouped.get(d.sprint)!.push(d);
    else unassigned.push(d);
  }

  const renderGroup = (label: string, docs: DocEntry[]): string => {
    if (!docs.length) return '';
    const sorted = topoSortCards(docs);
    let out = `<div class="sec-title" style="margin-top:20px">${esc(label)}</div>`;
    for (const d of sorted) {
      const bc = BADGE_COLOR[d.docType] || '#666';
      const sp = d.storyPoints ? `${d.storyPoints} SP` : '';
      const raw = contentMap[d.filename] || '';
      const stripped = stripFrontmatter(raw).replace(/\n## Comments\b[\s\S]*$/, '');
      const body = stripped.trim()
        ? mdPlaceholder(stripped)
        : '<em style="color:#94a3b8">No description</em>';
      const descKeyLink = d.jiraId
        ? `<a href="${esc(d.jiraUrl || '#')}" class="rm-print-card-key">${esc(d.jiraId)}</a>`
        : '';

      out += `<div class="rm-print-card">
        <div class="rm-print-card-hdr">
          <div class="rm-print-card-title">
            <span class="rm-it-type" style="background:${bc}">${TYPE_LABEL[d.docType] || d.docType}</span>
            ${descKeyLink}
            ${esc(d.title)}
          </div>
          ${sp ? `<span class="rm-print-card-sp">${sp}</span>` : ''}
        </div>
        <div class="rm-print-card-body">${body}</div>
      </div>`;
    }
    return out;
  };

  let html = '';
  for (const s of sprints) html += renderGroup(s.name, grouped.get(s.name) || []);
  if (unassigned.length) html += renderGroup('Unassigned', unassigned);

  return `<div class="sec-title">Issue Descriptions</div>${html}`;
}

export function renderRoadmapCharts(visibleLeafs: DocEntry[]): string {
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
  const BAR_H = 28,
    BAR_GAP = 8,
    CHART_W = 460,
    LABEL_X = 5,
    BAR_X = 160,
    BAR_MAX_W = CHART_W - BAR_X - 10;

  const teamDist: Record<string, number> = {};
  const catDist: Record<string, number> = {};
  for (const d of visibleLeafs) {
    const team = d.team || 'Unassigned';
    const cat = d.workCategory || 'Uncategorized';
    teamDist[team] = (teamDist[team] || 0) + (Number(d.storyPoints) || 0);
    catDist[cat] = (catDist[cat] || 0) + (Number(d.storyPoints) || 0);
  }

  const buildChart = (title: string, dist: Record<string, number>): string => {
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
      bars += `<text x="${LABEL_X}" y="${y + BAR_H / 2 + 4}" font-size="10" font-weight="600" fill="#334155">${esc(label)}</text>`;
      bars += `<rect x="${BAR_X}" y="${y}" width="${w}" height="${BAR_H}" rx="4" fill="${color}" opacity="0.85"/>`;
      bars += `<text x="${BAR_X + w + 6}" y="${y + BAR_H / 2 + 4}" font-size="9" fill="#64748b">${value} SP (${pct}%)</text>`;
    });

    return `<div class="rm-chart-box">
      <div class="rm-chart-title">${esc(title)}</div>
      <svg width="${CHART_W}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>
    </div>`;
  };

  return `<div class="sec-title">Distribution</div>
<div class="rm-charts-wrap">${buildChart('Story Points by Team', teamDist)}${buildChart('Story Points by Category', catDist)}</div>`;
}

export const ROADMAP_CSS = `
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
  .rpt-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .rpt-meta  { font-size: 11px; color: #64748b; margin-bottom: 20px; }
  .rpt-meta b { color: #334155; }
  .sec-title {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #64748b; margin: 28px 0 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;
  }
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
  .rm-it-table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  .rm-it-table th {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    color: #64748b; padding: 5px 6px; border-bottom: 2px solid #e2e8f0; text-align: left;
  }
  .rm-it-table td { font-size: 10px; padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
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
  .rm-charts-wrap { display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 16px; }
  .rm-chart-box { flex: 1; min-width: 300px; }
  .rm-chart-title { font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 8px; }
  .rpt-footer {
    margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; text-align: right;
  }
`;

export function buildRoadmapPrintPage(opts: {
  piLabel: string;
  epicCount: number;
  issueCount: number;
  totalSP: number;
  dateStr: string;
  sections: string;
}): string {
  const { piLabel, epicCount, issueCount, totalSP, dateStr, sections } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Roadmap Report — ${esc(piLabel)}</title>
<style>${ROADMAP_CSS}</style>
</head>
<body>
<div class="no-print print-banner">
  <span>Your roadmap report is ready.</span>
  <button onclick="window.print()">Save as PDF</button>
  <span style="color:#64748b">or press Cmd+P / Ctrl+P</span>
</div>
<div class="rpt-title">Roadmap Report</div>
<div class="rpt-meta">
  PI: <b>${esc(piLabel)}</b>
  &middot; <b>${epicCount}</b> epic${epicCount !== 1 ? 's' : ''}
  &middot; <b>${issueCount}</b> issue${issueCount !== 1 ? 's' : ''}
  &middot; <b>${totalSP}</b> Story Points
  &middot; Exported on <b>${dateStr}</b>
</div>
${sections}
<div class="rpt-footer">Exported on ${dateStr} &middot; MIDAS Backlog</div>
${MD_RENDER_SCRIPT}
</body>
</html>`;
}
