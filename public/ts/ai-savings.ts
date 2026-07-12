// ── Settings view: AI Time Saved dashboard ────────────────────────────────
import { fetchJSON, postJSON, toggleSection } from './state.js';

interface ChartInstance {
  destroy(): void;
}

interface ChartConstructor {
  new (ctx: HTMLCanvasElement, config: Record<string, unknown>): ChartInstance;
}

export type AiSavingsActionType =
  | 'story_push'
  | 'spike_push'
  | 'bug_create'
  | 'doc_ai_run'
  | 'doc_confluence_modify';

interface AiSavingsEntry {
  id: string;
  timestamp: string;
  action_type: AiSavingsActionType;
  item_count: number;
  jira_keys: string[];
  time_saved_minutes: number;
  notes: string;
}

type AiSavingsRange = 'week' | 'month' | 'all';

const CATEGORY_LABELS: Record<AiSavingsActionType, string> = {
  story_push: 'Stories',
  spike_push: 'Spikes',
  bug_create: 'Bugs',
  doc_ai_run: 'Doc AI',
  doc_confluence_modify: 'Confluence',
};
const CATEGORY_COLORS: Record<AiSavingsActionType, string> = {
  story_push: '#6366f1',
  spike_push: '#10b981',
  bug_create: '#f59e0b',
  doc_ai_run: '#ef4444',
  doc_confluence_modify: '#06b6d4',
};

let _entries: AiSavingsEntry[] = [];
let _chart: ChartInstance | null = null;
let _activeRange: AiSavingsRange = 'all';

export function toggleAiSavingsSection(): void {
  toggleSection('ai-savings-section-body', 'ai-savings-chevron');
}

export async function loadAiSavingsSection(): Promise<void> {
  try {
    const data = (await fetchJSON('/api/ai-savings')) as { entries?: AiSavingsEntry[] };
    _entries = data.entries || [];
    filterAiSavings(_activeRange);
  } catch (e) {
    console.warn('Failed to load AI savings:', (e as Error).message);
  }
}

export function filterAiSavings(range: AiSavingsRange): void {
  _activeRange = range;
  document.querySelectorAll('.ai-savings-tab').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.range === range);
  });
  const filtered = _filterByRange(_entries, range);
  _renderStats(filtered);
  _renderChart(filtered);
}

export async function logAiSaving(
  actionType: AiSavingsActionType,
  itemCount: number,
  jiraKeys: string[] = []
): Promise<void> {
  if (!itemCount || itemCount <= 0) return;
  try {
    await postJSON('/api/ai-savings/log', {
      action_type: actionType,
      item_count: itemCount,
      jira_keys: jiraKeys,
    });
  } catch (e) {
    console.warn('Failed to log AI saving:', (e as Error).message);
  }
}

export function exportAiSavingsPdf(): void {
  window.open('/api/ai-savings/export/pdf', '_blank');
}

export async function exportAiSavingsPptx(): Promise<void> {
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
    console.warn('Failed to export PPTX:', (e as Error).message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _filterByRange(entries: AiSavingsEntry[], range: AiSavingsRange): AiSavingsEntry[] {
  if (range === 'all') return entries;
  const now = Date.now();
  const spanMs = range === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const cutoff = now - spanMs;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

function _renderStats(entries: AiSavingsEntry[]): void {
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

function _weekLabel(date: Date): string {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const weekNum = Math.ceil(date.getDate() / 7);
  return `W${weekNum} ${month}`;
}
function _startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setDate(s.getDate() - 6);
  s.setHours(0, 0, 0, 0);
  return s;
}
function _endOfWeek(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function _renderChart(entries: AiSavingsEntry[]): void {
  const canvas = document.getElementById('ai-savings-chart') as HTMLCanvasElement | null;
  const ChartCtor = (window as unknown as { Chart?: ChartConstructor }).Chart;
  if (!canvas || typeof ChartCtor === 'undefined') return;

  if (_chart) {
    _chart.destroy();
    _chart = null;
  }
  if (!entries.length) return;

  const now = new Date();
  const weeks: Array<{ label: string; start: Date; end: Date }> = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push({ label: _weekLabel(d), start: _startOfWeek(d), end: _endOfWeek(d) });
  }
  const categories = Object.keys(CATEGORY_LABELS) as AiSavingsActionType[];
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

  _chart = new ChartCtor(canvas, {
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
  });
}
