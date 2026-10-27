// ── Bugs dashboard service — JIRA data pipeline, stats and analysis reports ──
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../utils/fileWrite.js';

export interface WeekPoint {
  week: string;
  Open: number;
  'In Progress': number;
  Resolved: number;
  Closed: number;
  projected: boolean;
}

// The priority levels these bugs actually use, most-severe first. Any other
// priority value is bucketed into the nearest column (see bucketPriority).
export const PRIORITY_ORDER = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'] as const;
export type Priority = (typeof PRIORITY_ORDER)[number];
export type PriorityCounts = Record<Priority, number>;

/** One day's priority breakdown of *open* (unresolved) bugs, over time. */
export interface PriorityPoint extends PriorityCounts {
  week: string;
  projected: boolean;
}

/** Current bug count for one sprint (all statuses). */
export interface SprintCount {
  sprint: string;
  count: number;
}

export interface BugStats {
  total: number;
  open: number;
  resolved30d: number;
  avgResolutionDays: number | null;
}

/**
 * One persisted daily observation of the bug backlog. Counts use each day's
 * *current* JIRA status (same logic as the stat tiles), so the chart built from
 * these always agrees with the tiles — unlike the old per-request changelog
 * replay. Stored one-row-per-day in docs/bug-analysis/history.md.
 */
export interface DaySnapshot {
  date: string; // YYYY-MM-DD
  Open: number;
  'In Progress': number;
  Resolved: number;
  Closed: number;
  // Priority breakdown of that day's *open* (unresolved) bugs. Sums to Open +
  // In Progress. Backs the Priority chart mode.
  priority: PriorityCounts;
}

export interface BugItem {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string;
  resolutionDate: string | null;
  isProduction: boolean;
}

export interface DashboardData {
  timeSeries: WeekPoint[]; // Status mode (by day)
  prioritySeries: PriorityPoint[]; // Priority mode (open bugs by day)
  sprints: SprintCount[]; // Sprint mode (current bug count per sprint)
  bugs: BugItem[];
  stats: BugStats;
  cachedAt: string;
}

export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Small TTL cache holding one value; injectable/resettable so tests need no module state. */
export class TtlCache<T> {
  private entry: { data: T; fetchedAt: number } | null = null;
  constructor(private readonly ttlMs: number = CACHE_TTL_MS) {}

  get(now: number = Date.now()): T | null {
    return this.entry && now - this.entry.fetchedAt < this.ttlMs ? this.entry.data : null;
  }

  set(data: T, now: number = Date.now()): void {
    this.entry = { data, fetchedAt: now };
  }

  clear(): void {
    this.entry = null;
  }
}

/**
 * The dashboard always fetches the full bug set (closed included) so the trend
 * chart can reconstruct real history; the open/closed toggle filters the table
 * client-side. A single cache therefore backs every request.
 */
export function createDashboardCache(): TtlCache<DashboardData> {
  return new TtlCache<DashboardData>();
}

function weekLabel(date: Date): string {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const weekNum = Math.ceil(date.getDate() / 7);
  const yy = String(date.getFullYear()).slice(-2);
  return `W${weekNum} ${month} '${yy}`;
}

function statusCatToLabel(cat: string, resolutionDate: string | null, refDate?: Date): string {
  if (cat === 'new') return 'Open';
  if (cat === 'indeterminate') return 'In Progress';
  if (cat === 'done') {
    if (resolutionDate) {
      const resolved = new Date(resolutionDate);
      const cutoff = new Date((refDate ?? new Date()).getTime() - 30 * 24 * 60 * 60 * 1000);
      return resolved >= cutoff ? 'Resolved' : 'Closed';
    }
    return 'Closed';
  }
  return 'Open';
}

function catFromStatusName(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (n === 'done' || n === 'closed' || n === 'resolved' || n === 'complete' || n === 'completed')
    return 'done';
  if (n === 'in progress' || n === 'in review' || n === 'testing' || n === 'in development')
    return 'indeterminate';
  return 'new';
}

