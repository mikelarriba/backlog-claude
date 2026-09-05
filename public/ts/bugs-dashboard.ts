// ── Bug Dashboard ────────────────────────────────────────────────────────────
import { streamSSE, renderMarkdown, escHtml, readSSELines } from './state.js';
import { updateChart, type ChartInstance } from './chart-helpers.js';
import { registerChangeActions } from './actions.js';

interface BugEntry {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string | null;
  isProduction?: boolean;
  [key: string]: unknown;
}

interface BugsStats {
  total?: number;
  open?: number;
  resolved30d?: number;
  avgResolutionDays?: number | null;
  [key: string]: unknown;
}

interface BugsTimeSeriesPoint {
  week: string;
  projected?: boolean;
  [key: string]: unknown;
}

interface BugsDashboardData {
  bugs?: BugEntry[];
  stats?: BugsStats;
  timeSeries?: BugsTimeSeriesPoint[];
  cachedAt?: string;
}

interface ProgressChunk {
  type: 'progress';
  message?: string;
  total?: number;
  fetched?: number;
}

interface CompleteChunk {
  type: 'complete';
  data: BugsDashboardData;
}

interface ErrorChunk {
  type: 'error';
  message: string;
  code?: string;
}

type DashboardChunk = ProgressChunk | CompleteChunk | ErrorChunk;

let _chart: ChartInstance | null = null;
let _allBugs: BugEntry[] = [];
let _filteredBugs: BugEntry[] = [];
const _selectedKeys = new Set<string>();
let _includeClosed = false;
let _envFilter: 'all' | 'production' | 'testing' = 'all';
// Whether the right-hand analysis panel is expanded, and whether it holds a
// fresh analysis from this session (vs. a placeholder / last-saved report).
let _analysisOpen = false;
let _hasSessionAnalysis = false;

