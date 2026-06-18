// ── Bug Dashboard ────────────────────────────────────────────────────────────
import { fetchJSON, streamSSE } from './state.js';

let _chart = null;
let _allBugs = [];
let _filteredBugs = [];
let _selectedKeys = new Set();

export async function loadBugsDashboard(force = false) {
  const refreshBtn = document.getElementById('bugs-refresh-btn');
  const cachedAtEl = document.getElementById('bugs-cached-at');

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '↻ Loading…';
  }

  try {
    const url = force ? '/api/bugs/dashboard?force=true' : '/api/bugs/dashboard';
    const data = await fetchJSON(url);
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
    const wrap = document.getElementById('bugs-chart-wrap');
    if (wrap)
      wrap.innerHTML = `<p class="bugs-error">Failed to load bug data: ${err.message || err}</p>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Refresh';
    }
  }
}

export function refreshBugsDashboard() {
  closeBugsAnalysis();
  loadBugsDashboard(true);
}

export function renderBugsStats(stats) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
  };
  set('bugs-stat-total', stats.total ?? 0);
  set('bugs-stat-open', stats.open ?? 0);
  set('bugs-stat-resolved30d', stats.resolved30d ?? 0);
  set('bugs-stat-avg', stats.avgResolutionDays != null ? `${stats.avgResolutionDays}d` : '—');
}

export function renderBugsChart(timeSeries) {
  const canvas = document.getElementById('bugs-chart');
  if (!canvas || typeof window.Chart === 'undefined') return;

  if (_chart) {
    _chart.destroy();
    _chart = null;
  }

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

  _chart = new window.Chart(canvas, {
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
  });
}

export function renderBugsTable(bugs) {
  const wrap = document.getElementById('bugs-table-wrap');
  if (!wrap) return;

  if (!bugs || bugs.length === 0) {
    wrap.innerHTML = '<p class="bugs-error">No bugs found.</p>';
    _updateAnalyzeButton();
    return;
  }

  const rows = bugs
    .map((b) => {
      const checked = _selectedKeys.has(b.key) ? 'checked' : '';
      const statusClass = _statusClass(b.status);
      const priorityClass = `bugs-priority-${(b.priority || 'medium').toLowerCase()}`;
      const created = b.created ? b.created.slice(0, 10) : '—';
      return `<tr class="${_selectedKeys.has(b.key) ? 'selected' : ''}" data-key="${_esc(b.key)}">
        <td><input type="checkbox" ${checked} onchange="bugToggleKey('${_esc(b.key)}',this.checked)" /></td>
        <td class="bugs-key-cell">${_esc(b.key)}</td>
        <td class="bugs-summary-cell" title="${_esc(b.summary)}">${_esc(b.summary)}</td>
        <td><span class="bugs-status-badge ${statusClass}">${_esc(b.status)}</span></td>
        <td class="${priorityClass}">${_esc(b.priority)}</td>
        <td>${_esc(b.assignee || '—')}</td>
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

export function filterBugsTable() {
  const priority = document.getElementById('bugs-filter-priority')?.value || 'all';
  const status = document.getElementById('bugs-filter-status')?.value || 'all';

  _filteredBugs = _allBugs.filter((b) => {
    const priorityOk = priority === 'all' || (b.priority || '').toLowerCase() === priority;
    const statusOk = status === 'all' || (b.status || '').toLowerCase() === status.toLowerCase();
    return priorityOk && statusOk;
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

export async function analyzeBugs() {
  if (_selectedKeys.size === 0) return;

  const panel = document.getElementById('bugs-analysis-panel');
  const body = document.getElementById('bugs-analysis-body');
  if (!panel || !body) return;

  panel.style.display = '';
  body.innerHTML = '<em>Analyzing…</em>';

  const btn = document.getElementById('bugs-analyze-btn');
  if (btn) btn.disabled = true;

  let markdown = '';
  try {
    await streamSSE(
      '/api/bugs/dashboard/analyze',
      { bugKeys: [..._selectedKeys] },
      {
        onText: (chunk) => {
          markdown += chunk;
          body.innerHTML = typeof marked !== 'undefined' ? marked.parse(markdown) : _esc(markdown);
        },
        onDone: () => {
          if (btn) btn.disabled = false;
        },
        onError: (err) => {
          body.innerHTML = `<p class="bugs-error">Analysis failed: ${_esc(err.message)}</p>`;
          if (btn) btn.disabled = false;
        },
      }
    );
  } catch (err) {
    body.innerHTML = `<p class="bugs-error">Analysis failed: ${_esc(err.message || String(err))}</p>`;
    if (btn) btn.disabled = false;
  }
}

export function closeBugsAnalysis() {
  const panel = document.getElementById('bugs-analysis-panel');
  if (panel) panel.style.display = 'none';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _statusClass(status) {
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  return `bugs-status-${s}`;
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