export function statusAtDate(issue: Record<string, unknown>, targetDate: Date): string {
  const fields = issue.fields as Record<string, unknown>;
  const created = new Date(fields.created as string);
  if (targetDate < created) return '__not_yet__';

  const resolutionDate = fields.resolutiondate as string | null;
  const currentStatusObj = fields.status as Record<string, unknown>;
  const currentCat =
    ((currentStatusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';

  const changelog = issue.changelog as { histories?: Array<Record<string, unknown>> } | undefined;
  if (!changelog?.histories?.length) {
    return statusCatToLabel(currentCat, resolutionDate, targetDate);
  }

  const sorted = [...changelog.histories].sort(
    (a, b) => new Date(a.created as string).getTime() - new Date(b.created as string).getTime()
  );

  let curCat = 'new';
  let curResDate: string | null = null;

  for (const h of sorted) {
    if (new Date(h.created as string) > targetDate) break;
    const items = h.items as Array<Record<string, unknown>>;
    const sc = items.find((i) => i.field === 'status');
    if (sc) {
      curCat = catFromStatusName(sc['toString'] as string);
      // Resolved-vs-Closed must key off the bug's real resolutiondate, NOT the
      // date it transitioned into a done status. A bulk status change (e.g. mass
      // "Close" of old tickets) moves many bugs to done on one day while their
      // actual resolutiondate stays months old — keying off the transition date
      // misreported all of them as freshly "Resolved" and inflated the chart.
      curResDate = curCat === 'done' ? resolutionDate : null;
    }
  }

  return statusCatToLabel(curCat, curResDate, targetDate);
}

// Weeks of flat projection drawn past "today". Kept short so the real 12-week
// history isn't dwarfed by a long fabricated flatline (it used to run 52 weeks).
export const PROJECTION_WEEKS = 12;

export function buildTimeSeries(bugs: unknown[]): WeekPoint[] {
  const now = new Date();
  const points: WeekPoint[] = [];

  for (let i = 12; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(23, 59, 59, 999);

    const pt: WeekPoint = {
      week: weekLabel(d),
      Open: 0,
      'In Progress': 0,
      Resolved: 0,
      Closed: 0,
      projected: false,
    };
    for (const bug of bugs) {
      const s = statusAtDate(bug as Record<string, unknown>, d);
      if (s === '__not_yet__') continue;
      if (s in pt) (pt[s as keyof WeekPoint] as number)++;
    }
    points.push(pt);
  }

  // Short, flat projection: hold the current snapshot (all four series) steady
  // for a few weeks. This is a visual continuation, not a velocity forecast —
  // carrying every series forward keeps the stacked total continuous instead of
  // collapsing Resolved/Closed to zero the moment the projection begins.
  const last = points[12];
  const projected = {
    Open: last?.Open ?? 0,
    'In Progress': last?.['In Progress'] ?? 0,
    Resolved: last?.Resolved ?? 0,
    Closed: last?.Closed ?? 0,
  };

  for (let i = 1; i <= PROJECTION_WEEKS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i * 7);
    points.push({ week: weekLabel(d), ...projected, projected: true });
  }

  return points;
}

// ── Daily snapshot history ───────────────────────────────────────────────────
// The chart is driven by persisted daily snapshots rather than reconstructed on
// every request. Each day the dashboard is loaded we record today's current
// status breakdown; older days are read back from docs/bugs/history.md. On the
// very first run (empty history) we seed ~12 weeks from a one-off changelog
// replay so the chart isn't blank while daily records accumulate.

type StatusKey = 'Open' | 'In Progress' | 'Resolved' | 'Closed';

function emptyPriority(): PriorityCounts {
  return { Blocker: 0, Critical: 0, Major: 0, Minor: 0, Trivial: 0 };
}

/** Map any JIRA priority name onto a known column; unknowns fall to Trivial. */
function bucketPriority(name: unknown): Priority {
  const n = typeof name === 'string' ? name.trim() : '';
  return (PRIORITY_ORDER as readonly string[]).includes(n) ? (n as Priority) : 'Trivial';
}

function priorityOf(bug: unknown): Priority {
  const fields = (bug as Record<string, unknown>).fields as Record<string, unknown>;
  return bucketPriority((fields.priority as Record<string, unknown>)?.name);
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `2026-10-21` → `Oct 21`. Parsed component-wise to stay timezone-stable. */
function dayLabel(dateStr: string): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, (m ?? 1) - 1, day ?? 1);
  return `${d.toLocaleString('en-US', { month: 'short' })} ${day}`;
}

