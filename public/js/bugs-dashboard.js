// ── Bug Dashboard ────────────────────────────────────────────────────────────
import { streamSSE, renderMarkdown, escHtml, readSSELines } from './state.js';
import { updateChart } from './chart-helpers.js';
import { registerChangeActions } from './actions.js';
let _chart = null;
let _allBugs = [];
let _filteredBugs = [];
const _selectedKeys = new Set();
let _includeClosed = false;
let _envFilter = 'all';
// Whether the right-hand analysis panel is expanded, and whether it holds a
// fresh analysis from this session (vs. a placeholder / last-saved report).
let _analysisOpen = false;
let _hasSessionAnalysis = false;
export async function loadBugsDashboard(force = false) {
  const refreshBtn = document.getElementById('bugs-refresh-btn');
  const cachedAtEl = document.getElementById('bugs-cached-at');
  const loadingEl = document.getElementById('bugs-loading');
  const loadingMsg = document.getElementById('bugs-loading-message');
  const loadingBar = document.getElementById('bugs-loading-bar');
  const errorBanner = document.getElementById('bugs-error-banner');
  // Show loading, hide error
  if (loadingEl) loadingEl.style.display = '';
  if (errorBanner) errorBanner.style.display = 'none';
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '↻ Loading…';
  }
  try {
    const params = new URLSearchParams();
    if (force) params.set('force', 'true');
    if (_includeClosed) params.set('includeClosed', 'true');
    const qs = params.toString();
    const url = `/api/bugs/dashboard${qs ? `?${qs}` : ''}`;
    // Raw fetch: this streams SSE progress events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here. readSSELines
    // handles the transport-level line framing (state.js's streamSSE() builds
    // on the same helper); this callback owns the dashboard's own chunk shape.
    const res = await fetch(url);
    // Plain `let data` here defeats TS's post-call null-narrowing below since
    // the only assignment is inside the nested onChunk callback — a holder
    // object keeps `result.data` narrowable via normal property access.
    const result = { data: null };
    await readSSELines(res, (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed.type === 'progress') {
        if (loadingMsg) loadingMsg.textContent = parsed.message || 'Loading…';
        if (loadingBar && parsed.total && parsed.fetched != null) {
          const pct = Math.round((parsed.fetched / parsed.total) * 100);
          loadingBar.style.width = `${pct}%`;
        }
      } else if (parsed.type === 'complete') {
        result.data = parsed.data;
      } else if (parsed.type === 'error') {
        throw new DashboardError(parsed.message, parsed.code);
      }
    });
    if (!result.data) throw new DashboardError('No data received from server', 'EMPTY_RESPONSE');
    const data = result.data;
    // Hide loading
    if (loadingEl) loadingEl.style.display = 'none';
    _allBugs = data.bugs || [];
    _selectedKeys.clear();
    filterBugsTable();
    renderBugsStats(data.stats || {});
    renderBugsChart(data.timeSeries || []);
    if (cachedAtEl && data.cachedAt) {
      const d = new Date(data.cachedAt);
      cachedAtEl.textContent = `Updated ${d.toLocaleTimeString()}`;
    }
  } catch (err) {
    console.error('Failed to load bugs dashboard:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    _showError(err);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Refresh';
    }
    if (loadingBar) loadingBar.style.width = '0%';
  }
}
export function refreshBugsDashboard() {
  _setAnalysisOpen(false);
  loadBugsDashboard(true);
}
export function renderBugsStats(stats) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? String(val) : '—';
  };
  set('bugs-stat-total', stats.total ?? 0);
  set('bugs-stat-open', stats.open ?? 0);
  set('bugs-stat-resolved30d', stats.resolved30d ?? 0);
  set('bugs-stat-avg', stats.avgResolutionDays != null ? `${stats.avgResolutionDays}d` : '—');
}
export function renderBugsChart(timeSeries) {
  if (!timeSeries?.length) return;
  const canvas = document.getElementById('bugs-chart');
  const labels = timeSeries.map((p) => p.week);
  const isProjected = timeSeries.map((p) => !!p.projected);
  const firstProjectedIdx = isProjected.findIndex(Boolean);
  function makeDataset(label, key, color, fill) {
    return {
      label,
      data: timeSeries.map((p) => p[key] ?? 0),
      backgroundColor: color.replace('1)', '0.25)'),
      borderColor: color,
      borderWidth: 2,
      fill,
      tension: 0.3,
      segment: {
        borderDash: (ctx) =>
          firstProjectedIdx > 0 && ctx.p0DataIndex >= firstProjectedIdx - 1 ? [6, 4] : [],
      },
      pointRadius: 0,
      pointHoverRadius: 4,
    };
  }
  _chart = updateChart(canvas, _chart, () => ({
    type: 'line',
    data: {
      labels,
      datasets: [
        makeDataset('Open', 'Open', 'rgba(220,38,38,1)', true),
        makeDataset('In Progress', 'In Progress', 'rgba(245,158,11,1)', true),
        makeDataset('Resolved', 'Resolved', 'rgba(16,185,129,1)', true),
        makeDataset('Closed', 'Closed', 'rgba(107,114,128,1)', true),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11 } },
        },
        tooltip: { mode: 'index' },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 20,
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, stepSize: 1 },
          stacked: true,
        },
      },
    },
  }));
}
export function renderBugsTable(bugs) {
  const wrap = document.getElementById('bugs-table-wrap');
  if (!wrap) return;
  if (!bugs || bugs.length === 0) {
    wrap.innerHTML = !_allBugs.length
      ? `
      <div class="empty-state-v2">
        <div class="empty-icon">🐛</div>
        <p class="empty-title">No bugs tracked</p>
        <p class="empty-body">
          When bugs are logged in JIRA they appear here automatically. You can also create
          bugs manually using the + button.
        </p>
      </div>`
      : '<p class="bugs-empty">No bugs match the current filters.</p>';
    _updateAnalyzeButton();
    return;
  }
  const rows = bugs
    .map((b) => {
      const checked = _selectedKeys.has(b.key) ? 'checked' : '';
      const statusClass = _statusClass(b.status);
      const priorityClass = `bugs-priority-${(b.priority || 'medium').toLowerCase()}`;
      const created = b.created ? b.created.slice(0, 10) : '—';
      return `<tr class="${_selectedKeys.has(b.key) ? 'selected' : ''}" data-key="${escHtml(b.key)}">
        <td><input type="checkbox" ${checked} onchange="bugToggleKey('${escHtml(b.key)}',this.checked)" /></td>
        <td class="bugs-key-cell">${escHtml(b.key)}</td>
        <td class="bugs-summary-cell" title="${escHtml(b.summary)}">${escHtml(b.summary)}</td>
        <td><span class="bugs-status-badge ${statusClass}">${escHtml(b.status)}</span></td>
        <td class="${priorityClass}">${escHtml(b.priority)}</td>
        <td>${escHtml(b.assignee || '—')}</td>
        <td>${created}</td>
      </tr>`;
    })
    .join('');
  wrap.innerHTML = `<div class="bugs-table-wrap">
    <table class="bugs-table">
      <thead>
        <tr>
          <th><input type="checkbox" id="bugs-select-all" onchange="bugToggleAll(this.checked)" /></th>
          <th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Created</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  _syncSelectAllCheckbox();
  _updateAnalyzeButton();
}
export function setBugsEnvFilter(env) {
  _envFilter = env;
  document.querySelectorAll('.bugs-env-toggle [data-env]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.env === env);
  });
  filterBugsTable();
}
export function filterBugsTable() {
  const priority = document.getElementById('bugs-filter-priority')?.value || 'all';
  const status = document.getElementById('bugs-filter-status')?.value || 'all';
  _filteredBugs = _allBugs.filter((b) => {
    const priorityOk = priority === 'all' || (b.priority || '').toLowerCase() === priority;
    const statusOk = status === 'all' || (b.status || '').toLowerCase() === status.toLowerCase();
    const envOk =
      _envFilter === 'all' || (b.isProduction ? 'production' : 'testing') === _envFilter;
    return priorityOk && statusOk && envOk;
  });
  renderBugsTable(_filteredBugs);
  _updateSelectionCount();
}
export function bugToggleKey(key, checked) {
  if (checked) _selectedKeys.add(key);
  else _selectedKeys.delete(key);
  _syncRowHighlight(key, checked);
  _syncSelectAllCheckbox();
  _updateAnalyzeButton();
  _updateSelectionCount();
}
export function bugToggleAll(checked) {
  if (checked) _filteredBugs.forEach((b) => _selectedKeys.add(b.key));
  else _filteredBugs.forEach((b) => _selectedKeys.delete(b.key));
  renderBugsTable(_filteredBugs);
}
// Wrap bare bug keys in the streamed analysis with links to JIRA so the live
// view matches the saved report (whose keys the server linkifies). Segments
// already inside a markdown link are skipped so keys are never double-wrapped.
function _linkifyBugKeys(text, keys, base) {
  const unique = [...new Set(keys)].filter(Boolean);
  if (!base || unique.length === 0) return text;
  const alternation = unique
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const keyRe = new RegExp(`(?<![\\w/-])(${alternation})(?![\\w-])`, 'g');
  const wrap = (segment) => segment.replace(keyRe, (k) => `[${k}](${base}/browse/${k})`);
  const linkRe = /\[[^\]]*\]\([^)]*\)/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(linkRe)) {
    out += wrap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + wrap(text.slice(last));
}
const _ANALYSIS_STEPS = [
  { label: 'Connecting', doing: 'Sending the selected bugs to the AI analyst…' },
  { label: 'Prioritizing', doing: 'Ranking bugs by severity and impact…', match: /prioriti/i },
  {
    label: 'Fix strategy',
    doing: 'Grouping bugs and finding common root causes…',
    match: /fix strategy|batch|root cause/i,
  },
  {
    label: 'Recommendations',
    doing: 'Drafting next steps for the most critical bugs…',
    match: /recommendation/i,
  },
  { label: 'Patterns', doing: 'Spotting trends and recurring patterns…', match: /pattern/i },
];
function _renderAnalysisProgress(el, activeIdx, done) {
  const total = _ANALYSIS_STEPS.length;
  // Fill sits mid-way through the active step so it always shows forward motion.
  const pct = done ? 100 : Math.round(((activeIdx + 0.5) / total) * 100);
  const doing = done ? 'Analysis complete' : _ANALYSIS_STEPS[activeIdx].doing;
  const steps = _ANALYSIS_STEPS
    .map((s, i) => {
      const state = done || i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
      return `<li class="bugs-progress-step ${state}"><span class="bugs-progress-dot"></span><span class="bugs-progress-step-label">${escHtml(s.label)}</span></li>`;
    })
    .join('');
  el.innerHTML =
    `<div class="bugs-progress-track"><div class="bugs-progress-fill" style="width:${pct}%"></div></div>` +
    `<div class="bugs-progress-status">` +
    (done
      ? '<span class="bugs-progress-check">✓</span>'
      : '<span class="bugs-progress-spinner"></span>') +
    `<span class="bugs-progress-label">${escHtml(doing)}</span></div>` +
    `<ol class="bugs-progress-steps">${steps}</ol>`;
}
// Furthest section reached given the markdown streamed so far. Once any text has
// arrived the "Connecting" step is complete, so the floor is step 1.
function _analysisStepFor(markdown) {
  let furthest = 1;
  for (let i = 1; i < _ANALYSIS_STEPS.length; i++) {
    const m = _ANALYSIS_STEPS[i].match;
    if (m && m.test(markdown)) furthest = i;
  }
  return furthest;
}
export async function analyzeBugs() {
  if (_selectedKeys.size === 0) return;
  const body = document.getElementById('bugs-analysis-body');
  const progress = document.getElementById('bugs-analysis-progress');
  const meta = document.getElementById('bugs-analysis-meta');
  if (!body) return;
  // Results render inline in the right-hand panel so they sit alongside the bug
  // list. The panel is expanded for the duration of the run and the report is
  // persisted server-side on completion (reopenable via the floating button).
  _setAnalysisOpen(true);
  _hasSessionAnalysis = true;
  if (meta) meta.textContent = '';
  body.innerHTML = '';
  if (progress) {
    progress.style.display = '';
    _renderAnalysisProgress(progress, 0, false);
  }
  const btn = document.getElementById('bugs-analyze-btn');
  if (btn) btn.disabled = true;
  // `failed` swaps the progress bar for an error message; success leaves the
  // completed bar in place. The trigger re-enables based on the live selection.
  const finish = (failed) => {
    if (failed !== undefined) {
      if (progress) progress.style.display = 'none';
      body.innerHTML = `<p class="bugs-error">Analysis failed: ${escHtml(failed)}</p>`;
    }
    if (btn) btn.disabled = _selectedKeys.size === 0;
  };
  let markdown = '';
  let activeIdx = 0;
  try {
    await streamSSE(
      '/api/bugs/dashboard/analyze',
      { bugKeys: [..._selectedKeys] },
      {
        onText: (chunk) => {
          markdown += chunk;
          body.innerHTML = renderMarkdown(_linkifyBugKeys(markdown, [..._selectedKeys], jiraBase));
          const next = _analysisStepFor(markdown);
          if (next !== activeIdx && progress) {
            activeIdx = next;
            _renderAnalysisProgress(progress, activeIdx, false);
          }
        },
        onDone: (payload) => {
          if (progress) _renderAnalysisProgress(progress, _ANALYSIS_STEPS.length, true);
          const report = payload?.report;
          if (meta && report?.savedAt) {
            meta.textContent = _formatSavedMeta(report.savedAt, _selectedKeys.size);
          }
          finish();
        },
        onError: (err) => finish(err.message),
      }
    );
  } catch (err) {
    finish(err.message || String(err));
  }
}
// Floating "Last analysis" button: expand or collapse the report panel. Opening
// it with no fresh session analysis pulls the most recent saved report so the
// user can reread it even after a reload.
export async function toggleBugsAnalysis() {
  if (_analysisOpen) {
    _setAnalysisOpen(false);
    return;
  }
  _setAnalysisOpen(true);
  if (!_hasSessionAnalysis) await loadLatestAnalysis();
}
async function loadLatestAnalysis() {
  const body = document.getElementById('bugs-analysis-body');
  const meta = document.getElementById('bugs-analysis-meta');
  const progress = document.getElementById('bugs-analysis-progress');
  if (!body) return;
  if (progress) progress.style.display = 'none';
  body.innerHTML = '<p class="bugs-analysis-placeholder">Loading last analysis…</p>';
  try {
    const res = await fetch('/api/bugs/dashboard/analyses/latest');
    if (res.status === 404) {
      if (meta) meta.textContent = '';
      body.innerHTML =
        '<p class="bugs-analysis-placeholder">No saved analysis yet. Select bugs and run ✨ AI Analyze.</p>';
      return;
    }
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const report = await res.json();
    body.innerHTML = renderMarkdown(_stripFrontmatter(report.markdown));
    if (meta) meta.textContent = _formatSavedMeta(report.savedAt, report.bugCount);
  } catch (err) {
    if (meta) meta.textContent = '';
    body.innerHTML = `<p class="bugs-error">Could not load last analysis: ${escHtml(err.message)}</p>`;
  }
}
function _setAnalysisOpen(open) {
  _analysisOpen = open;
  document.getElementById('bugs-workspace')?.classList.toggle('analysis-open', open);
  document.getElementById('bugs-last-analysis-btn')?.classList.toggle('active', open);
}
function _stripFrontmatter(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '');
}
function _formatSavedMeta(savedAt, bugCount) {
  const d = savedAt ? new Date(savedAt) : null;
  const when = d && !isNaN(d.getTime()) ? d.toLocaleString() : '';
  const count = bugCount ? `${bugCount} bug${bugCount === 1 ? '' : 's'} · ` : '';
  return when ? `Saved ${count}${when}` : '';
}
export function toggleClosedBugs(checked) {
  _includeClosed = checked;
  loadBugsDashboard(true);
}
// Typed change-action registration (issue #461 migration — see actions.ts
// and onProviderChange/updateModelSetting/updateEffortSetting in
// provider-settings.ts for the established registerChangeActions pattern).
// filterBugsTable reuses its existing data-change-action="..." string value
// (index.html) as the registered name — it's shared by both the priority
// and status <select>s, which is fine: a single handler that re-reads both
// elements from the DOM regardless of which one fired the event, same as
// before this migration. toggleClosedBugs keeps the "Change" suffix its
// data-change-action string already used, distinguishing it from the plain
// `toggleClosedBugs` function name.
registerChangeActions({
  filterBugsTable: () => {
    filterBugsTable();
  },
  toggleClosedBugsChange: (el) => {
    toggleClosedBugs(el.checked);
  },
});
// ── Helpers ───────────────────────────────────────────────────────────────────
class DashboardError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
function _showError(err) {
  const banner = document.getElementById('bugs-error-banner');
  const titleEl = document.getElementById('bugs-error-title');
  const detailEl = document.getElementById('bugs-error-detail');
  if (!banner) return;
  const code = err instanceof DashboardError ? err.code || '' : '';
  let title = 'Failed to load bug data';
  let detail = err?.message || String(err);
  if (code === 'JIRA_NOT_CONFIGURED') {
    title = 'JIRA not configured';
  } else if (detail.includes('timed out')) {
    title = 'JIRA request timed out';
  } else if (detail.includes('401') || detail.includes('403')) {
    title = 'JIRA authentication failed';
  } else if (detail.includes('404')) {
    title = 'JIRA project not found';
  } else if (detail.includes('Failed to fetch') || detail.includes('NetworkError')) {
    title = 'Network error';
    detail = 'Could not reach the server. Check your connection and try again.';
  }
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
  banner.style.display = '';
}
export function _statusClass(status) {
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  return `bugs-status-${s}`;
}
function _syncRowHighlight(key, selected) {
  const row = document.querySelector(`.bugs-table tr[data-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('selected', selected);
}
function _syncSelectAllCheckbox() {
  const cb = document.getElementById('bugs-select-all');
  if (!cb) return;
  const total = _filteredBugs.length;
  const sel = _filteredBugs.filter((b) => _selectedKeys.has(b.key)).length;
  cb.checked = total > 0 && sel === total;
  cb.indeterminate = sel > 0 && sel < total;
}
function _updateAnalyzeButton() {
  const btn = document.getElementById('bugs-analyze-btn');
  if (btn) btn.disabled = _selectedKeys.size === 0;
}
function _updateSelectionCount() {
  const el = document.getElementById('bugs-selection-count');
  if (el) el.textContent = _selectedKeys.size > 0 ? `${_selectedKeys.size} selected` : '';
}
//# sourceMappingURL=bugs-dashboard.js.map
