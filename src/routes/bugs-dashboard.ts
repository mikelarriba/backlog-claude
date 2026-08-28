// ── Bug Dashboard routes — JIRA data pipeline & AI analysis ──────────────────
import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sendError, setupSSE, parseApiError } from '../utils/routeHelpers.js';
import { validateBody } from '../utils/validateMiddleware.js';
import { BugAnalyzeSchema } from '../schemas/bugs-dashboard.js';
import type { JiraRouteContext } from '../types.js';

interface WeekPoint {
  week: string;
  Open: number;
  'In Progress': number;
  Resolved: number;
  Closed: number;
  projected: boolean;
}

interface BugStats {
  total: number;
  open: number;
  resolved30d: number;
  avgResolutionDays: number | null;
}

interface BugItem {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string;
  resolutionDate: string | null;
  isProduction: boolean;
}

interface DashboardData {
  timeSeries: WeekPoint[];
  bugs: BugItem[];
  stats: BugStats;
  cachedAt: string;
}

interface DashboardCache {
  data: DashboardData;
  fetchedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let _cacheOpen: DashboardCache | null = null;
let _cacheAll: DashboardCache | null = null;

function weekLabel(date: Date): string {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const weekNum = Math.ceil(date.getDate() / 7);
  return `W${weekNum} ${month}`;
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
      if (curCat === 'done') curResDate = (h.created as string).slice(0, 10);
      else curResDate = null;
    }
  }

  return statusCatToLabel(curCat, curResDate, targetDate);
}

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

  const currentOpen = points[12]?.Open ?? 0;
  const currentInProgress = points[12]?.['In Progress'] ?? 0;

  for (let i = 1; i <= 52; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i * 7);
    points.push({
      week: weekLabel(d),
      Open: currentOpen,
      'In Progress': currentInProgress,
      Resolved: 0,
      Closed: 0,
      projected: true,
    });
  }

  return points;
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

function buildBugItems(bugs: unknown[]): BugItem[] {
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

// ── AI analysis report persistence ──────────────────────────────────────────
// Each analysis run is written to its own timestamped markdown file under
// docs/bug-analysis/ so the history is preserved on disk and the UI can reopen
// the most recent report at any time (even after a reload). docs/ is gitignored
// runtime data, so these reports never reach the remote.
interface SavedReport {
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
    `${analysis.trim()}\n`
  );
}

async function saveReport(
  dir: string,
  bugs: BugItem[],
  analysis: string,
  jiraBase: string
): Promise<{ filename: string; savedAt: string }> {
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const filename = `${reportTimestamp(now)}-analysis.md`;
  const markdown = buildReportMarkdown(bugs, analysis, jiraBase, now);
  await fs.writeFile(path.join(dir, filename), markdown, 'utf8');
  return { filename, savedAt: now.toISOString() };
}