/** Today's backlog by current status + open-bug priority — the tiles' logic. */
export function snapshotCounts(
  bugs: unknown[],
  refDate: Date = new Date()
): Omit<DaySnapshot, 'date'> {
  const counts: Record<StatusKey, number> = { Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0 };
  const priority = emptyPriority();
  for (const bug of bugs) {
    const fields = (bug as Record<string, unknown>).fields as Record<string, unknown>;
    const statusObj = fields.status as Record<string, unknown>;
    const cat = ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';
    const label = statusCatToLabel(
      cat,
      fields.resolutiondate as string | null,
      refDate
    ) as StatusKey;
    counts[label]++;
    // Open = not yet done (Open or In Progress labels).
    if (cat !== 'done') priority[priorityOf(bug)]++;
  }
  return { ...counts, priority };
}

/** 13 weekly points (12 weeks back → today) rebuilt once from the changelog. */
export function seedSnapshots(bugs: unknown[], now: Date = new Date()): DaySnapshot[] {
  const out: DaySnapshot[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(23, 59, 59, 999);
    const snap: DaySnapshot = {
      date: isoDate(d),
      Open: 0,
      'In Progress': 0,
      Resolved: 0,
      Closed: 0,
      priority: emptyPriority(),
    };
    for (const bug of bugs) {
      const s = statusAtDate(bug as Record<string, unknown>, d);
      if (s === '__not_yet__') continue;
      if (s in snap) snap[s as StatusKey]++;
      // Historical priority assumes the bug's priority has been stable over time.
      if (s === 'Open' || s === 'In Progress') snap.priority[priorityOf(bug)]++;
    }
    out.push(snap);
  }
  return out;
}

/** Insert or replace the row for `snap.date`, keeping the list date-sorted. */
export function upsertSnapshot(history: DaySnapshot[], snap: DaySnapshot): DaySnapshot[] {
  const rest = history.filter((h) => h.date !== snap.date);
  rest.push(snap);
  rest.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rest;
}

/** Chart series from the snapshot history, with the flat projection appended. */
export function buildTimeSeriesFromSnapshots(history: DaySnapshot[]): WeekPoint[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: WeekPoint[] = sorted.map((s) => ({
    week: dayLabel(s.date),
    Open: s.Open,
    'In Progress': s['In Progress'],
    Resolved: s.Resolved,
    Closed: s.Closed,
    projected: false,
  }));

  const last = sorted[sorted.length - 1];
  if (last) {
    const [y, m, day] = last.date.split('-').map(Number);
    const lastDate = new Date(y, (m ?? 1) - 1, day ?? 1);
    for (let i = 1; i <= PROJECTION_WEEKS; i++) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + i * 7);
      points.push({
        week: dayLabel(isoDate(d)),
        Open: last.Open,
        'In Progress': last['In Progress'],
        Resolved: last.Resolved,
        Closed: last.Closed,
        projected: true,
      });
    }
  }
  return points;
}

/** Priority-mode series (open bugs by priority per day) + flat projection. */
export function buildPrioritySeriesFromSnapshots(history: DaySnapshot[]): PriorityPoint[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: PriorityPoint[] = sorted.map((s) => ({
    week: dayLabel(s.date),
    ...s.priority,
    projected: false,
  }));

  const last = sorted[sorted.length - 1];
  if (last) {
    const [y, m, day] = last.date.split('-').map(Number);
    const lastDate = new Date(y, (m ?? 1) - 1, day ?? 1);
    for (let i = 1; i <= PROJECTION_WEEKS; i++) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + i * 7);
      points.push({ week: dayLabel(isoDate(d)), ...last.priority, projected: true });
    }
  }
  return points;
}

// Sprints shown in the Sprint-mode bar chart (most recent by number).
export const RECENT_SPRINT_COUNT = 12;
// Old GreenHopper sprint field value: "…Sprint@xx[…,name=MIDAS Sprint 106,…]".
const SPRINT_NAME_RE = /name=([^,]+)/;

