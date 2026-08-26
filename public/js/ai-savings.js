// ── Settings view: AI Time Saved dashboard ────────────────────────────────
import { fetchJSON, postJSON, toggleSection } from './state.js';
import { updateChart } from './chart-helpers.js';
const CATEGORY_LABELS = {
  story_push: 'Stories',
  spike_push: 'Spikes',
  bug_create: 'Bugs',
  doc_ai_run: 'Doc AI',
  doc_confluence_modify: 'Confluence',
  description_generate: 'Descriptions',
  issue_upgrade: 'Upgrades',
  epic_refine: 'Epic Refine',
};
const CATEGORY_COLORS = {
  story_push: '#6366f1',
  spike_push: '#10b981',
  bug_create: '#f59e0b',
  doc_ai_run: '#ef4444',
  doc_confluence_modify: '#06b6d4',
  description_generate: '#ec4899',
  issue_upgrade: '#14b8a6',
  epic_refine: '#f97316',
};
let _entries = [];
let _chart = null;
let _activeRange = 'all';
export function toggleAiSavingsSection() {
  toggleSection('ai-savings-section-body', 'ai-savings-chevron');
}
export async function loadAiSavingsSection() {
  try {
    const data = await fetchJSON('/api/ai-savings');
    _entries = data.entries || [];
    filterAiSavings(_activeRange);
    renderSidebarSavings(_entries);
  } catch (e) {
    console.warn('Failed to load AI savings:', e.message);
  }
}
// ── Sidebar compact widget (non-interactive) ──────────────────────────────
// Loaded once at app start; also refreshed whenever the Settings panel loads.
export async function loadSidebarSavings() {
  if (!document.getElementById('sidebar-savings')) return;
  try {
    const data = await fetchJSON('/api/ai-savings');
    _entries = data.entries || [];
    renderSidebarSavings(_entries);
  } catch (e) {
    console.warn('Failed to load sidebar AI savings:', e.message);
  }
}
let _sidebarChart = null;
function renderSidebarSavings(entries) {
  const wrap = document.getElementById('sidebar-savings');
  if (!wrap) return;
  const totalMinutes = entries.reduce((sum, e) => sum + (e.time_saved_minutes || 0), 0);
  const totalItems = entries.reduce((sum, e) => sum + (e.item_count || 0), 0);
  const hoursEl = document.getElementById('sb-savings-hours');
  if (hoursEl) hoursEl.textContent = `${(totalMinutes / 60).toFixed(1)}h`;
  const itemsEl = document.getElementById('sb-savings-items');
  if (itemsEl) itemsEl.textContent = String(totalItems);
  _renderSidebarChart(entries);
}
function _renderSidebarChart(entries) {
  const canvas = document.getElementById('sidebar-savings-chart');
  // Last 4 weeks of total hours saved (single series).
  const now = new Date();
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push({ label: _weekLabel(d), start: _startOfWeek(d), end: _endOfWeek(d) });
  }
  const values = weeks.map((w) =>
    entries
      .filter((e) => {
        const t = new Date(e.timestamp);
        return t >= w.start && t <= w.end;
      })
      .reduce((sum, e) => sum + (e.time_saved_minutes || 0) / 60, 0)
  );
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#6366f1';
  const muted = css.getPropertyValue('--muted').trim() || '#9ca3af';
  _sidebarChart = updateChart(canvas, _sidebarChart, () => ({
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.label),
      datasets: [{ data: values, backgroundColor: accent, borderRadius: 3, maxBarThickness: 20 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      events: [], // non-interactive: no hover/tooltip/click
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          ticks: { font: { size: 9 }, color: muted },
          grid: { display: false },
          border: { display: false },
        },
        y: { display: false, beginAtZero: true },
      },
    },
  }));
}
export function filterAiSavings(range) {
  _activeRange = range;
  document.querySelectorAll('.ai-savings-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.range === range);
  });
  const filtered = _filterByRange(_entries, range);
  _renderStats(filtered);
  _renderChart(filtered);
}
export async function logAiSaving(actionType, itemCount, jiraKeys = []) {
  if (!itemCount || itemCount <= 0) return;
  try {
    await postJSON('/api/ai-savings/log', {
      action_type: actionType,
      item_count: itemCount,
      jira_keys: jiraKeys,
    });
  } catch (e) {
    console.warn('Failed to log AI saving:', e.message);
  }
}
export function exportAiSavingsPdf() {
  window.open('/api/ai-savings/export/pdf', '_blank');
}
export async function exportAiSavingsPptx() {
  try {
    const res = await fetch('/api/ai-savings/export/pptx');
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-time-saved-report.pptx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn('Failed to export PPTX:', e.message);
  }
}
// ── Helpers ───────────────────────────────────────────────────────────────
// Pure: keep only entries whose timestamp falls within `range` of now.
// 'all' is a no-op pass-through; 'week'/'month' use fixed-width windows
// (7/30 days) measured back from Date.now() at call time.
export function _filterByRange(entries, range) {
  if (range === 'all') return entries;
  const now = Date.now();
  const spanMs = range === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const cutoff = now - spanMs;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}
function _renderStats(entries) {
  const wrap = document.getElementById('ai-savings-stats');
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML = '<p class="ai-savings-empty">No actions logged yet.</p>';
    return;
  }
  const totalMinutes = entries.reduce((sum, e) => sum + (e.time_saved_minutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const totalItems = entries.reduce((sum, e) => sum + (e.item_count || 0), 0);
  wrap.innerHTML = `
    <div class="ai-savings-stat-card">
      <div class="ai-savings-stat-value">${totalHours}h</div>
      <div class="ai-savings-stat-label">Time Saved</div>
    </div>
    <div class="ai-savings-stat-card">
      <div class="ai-savings-stat-value">${totalItems}</div>
      <div class="ai-savings-stat-label">Items Processed</div>
    </div>
  `;
}
// Pure: label a week by the calendar week-of-month its anchor date falls
// in, e.g. "W3 Aug" for the 15th-21st of August. Week-of-month (not
// week-of-year) so the label stays short in the chart's x-axis.
export function _weekLabel(date) {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const weekNum = Math.ceil(date.getDate() / 7);
  return `W${weekNum} ${month}`;
}
// Pure: start of the 7-day window ending on `d` (d minus 6 days, midnight).
export function _startOfWeek(d) {
  const s = new Date(d);
  s.setDate(s.getDate() - 6);
  s.setHours(0, 0, 0, 0);
  return s;
}
// Pure: end of the day containing `d` (23:59:59.999).
export function _endOfWeek(d) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}
function _renderChart(entries) {
  const canvas = document.getElementById('ai-savings-chart');
  _chart = updateChart(canvas, _chart, () => {
    if (!entries.length) return null;
    const now = new Date();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      weeks.push({ label: _weekLabel(d), start: _startOfWeek(d), end: _endOfWeek(d) });
    }
    const categories = Object.keys(CATEGORY_LABELS);
    const datasets = categories.map((cat) => ({
      label: CATEGORY_LABELS[cat],
      data: weeks.map((w) =>
        entries
          .filter((e) => {
            if (e.action_type !== cat) return false;
            const t = new Date(e.timestamp);
            return t >= w.start && t <= w.end;
          })
          .reduce((sum, e) => sum + (e.time_saved_minutes || 0) / 60, 0)
      ),
      backgroundColor: CATEGORY_COLORS[cat],
    }));
    return {
      type: 'bar',
      data: { labels: weeks.map((w) => w.label), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        },
        scales: {
          x: { stacked: true, ticks: { font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 } } },
        },
      },
    };
  });
}
//# sourceMappingURL=ai-savings.js.map