// Newest report on disk. Filenames are timestamped so a descending sort of the
// *-analysis.md files yields the most recent without stat-ing every file.
async function loadLatestReport(dir: string): Promise<SavedReport | null> {
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

export default function bugsDashboardRoutes({
  JIRA_PROJECT,
  JIRA_LABEL,
  JIRA_BASE,
  BUGS_DIR,
  jiraRequest,
  streamClaude,
  logInfo,
  logError,
}: JiraRouteContext) {
  const router = Router();
  // Sibling of docs/bugs/ — e.g. docs/bug-analysis/.
  const ANALYSIS_DIR = path.join(path.dirname(BUGS_DIR), 'bug-analysis');

  // GET /api/bugs/dashboard — SSE streaming with progress events
  router.get('/api/bugs/dashboard', async (_req, res) => {
    setupSSE(res);
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    try {
      if (!process.env.JIRA_API_TOKEN) {
        send({
          type: 'error',
          code: 'JIRA_NOT_CONFIGURED',
          message:
            'JIRA API token not configured. Set the JIRA_API_TOKEN environment variable to connect to JIRA.',
        });
        return res.end();
      }

      const force = _req.query.force === 'true';
      const includeClosed = _req.query.includeClosed === 'true';
      const now = Date.now();

      // Check cache (separate caches for open-only vs all bugs)
      const cache = includeClosed ? _cacheAll : _cacheOpen;
      if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        send({ type: 'progress', stage: 'cache', message: 'Using cached data…' });
        send({ type: 'complete', data: cache.data });
        return res.end();
      }

      // Paginated fetch with progress
      send({ type: 'progress', stage: 'connecting', message: 'Connecting to JIRA…' });

      const closedFilter = includeClosed ? '' : ' AND statusCategory != Done';
      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND issuetype = "Bug"${closedFilter} ORDER BY created ASC`;
      const fields = 'summary,status,priority,created,resolutiondate,fixVersions,labels,assignee';
      const maxResults = 100;
      const maxTotal = 1000;
      const allBugs: unknown[] = [];
      let startAt = 0;
      let jiraTotal: number | null = null;
      let pageNum = 0;

      logInfo('bugs-dashboard', 'Fetching bugs from JIRA…');

      while (true) {
        pageNum++;
        const progressMsg = jiraTotal
          ? `Fetching bugs from JIRA… ${allBugs.length}/${jiraTotal} (page ${pageNum})`
          : `Fetching bugs from JIRA… (page ${pageNum})`;
        send({
          type: 'progress',
          stage: 'fetching',
          message: progressMsg,
          fetched: allBugs.length,
          total: jiraTotal,
        });

        const url = `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&startAt=${startAt}&fields=${encodeURIComponent(fields)}&expand=changelog`;
        const page = (await jiraRequest('GET', url)) as Record<string, unknown>;
        const issues = (page.issues as unknown[] | undefined) || [];
        allBugs.push(...issues);

        if (jiraTotal === null) jiraTotal = (page.total as number) || 0;

        if (
          allBugs.length >= maxTotal ||
          allBugs.length >= (jiraTotal || 0) ||
          issues.length < maxResults
        )
          break;
        startAt += issues.length;
      }

      const fetchedBugs = allBugs.slice(0, maxTotal);
      logInfo('bugs-dashboard', `Fetched ${fetchedBugs.length} bugs from JIRA`);

      send({
        type: 'progress',
        stage: 'processing',
        message: `Processing ${fetchedBugs.length} bugs…`,
        fetched: fetchedBugs.length,
        total: fetchedBugs.length,
      });

      const timeSeries = buildTimeSeries(fetchedBugs);
      const stats = buildStats(fetchedBugs);
      const bugItems = buildBugItems(fetchedBugs);
      const cachedAt = new Date().toISOString();

      const data: DashboardData = { timeSeries, bugs: bugItems, stats, cachedAt };
      if (includeClosed) _cacheAll = { data, fetchedAt: now };
      else _cacheOpen = { data, fetchedAt: now };

      send({ type: 'complete', data });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/bugs/dashboard', apiErr.message);
      try {
        send({ type: 'error', code: apiErr.code, message: apiErr.message });
        res.end();
      } catch {
        /* response already closed */
      }
    }
  });

  // POST /api/bugs/dashboard/analyze
  router.post('/api/bugs/dashboard/analyze', validateBody(BugAnalyzeSchema), async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const { bugKeys } = req.body as { bugKeys: string[] };

      // Apply the same freshness check the GET route uses for cache reuse —
      // without it this route could silently analyze arbitrarily stale
      // status/resolution/assignee data (#540).
      const now = Date.now();
      const freshOpen = _cacheOpen && now - _cacheOpen.fetchedAt < CACHE_TTL_MS ? _cacheOpen : null;
      const freshAll = _cacheAll && now - _cacheAll.fetchedAt < CACHE_TTL_MS ? _cacheAll : null;
      if (!freshOpen && !freshAll) {
        return sendError(
          res,
          400,
          'STALE_CACHE',
          'Dashboard data is stale — reload the dashboard before analyzing.'
        );
      }

      const cachedBugs = [...(freshOpen?.data?.bugs ?? []), ...(freshAll?.data?.bugs ?? [])].filter(
        (b, i, arr) => arr.findIndex((x) => x.key === b.key) === i
      );
      const selected = cachedBugs.filter((b) => bugKeys.includes(b.key));

      if (selected.length === 0)
        return sendError(
          res,
          400,
          'NO_BUGS_FOUND',
          'None of the specified bug keys were found. Load the dashboard first.'
        );

      const bugDetails = selected
        .map(
          (b) =>
            `- ${b.key}: ${b.summary} [${b.status}] Priority: ${b.priority}` +
            (b.assignee ? ` Assignee: ${b.assignee}` : '') +
            (b.resolutionDate ? ` (Resolved: ${b.resolutionDate.slice(0, 10)})` : '')
        )
        .join('\n');

      const prompt = `You are a software development analyst. Analyze these ${selected.length} selected bugs and provide actionable insights:\n\n${bugDetails}\n\nPlease provide:\n1. Prioritization: Rank bugs by severity/impact and explain the ordering\n2. Fix Strategy: Which bugs can be batched or fixed together? Common root causes?\n3. Recommendations: Specific next steps for the top 3 most critical bugs\n4. Patterns: Any concerning trends or patterns you notice?\n\nBe concise and actionable.`;

      setupSSE(res);
      const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      let fullText = '';
      await streamClaude(prompt, (chunk: string) => {
        fullText += chunk;
        send({ text: chunk });
      });

      // Persist the completed analysis (with JIRA links) so it can be reopened
      // later. A save failure must not fail the request — the user already has
      // the streamed result — so it's logged and reported as report: null.
      let report: { filename: string; savedAt: string } | null = null;
      try {
        report = await saveReport(ANALYSIS_DIR, selected, fullText, JIRA_BASE);
        logInfo('bugs-dashboard', `Saved analysis report ${report.filename}`);
      } catch (saveErr) {
        logError('POST /api/bugs/dashboard/analyze (save)', parseApiError(saveErr).message);
      }

      send({ done: true, report });
      res.end();
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('POST /api/bugs/dashboard/analyze', apiErr.message);
      if (!res.headersSent) {
        return sendError(res, 500, apiErr.code, apiErr.message);
      }
      try {
        res.write(
          `data: ${JSON.stringify({ error: { code: apiErr.code, message: apiErr.message } })}\n\n`
        );
        res.end();
      } catch {
        /* response already closed */
      }
    }
  });

  // GET /api/bugs/dashboard/analyses/latest — most recent saved analysis report.
  // Backs the "expand last analysis" floating button, which can reopen a report
  // even after a page reload or server restart.
  router.get('/api/bugs/dashboard/analyses/latest', async (_req, res) => {
    try {
      const report = await loadLatestReport(ANALYSIS_DIR);
      if (!report) return sendError(res, 404, 'NO_REPORT', 'No saved analysis reports yet.');
      res.json(report);
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/bugs/dashboard/analyses/latest', apiErr.message);
      sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  return router;
}