/** A bug's current sprint = the last sprint listed on the GreenHopper field. */
function currentSprintOf(bug: unknown): string | null {
  const fields = (bug as Record<string, unknown>).fields as Record<string, unknown>;
  const raw = fields.customfield_10004;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const names = raw
    .map((entry) => SPRINT_NAME_RE.exec(String(entry))?.[1]?.trim())
    .filter((n): n is string => Boolean(n));
  return names.length ? names[names.length - 1] : null;
}

// First integer in a sprint name, for ordering ("Sprint 74-75" → 74).
function sprintNumber(name: string): number {
  return Number(name.match(/(\d+)/)?.[1] ?? 0);
}

/** Current bug count per sprint (all statuses), limited to the most recent N. */
export function buildSprintSeries(
  bugs: unknown[],
  limit: number = RECENT_SPRINT_COUNT
): SprintCount[] {
  const counts = new Map<string, number>();
  for (const bug of bugs) {
    const sprint = currentSprintOf(bug);
    if (sprint) counts.set(sprint, (counts.get(sprint) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sprint, count]) => ({ sprint, count }))
    .sort((a, b) => sprintNumber(a.sprint) - sprintNumber(b.sprint))
    .slice(-limit);
}

const HISTORY_HEADER =
  '# Bug Status History\n\n' +
  'One row per day the dashboard was loaded. Status columns cover all bugs;\n' +
  'priority columns (Blocker…Trivial) cover that day’s *open* bugs. Resolved =\n' +
  'done within the prior 30 days. Generated file — safe to delete; it is rebuilt\n' +
  'from a changelog replay on the next load.\n\n';

const HISTORY_COLUMNS =
  '| Date | Open | In Progress | Resolved | Closed | Blocker | Critical | Major | Minor | Trivial | Total |';

export function renderHistory(history: DaySnapshot[]): string {
  const rows = history
    .map((s) => {
      const p = s.priority;
      const total = s.Open + s['In Progress'] + s.Resolved + s.Closed;
      return (
        `| ${s.date} | ${s.Open} | ${s['In Progress']} | ${s.Resolved} | ${s.Closed} | ` +
        `${p.Blocker} | ${p.Critical} | ${p.Major} | ${p.Minor} | ${p.Trivial} | ${total} |`
      );
    })
    .join('\n');
  return (
    HISTORY_HEADER +
    `${HISTORY_COLUMNS}\n` +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    `${rows}\n`
  );
}

// Date + 4 status counts + 5 priority counts (Total is derived, ignored).
const HISTORY_ROW_RE = new RegExp(
  '^\\|\\s*(\\d{4}-\\d{2}-\\d{2})\\s*' + '\\|\\s*(\\d+)\\s*'.repeat(9) + '\\|'
);

export function parseHistory(md: string): DaySnapshot[] {
  const out: DaySnapshot[] = [];
  for (const line of md.split('\n')) {
    const m = HISTORY_ROW_RE.exec(line);
    if (!m) continue;
    out.push({
      date: m[1],
      Open: Number(m[2]),
      'In Progress': Number(m[3]),
      Resolved: Number(m[4]),
      Closed: Number(m[5]),
      priority: {
        Blocker: Number(m[6]),
        Critical: Number(m[7]),
        Major: Number(m[8]),
        Minor: Number(m[9]),
        Trivial: Number(m[10]),
      },
    });
  }
  return out;
}

