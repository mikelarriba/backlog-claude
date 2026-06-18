// ── Bug Dashboard routes — JIRA data pipeline & AI analysis ──────────────────
import { Router } from 'express';
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
let _cache: DashboardCache | null = null;

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

function statusAtDate(issue: Record<string, unknown>, targetDate: Date): string {
  const fields = issue.fields as Record<string, unknown>;
  const created = new Date(fields.created as string);
  if (targetDate < created) return '__not_yet__';

  const resolutionDate = fields.resolutiondate as string | null;
  const currentStatusObj = fields.status as Record<string, unknown>;
  const currentCat =
    ((currentStatusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';

  const changelog = issue.changelog as
    | { histories?: Array<Record<string, unknown>> }
    | undefined;
  if (!changelog?.histories?.length) {
    return statusCatToLabel(currentCat, resolutionDate, targetDate);
  }

  const sorted = [...changelog.histories].sort(
    (a, b) =>
      new Date(a.created as string).getTime() - new Date(b.created as string).getTime()
  );

  let curCat = 'new';
  let curResDate: string | null = null;

  for (const h of sorted) {
    if (new Date(h.created as string) > targetDate) break;
    const items = h.items as Array<Record<string, unknown>>;
    const sc = items.find((i) => i.field === 'status');
    if (sc) {
      curCat = catFromStatusName(sc.toString as string);
      if (curCat === 'done') curResDate = (h.created as string).slice(0, 10);
      else curResDate = null;
    }
  }

  return statusCatToLabel(curCat, curResDate, targetDate);
}

function buildTimeSeries(bugs: unknown[]): WeekPoint[] {
  const now = new Date();
  const points: WeekPoint[] = [];

  for (let i = 12; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(23, 59, 59, 999);

    const pt: WeekPoint = { week: weekLabel(d), Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0, projected: false };
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

function buildStats(bugs: unknown[]): BugStats {
  let open = 0;
  let resolved30d = 0;
  const resolutionDaysList: number[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const bug of bugs) {
    const fields = (bug as Record<string, unknown>).fields as Record<string, unknown>;
    const statusObj = fields.status as Record<string, unknown>;
    const cat =
      ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';
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
    const cat =
      ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? 'new';
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
    };
  });
}

export default function bugsDashboardRoutes({
  JIRA_PROJECT,
  JIRA_LABEL,
  jiraPagedRequest,
  streamClaude,
  logInfo,
  logError,
}: JiraRouteContext) {
  const router = Router();

  // GET /api/bugs/dashboard
  router.get('/api/bugs/dashboard', async (req, res) => {
    try {
      if (!process.env.JIRA_API_TOKEN)
        return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

      const force = req.query.force === 'true';
      const now = Date.now();

      if (!force && _cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return res.json(_cache.data);
      }

      const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND issuetype = "Bug" ORDER BY created ASC`;
      const fields = 'summary,status,priority,created,resolutiondate,fixVersions,labels,assignee';

      logInfo('bugs-dashboard', 'Fetching bugs from JIRA…');
      const bugs = await jiraPagedRequest(jql, fields, {
        maxResults: 100,
        maxTotal: 1000,
        expand: 'changelog',
      });

      const timeSeries = buildTimeSeries(bugs);
      const stats = buildStats(bugs);
      const bugItems = buildBugItems(bugs);
      const cachedAt = new Date().toISOString();

      const data: DashboardData = { timeSeries, bugs: bugItems, stats, cachedAt };
      _cache = { data, fetchedAt: now };

      res.json(data);
    } catch (err) {
      const apiErr = parseApiError(err);
      logError('GET /api/bugs/dashboard', apiErr.message);
      return sendError(res, 500, apiErr.code, apiErr.message);
    }
  });

  // POST /api/bugs/dashboard/analyze
  router.post(
    '/api/bugs/dashboard/analyze',
    validateBody(BugAnalyzeSchema),
    async (req, res) => {
      try {
        if (!process.env.JIRA_API_TOKEN)
          return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

        const { bugKeys } = req.body as { bugKeys: string[] };
        const cachedBugs = _cache?.data?.bugs ?? [];
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

        const prompt = `You are a software development analyst. Analyze these ${selected.length} selected bugs and provide actionable insights:

${bugDetails}

Please provide:
1. Prioritization: Rank bugs by severity/impact and explain the ordering
2. Fix Strategy: Which bugs can be batched or fixed together? Common root causes?
3. Recommendations: Specific next steps for the top 3 most critical bugs
4. Patterns: Any concerning trends or patterns you notice?

Be concise and actionable.`;

        setupSSE(res);
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

        await streamClaude(prompt, (chunk: string) => {
          send({ text: chunk });
        });

        send({ done: true });
        res.end();
      } catch (err) {
        const apiErr = parseApiError(err);
        logError('POST /api/bugs/dashboard/analyze', apiErr.message);
        if (!res.headersSent) {
          return sendError(res, 500, apiErr.code, apiErr.message);
        }
        try {
          res.write(`data: ${JSON.stringify({ error: { code: apiErr.code, message: apiErr.message } })}\n\n`);
          res.end();
        } catch {
          /* response already closed */
        }
      }
    }
  );

  return router;
}