export async function loadBugsDashboard(force = false): Promise<void> {
  const refreshBtn = document.getElementById('bugs-refresh-btn') as HTMLButtonElement | null;
  const cachedAtEl = document.getElementById('bugs-cached-at');
  const loadingEl = document.getElementById('bugs-loading');
  const loadingMsg = document.getElementById('bugs-loading-message');
  const loadingBar = document.getElementById('bugs-loading-bar') as HTMLElement | null;
  const errorBanner = document.getElementById('bugs-error-banner') as HTMLElement | null;

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
    const result: { data: BugsDashboardData | null } = { data: null };

    await readSSELines(res, (raw) => {
      let parsed: DashboardChunk;
      try {
        parsed = JSON.parse(raw) as DashboardChunk;
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

export function refreshBugsDashboard(): void {
  _setAnalysisOpen(false);
  loadBugsDashboard(true);
}

export function renderBugsStats(stats: BugsStats): void {
  const set = (id: string, val: unknown): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? String(val) : '—';
  };
  set('bugs-stat-total', stats.total ?? 0);
  set('bugs-stat-open', stats.open ?? 0);
  set('bugs-stat-resolved30d', stats.resolved30d ?? 0);
  set('bugs-stat-avg', stats.avgResolutionDays != null ? `${stats.avgResolutionDays}d` : '—');
}

export function renderBugsChart(timeSeries: BugsTimeSeriesPoint[]): void {
  if (!timeSeries?.length) return;
  const canvas = document.getElementById('bugs-chart') as HTMLCanvasElement | null;

  const labels = timeSeries.map((p) => p.week);
  const isProjected = timeSeries.map((p) => !!p.projected);
  const firstProjectedIdx = isProjected.findIndex(Boolean);

  function makeDataset(
    label: string,
    key: string,
    color: string,
    fill: boolean
  ): Record<string, unknown> {
    return {
      label,
      data: timeSeries.map((p) => p[key] ?? 0),
      backgroundColor: color.replace('1)', '0.25)'),
      borderColor: color,
      borderWidth: 2,
      fill,
      tension: 0.3,
      segment: {
        borderDash: (ctx: { p0DataIndex: number }) =>
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

export function renderBugsTable(bugs: BugEntry[]): void {
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
        <td><input type="checkbox" ${checked} data-key="${escHtml(b.key)}" data-change-action="bugToggleKeyChange" /></td>
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
          <th><input type="checkbox" id="bugs-select-all" data-change-action="bugToggleAllChange" /></th>
          <th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Created</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  _syncSelectAllCheckbox();
  _updateAnalyzeButton();
}

export function setBugsEnvFilter(env: 'all' | 'production' | 'testing'): void {
  _envFilter = env;
  document.querySelectorAll('.bugs-env-toggle [data-env]').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.env === env);
  });
  filterBugsTable();
}

export function filterBugsTable(): void {
  const priority =
    (document.getElementById('bugs-filter-priority') as HTMLSelectElement | null)?.value || 'all';
  const status =
    (document.getElementById('bugs-filter-status') as HTMLSelectElement | null)?.value || 'all';

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

export function bugToggleKey(key: string, checked: boolean): void {
  if (checked) _selectedKeys.add(key);
  else _selectedKeys.delete(key);
  _syncRowHighlight(key, checked);
  _syncSelectAllCheckbox();
  _updateAnalyzeButton();
  _updateSelectionCount();
}

export function bugToggleAll(checked: boolean): void {
  if (checked) _filteredBugs.forEach((b) => _selectedKeys.add(b.key));
  else _filteredBugs.forEach((b) => _selectedKeys.delete(b.key));
  renderBugsTable(_filteredBugs);
}

// Wrap bare bug keys in the streamed analysis with links to JIRA so the live
// view matches the saved report (whose keys the server linkifies). Segments
// already inside a markdown link are skipped so keys are never double-wrapped.
function _linkifyBugKeys(text: string, keys: string[], base: string): string {
  const unique = [...new Set(keys)].filter(Boolean);
  if (!base || unique.length === 0) return text;
  const alternation = unique
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const keyRe = new RegExp(`(?<![\\w/-])(${alternation})(?![\\w-])`, 'g');
  const wrap = (segment: string): string =>
    segment.replace(keyRe, (k) => `[${k}](${base}/browse/${k})`);

  const linkRe = /\[[^\]]*\]\([^)]*\)/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(linkRe)) {
    out += wrap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + wrap(text.slice(last));
}

// ── AI analysis progress bar ──────────────────────────────────────────────────
// The visible duration of an analysis run is almost entirely the AI streaming
// its answer. The backend prompt asks for four labelled sections in order, so we
// map each to a progress step and advance as that section's heading appears in
// the streamed markdown — giving an honest, section-aware "what is it doing now".
interface AnalysisStep {
  label: string; // short chip label
  doing: string; // status line shown while this step is active
  match?: RegExp; // heading keyword that marks this section as reached
}

const _ANALYSIS_STEPS: AnalysisStep[] = [
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

function _renderAnalysisProgress(el: HTMLElement, activeIdx: number, done: boolean): void {
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
function _analysisStepFor(markdown: string): number {
  let furthest = 1;
  for (let i = 1; i < _ANALYSIS_STEPS.length; i++) {
    const m = _ANALYSIS_STEPS[i].match;
    if (m && m.test(markdown)) furthest = i;
  }
  return furthest;
}

export async function analyzeBugs(): Promise<void> {
  if (_selectedKeys.size === 0) return;

  const body = document.getElementById('bugs-analysis-body');
  const progress = document.getElementById('bugs-analysis-progress') as HTMLElement | null;
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

  const btn = document.getElementById('bugs-analyze-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;

  // `failed` swaps the progress bar for an error message; success leaves the
  // completed bar in place. The trigger re-enables based on the live selection.
  const finish = (failed?: string): void => {
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
        onText: (chunk: string) => {
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
          const report = payload?.report as { savedAt?: string } | null | undefined;
          if (meta && report?.savedAt) {
            meta.textContent = _formatSavedMeta(report.savedAt, _selectedKeys.size);
          }
          finish();
        },
        onError: (err: Error) => finish(err.message),
      }
    );
  } catch (err) {
    finish((err as Error).message || String(err));
  }
}

// Floating "Last analysis" button: expand or collapse the report panel. Opening
// it with no fresh session analysis pulls the most recent saved report so the
// user can reread it even after a reload.
export async function toggleBugsAnalysis(): Promise<void> {
  if (_analysisOpen) {
    _setAnalysisOpen(false);
    return;
  }
  _setAnalysisOpen(true);
  if (!_hasSessionAnalysis) await loadLatestAnalysis();
}

async function loadLatestAnalysis(): Promise<void> {
  const body = document.getElementById('bugs-analysis-body');
  const meta = document.getElementById('bugs-analysis-meta');
  const progress = document.getElementById('bugs-analysis-progress') as HTMLElement | null;
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
    const report = (await res.json()) as { markdown: string; savedAt: string; bugCount: number };
    body.innerHTML = renderMarkdown(_stripFrontmatter(report.markdown));
    if (meta) meta.textContent = _formatSavedMeta(report.savedAt, report.bugCount);
  } catch (err) {
    if (meta) meta.textContent = '';
    body.innerHTML = `<p class="bugs-error">Could not load last analysis: ${escHtml(
      (err as Error).message
    )}</p>`;
  }
}

function _setAnalysisOpen(open: boolean): void {
  _analysisOpen = open;
  document.getElementById('bugs-workspace')?.classList.toggle('analysis-open', open);
  document.getElementById('bugs-last-analysis-btn')?.classList.toggle('active', open);
}

function _stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function _formatSavedMeta(savedAt: string, bugCount?: number): string {
  const d = savedAt ? new Date(savedAt) : null;
  const when = d && !isNaN(d.getTime()) ? d.toLocaleString() : '';
  const count = bugCount ? `${bugCount} bug${bugCount === 1 ? '' : 's'} · ` : '';
  return when ? `Saved ${count}${when}` : '';
}

export function toggleClosedBugs(checked: boolean): void {
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
// `toggleClosedBugs` function name. bugToggleKeyChange/bugToggleAllChange
// (added later) follow the same "Change" suffix convention for the per-row
// and select-all checkboxes, reusing each row's existing `data-key`
// attribute rather than adding a duplicate one.
registerChangeActions({
  filterBugsTable: () => {
    filterBugsTable();
  },
  toggleClosedBugsChange: (el) => {
    toggleClosedBugs((el as HTMLInputElement).checked);
  },
  bugToggleKeyChange: (el) => {
    const input = el as HTMLInputElement;
    bugToggleKey(input.dataset.key ?? '', input.checked);
  },
  bugToggleAllChange: (el) => {
    bugToggleAll((el as HTMLInputElement).checked);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

class DashboardError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function _showError(err: unknown): void {
  const banner = document.getElementById('bugs-error-banner') as HTMLElement | null;
  const titleEl = document.getElementById('bugs-error-title');
  const detailEl = document.getElementById('bugs-error-detail');
  if (!banner) return;

  const code = err instanceof DashboardError ? err.code || '' : '';
  let title = 'Failed to load bug data';
  let detail = (err as Error)?.message || String(err);

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

export function _statusClass(status: string): string {
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  return `bugs-status-${s}`;
}

function _syncRowHighlight(key: string, selected: boolean): void {
  const row = document.querySelector(`.bugs-table tr[data-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('selected', selected);
}

function _syncSelectAllCheckbox(): void {
  const cb = document.getElementById('bugs-select-all') as HTMLInputElement | null;
  if (!cb) return;
  const total = _filteredBugs.length;
  const sel = _filteredBugs.filter((b) => _selectedKeys.has(b.key)).length;
  cb.checked = total > 0 && sel === total;
  cb.indeterminate = sel > 0 && sel < total;
}

function _updateAnalyzeButton(): void {
  const btn = document.getElementById('bugs-analyze-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = _selectedKeys.size === 0;
}

function _updateSelectionCount(): void {
  const el = document.getElementById('bugs-selection-count');
  if (el) el.textContent = _selectedKeys.size > 0 ? `${_selectedKeys.size} selected` : '';
}