export async function loadHistory(file: string): Promise<DaySnapshot[]> {
  try {
    return parseHistory(await fs.readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

export async function saveHistory(file: string, history: DaySnapshot[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, renderHistory(history), 'utf8');
}

export function buildStats(bugs: unknown[]): BugStats {
  let open = 0;
  let resolved30d = 0;
  const resolutionDaysList: number[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const bug of bugs) {
    const fields = (bug as Record<string, unknown>).fields as Record<string, unknown>;
    const statusObj = fields.status as Record<string, unknown>;
    const cat = ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';
    const resolutionDate = fields.resolutiondate as string | null;
    const label = statusCatToLabel(cat, resolutionDate);

    if (label === 'Open' || label === 'In Progress') open++;
    if (resolutionDate && new Date(resolutionDate) >= thirtyDaysAgo) resolved30d++;
    if (resolutionDate && fields.created) {
      const days =
        (new Date(resolutionDate).getTime() - new Date(fields.created as string).getTime()) /
        (1000 * 60 * 60 * 24);
      resolutionDaysList.push(days);
    }
  }

  const avgResolutionDays =
    resolutionDaysList.length > 0
      ? Math.round(resolutionDaysList.reduce((a, b) => a + b, 0) / resolutionDaysList.length)
      : null;

  return { total: bugs.length, open, resolved30d, avgResolutionDays };
}

export function buildBugItems(bugs: unknown[]): BugItem[] {
  return bugs.map((bug) => {
    const b = bug as Record<string, unknown>;
    const fields = b.fields as Record<string, unknown>;
    const statusObj = fields.status as Record<string, unknown>;
    const cat = ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';
    const resolutionDate = fields.resolutiondate as string | null;
    const assigneeObj = fields.assignee as Record<string, unknown> | null;
    return {
      key: b.key as string,
      summary: (fields.summary as string) ?? '',
      status: statusCatToLabel(cat, resolutionDate),
      priority: ((fields.priority as Record<string, unknown>)?.name as string) ?? 'Medium',
      assignee: (assigneeObj?.displayName as string) ?? null,
      created: (fields.created as string) ?? '',
      resolutionDate,
      isProduction:
        Array.isArray(fields.labels) && (fields.labels as string[]).includes('MIDAS_SC3'),
    };
  });
}

export type BugProgress = {
  stage: 'connecting' | 'fetching' | 'processing';
  message: string;
  fetched?: number;
  total?: number | null;
};

export interface FetchBugsDeps {
  project: string;
  label: string;
  jiraRequest: (method: string, url: string) => Promise<unknown>;
  logInfo: (scope: string, message: string) => void;
}

// customfield_10004 = JIRA "Sprint" (GreenHopper), backing the Sprint chart mode.
const BUG_FIELDS =
  'summary,status,priority,created,resolutiondate,fixVersions,labels,assignee,customfield_10004';
const PAGE_SIZE = 100;
// Cap on how many bugs we pull. Now that the dashboard fetches the full set
// (closed included) this must comfortably exceed a mature project's bug count,
// or the cap truncates the data. Paired with ORDER BY created DESC below so that
// if the cap *is* hit, the newest bugs — the ones most likely still open and
// most relevant to the recent trend — are kept, not the oldest closed ones.
const MAX_TOTAL = 3000;

/**
 * Paginated JIRA fetch of the label's bugs, reporting progress as it goes. The
 * changelog (needed only to seed the snapshot history on the first-ever load)
 * roughly doubles the payload, so it is fetched only when `withChangelog` is set.
 */
export async function fetchBugs(
  includeClosed: boolean,
  deps: FetchBugsDeps,
  onProgress: (p: BugProgress) => void,
  withChangelog = true
): Promise<unknown[]> {
  const { project, label, jiraRequest, logInfo } = deps;
  onProgress({ stage: 'connecting', message: 'Connecting to JIRA…' });

  const closedFilter = includeClosed ? '' : ' AND statusCategory != Done';
  const jql = `project = ${project} AND labels = ${label} AND issuetype = "Bug"${closedFilter} ORDER BY created DESC`;
  const allBugs: unknown[] = [];
  let startAt = 0;
  let jiraTotal: number | null = null;
  let pageNum = 0;
  // Changelog expansion makes each page far heavier and prone to JIRA's
  // per-request timeout, so seed pages are smaller (more, lighter requests).
  const pageSize = withChangelog ? 50 : PAGE_SIZE;

  logInfo('bugs-dashboard', 'Fetching bugs from JIRA…');

  while (true) {
    pageNum++;
    onProgress({
      stage: 'fetching',
      message: jiraTotal
        ? `Fetching bugs from JIRA… ${allBugs.length}/${jiraTotal} (page ${pageNum})`
        : `Fetching bugs from JIRA… (page ${pageNum})`,
      fetched: allBugs.length,
      total: jiraTotal,
    });

    const expand = withChangelog ? '&expand=changelog' : '';
    const url = `/search?jql=${encodeURIComponent(jql)}&maxResults=${pageSize}&startAt=${startAt}&fields=${encodeURIComponent(BUG_FIELDS)}${expand}`;
    // Retry transient failures (e.g. JIRA's 30s per-request timeout under load),
    // which are common on the heavy changelog seed.
    let page: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        page = (await jiraRequest('GET', url)) as Record<string, unknown>;
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        logInfo('bugs-dashboard', `Page ${pageNum} attempt ${attempt} failed, retrying…`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    const issues = ((page as Record<string, unknown>).issues as unknown[] | undefined) || [];
    allBugs.push(...issues);

    if (jiraTotal === null) jiraTotal = ((page as Record<string, unknown>).total as number) || 0;

    if (
      allBugs.length >= MAX_TOTAL ||
      allBugs.length >= (jiraTotal || 0) ||
      issues.length < pageSize
    )
      break;
    startAt += issues.length;
  }

  const fetched = allBugs.slice(0, MAX_TOTAL);
  logInfo('bugs-dashboard', `Fetched ${fetched.length} bugs from JIRA`);
  return fetched;
}

/** Build the full dashboard payload from raw JIRA issues (changelog-replay series). */
export function buildDashboardData(bugs: unknown[]): DashboardData {
  const seeded = seedSnapshots(bugs);
  return {
    timeSeries: buildTimeSeries(bugs),
    prioritySeries: buildPrioritySeriesFromSnapshots(seeded),
    sprints: buildSprintSeries(bugs),
    bugs: buildBugItems(bugs),
    stats: buildStats(bugs),
    cachedAt: new Date().toISOString(),
  };
}

/** Record today's current-status breakdown into the history (replacing today's row). */
export function recordTodaySnapshot(
  history: DaySnapshot[],
  bugs: unknown[],
  now: Date = new Date()
): DaySnapshot[] {
  const snap: DaySnapshot = { date: isoDate(now), ...snapshotCounts(bugs, now) };
  return upsertSnapshot(history, snap);
}

/** Dashboard payload whose chart series comes from the persisted daily history. */
export function assembleDashboard(bugs: unknown[], history: DaySnapshot[]): DashboardData {
  return {
    timeSeries: buildTimeSeriesFromSnapshots(history),
    prioritySeries: buildPrioritySeriesFromSnapshots(history),
    sprints: buildSprintSeries(bugs),
    bugs: buildBugItems(bugs),
    stats: buildStats(bugs),
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Resolve the cached bugs matching `bugKeys` from the dashboard cache.
 * Returns `null` when the cache is stale (the caller must ask for a reload).
 */
export function selectCachedBugs(
  cache: TtlCache<DashboardData>,
  bugKeys: string[]
): BugItem[] | null {
  const fresh = cache.get();
  if (!fresh) return null;
  return fresh.bugs.filter((b) => bugKeys.includes(b.key));
}

/** Build the Claude prompt for analysing a set of selected bugs. */
export function buildAnalysisPrompt(selected: BugItem[]): string {
  const bugDetails = selected
    .map(
      (b) =>
        `- ${b.key}: ${b.summary} [${b.status}] Priority: ${b.priority}` +
        (b.assignee ? ` Assignee: ${b.assignee}` : '') +
        (b.resolutionDate ? ` (Resolved: ${b.resolutionDate.slice(0, 10)})` : '')
    )
    .join('\n');

  return `You are a software development analyst. Analyze these ${selected.length} selected bugs and provide actionable insights:\n\n${bugDetails}\n\nPlease provide:\n1. Prioritization: Rank bugs by severity/impact and explain the ordering\n2. Fix Strategy: Which bugs can be batched or fixed together? Common root causes?\n3. Recommendations: Specific next steps for the top 3 most critical bugs\n4. Patterns: Any concerning trends or patterns you notice?\n\nBe concise and actionable.`;
}

// ── AI analysis report persistence ──────────────────────────────────────────
// Each analysis run is written to its own timestamped markdown file under
// docs/bug-analysis/ so the history is preserved on disk and the UI can reopen
// the most recent report at any time (even after a reload). docs/ is gitignored
// runtime data, so these reports never reach the remote.
export interface SavedReport {
  filename: string;
  savedAt: string;
  bugKeys: string[];
  bugCount: number;
  markdown: string;
}

function reportTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Pipes and newlines would break a one-row-per-bug markdown table cell.
function cell(v: string): string {
  return (v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

// Wrap bare bug keys in the AI-written analysis with links to JIRA. The AI
// refers to bugs by key as plain text (e.g. "MIDAS-123"); this turns each
// mention into `[MIDAS-123](…/browse/MIDAS-123)`. Segments already inside a
// markdown link (the Analyzed Bugs table) are left untouched so keys are never
// double-wrapped.
function linkifyBugKeys(text: string, keys: string[], jiraBase: string): string {
  const unique = [...new Set(keys)].filter(Boolean);
  if (!jiraBase || unique.length === 0) return text;
  // Longest-first so overlapping prefixes (MIDAS-1 vs MIDAS-12) match greedily.
  const alternation = unique
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const keyRe = new RegExp(`(?<![\\w/-])(${alternation})(?![\\w-])`, 'g');
  const wrap = (segment: string): string =>
    segment.replace(keyRe, (k) => `[${k}](${jiraBase}/browse/${k})`);

  const linkRe = /\[[^\]]*\]\([^)]*\)/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(linkRe)) {
    out += wrap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + wrap(text.slice(last));
}

function buildReportMarkdown(
  bugs: BugItem[],
  analysis: string,
  jiraBase: string,
  generatedAt: Date
): string {
  const keys = bugs.map((b) => b.key);
  const human = generatedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const rows = bugs
    .map((b) => {
      const link = `[${b.key}](${jiraBase}/browse/${b.key})`;
      return `| ${link} | ${cell(b.summary)} | ${cell(b.status)} | ${cell(b.priority)} | ${cell(b.assignee || '—')} |`;
    })
    .join('\n');

  return (
    `---\n` +
    `Generated: ${generatedAt.toISOString()}\n` +
    `Bug_Count: ${bugs.length}\n` +
    `Bug_Keys: ${keys.join(', ')}\n` +
    `---\n\n` +
    `# 🐛 AI Bug Analysis — ${human}\n\n` +
    `Analyzed **${bugs.length}** bug${bugs.length === 1 ? '' : 's'}.\n\n` +
    `## Analyzed Bugs\n\n` +
    `| Key | Summary | Status | Priority | Assignee |\n` +
    `| --- | --- | --- | --- | --- |\n` +
    `${rows}\n\n` +
    `---\n\n` +
    `${linkifyBugKeys(analysis.trim(), keys, jiraBase)}\n`
  );
}

export async function saveReport(
  dir: string,
  bugs: BugItem[],
  analysis: string,
  jiraBase: string
): Promise<{ filename: string; savedAt: string }> {
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const filename = `${reportTimestamp(now)}-analysis.md`;
  const markdown = buildReportMarkdown(bugs, analysis, jiraBase, now);
  await writeFileAtomic(path.join(dir, filename), markdown, 'utf8');
  return { filename, savedAt: now.toISOString() };
}

// Newest report on disk. Filenames are timestamped so a descending sort of the
// *-analysis.md files yields the most recent without stat-ing every file.
export async function loadLatestReport(dir: string): Promise<SavedReport | null> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const reports = names.filter((n) => n.endsWith('-analysis.md')).sort();
  const filename = reports[reports.length - 1];
  if (!filename) return null;

  const raw = await fs.readFile(path.join(dir, filename), 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const front = fm ? fm[1] : '';
  const get = (k: string): string =>
    front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const bugKeysRaw = get('Bug_Keys');
  return {
    filename,
    savedAt: get('Generated'),
    bugKeys: bugKeysRaw
      ? bugKeysRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    bugCount: Number(get('Bug_Count')) || 0,
    markdown: raw,
  };
}
