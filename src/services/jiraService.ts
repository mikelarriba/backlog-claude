import fs from 'fs';
import path from 'path';
import { jiraToMarkdown, extractFrontmatterField, stripFrontmatter } from '../utils/transforms.js';
import type { TypeConfig, DocIndexInstance } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export const LOCAL_TO_JIRA_TYPE: Record<string, string> = {
  feature: 'New Feature',
  epic: 'Epic',
  story: 'Story',
  spike: 'Task',
  bug: 'Bug',
};
export const JIRA_TO_LOCAL_TYPE: Record<string, string> = {
  'New Feature': 'feature',
  Epic: 'epic',
  Story: 'story',
  Improvement: 'story',
  Task: 'spike',
  Bug: 'bug',
};

const JIRA_TIMEOUT_MS = config.JIRA_TIMEOUT_MS;

interface JiraServiceConfig {
  JIRA_BASE: string;
  JIRA_TOKEN: string;
  FIELD_EPIC_NAME: string;
  FIELD_STORY_POINTS: string;
  TYPE_CONFIG: TypeConfig;
  isoDate: () => string;
  slugify: (text: string) => string;
}

export interface JiraServiceInstance {
  jiraRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>;
  jiraPagedRequest: (
    jql: string,
    fields: string,
    opts?: { maxResults?: number; maxTotal?: number; expand?: string }
  ) => Promise<unknown[]>;
  jiraAgileRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>;
  jiraUploadAttachment: (issueKey: string, filename: string, buffer: Buffer) => Promise<unknown>;
  findLocalFileByJiraId: (jiraId: string) => Promise<{ docType: string; filename: string } | null>;
  jiraIssueToMarkdown: (issue: unknown) => { docType: string; content: string };
  extractJiraSummary: (content: string) => string;
}

// ── Shared sprint-ID cache (JIRA Agile API) ─────────────────────────────────
// Single cache shared by jira-push-doc and jira-push-sprints routes so both
// always see the same sprint data instead of holding independent, potentially
// disagreeing copies.
let _sprintCache: { map: Map<string, number>; fetchedAt: number } | null = null;

export interface JiraBoardSprint {
  id: number;
  name: string;
  state?: string;
  startDate?: string;
  endDate?: string;
}

// Fetches the full, paginated list of active+future sprints for a board. This
// is the shared pagination loop behind both ensureSprintCache (which reduces
// it to a name→id Map for jira-push-sprints' lookup needs) and the
// GET /api/jira/board-sprints endpoint (which needs the full sprint objects —
// id, name, state, startDate, endDate — for frontend auto-suggest). Not cached
// itself; ensureSprintCache layers its own TTL cache on top for its
// high-frequency caller.
export async function fetchBoardSprints(
  jiraAgileRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>,
  boardId: string
): Promise<JiraBoardSprint[]> {
  const sprints: JiraBoardSprint[] = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const data = (await jiraAgileRequest(
      'GET',
      `/board/${boardId}/sprint?state=active,future&maxResults=${maxResults}&startAt=${startAt}`
    )) as Record<string, unknown>;
    const page = (data.values as JiraBoardSprint[]) || [];
    sprints.push(...page);
    if (data.isLast !== false || page.length < maxResults) break;
    startAt += page.length;
  }
  return sprints;
}

export async function ensureSprintCache(
  jiraAgileRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>,
  boardId: string,
  ttlMs: number = config.JIRA_SPRINT_CACHE_TTL_MS
): Promise<Map<string, number>> {
  if (_sprintCache && Date.now() - _sprintCache.fetchedAt < ttlMs) {
    return _sprintCache.map;
  }
  const rawSprints = await fetchBoardSprints(jiraAgileRequest, boardId);
  const map = new Map<string, number>();
  for (const s of rawSprints) {
    if (s.name && s.id) map.set(s.name, s.id);
  }
  _sprintCache = { map, fetchedAt: Date.now() };
  return map;
}

// ── Shared "contains" link-type cache ───────────────────────────────────────
// Single cache for the JIRA issue-link type used to link epics to features.
let _containsLinkType: { name: string; fetchedAt: number } | null = null;

export async function getContainsLinkTypeName(
  jiraRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>,
  logWarn: Logger['logWarn'],
  ttlMs: number = config.JIRA_LINKTYPE_CACHE_TTL_MS
): Promise<string | null> {
  if (_containsLinkType && Date.now() - _containsLinkType.fetchedAt < ttlMs) {
    return _containsLinkType.name;
  }
  try {
    const data = (await jiraRequest('GET', '/issueLinkType')) as {
      issueLinkTypes?: Array<{ name: string; inward: string; outward: string }>;
    };
    const types = data.issueLinkTypes || [];
    const match = types.find(
      (t) => /contain/i.test(t.name) || /contain/i.test(t.inward) || /contain/i.test(t.outward)
    );
    if (match) {
      _containsLinkType = { name: match.name, fetchedAt: Date.now() };
      return match.name;
    }
    logWarn(
      'jira/push',
      `No "contains" link type found in JIRA. Available: ${types.map((t) => t.name).join(', ')}`
    );
    return null;
  } catch (e) {
    logWarn(
      'jira/push',
      `Could not fetch JIRA link types: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

// ── Shared parent-JIRA-ID resolver ──────────────────────────────────────────
// Reads a parent doc file from disk and extracts its JIRA_ID, returning null if
// the file doesn't exist or has no linked JIRA issue yet (still 'TBD'). Used to
// resolve Epic Link / "contains" link targets without repeating the inline
// read-then-extract idiom at every call site.
export async function resolveParentJiraId(dir: string, filename: string): Promise<string | null> {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return null;
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const jiraId = extractFrontmatterField(content, 'JIRA_ID');
  return jiraId && jiraId !== 'TBD' ? jiraId : null;
}

// ── Shared epic-link resolver ────────────────────────────────────────────────
// Reads a story/spike/bug's Epic_ID frontmatter field and resolves the parent
// Epic's JIRA key, if any. `epicFilename` is returned separately from
// `epicJiraId` so callers can distinguish "no Epic_ID set" from "Epic_ID set
// but the epic isn't in JIRA yet" — the two cases are handled differently at
// call sites (e.g. whether to clear an existing Epic Link in JIRA).
export async function resolveEpicLink(
  content: string,
  EPICS_DIR: string
): Promise<{ epicFilename: string | null; epicJiraId: string | null }> {
  const epicFilename = extractFrontmatterField(content, 'Epic_ID');
  if (!epicFilename || epicFilename === 'TBD') return { epicFilename: null, epicJiraId: null };
  const epicJiraId = await resolveParentJiraId(EPICS_DIR, epicFilename);
  return { epicFilename, epicJiraId };
}

// ── Shared "contains" link sync (epic → feature) ─────────────────────────────
// Best-effort and idempotent: JIRA errors if the link already exists, which is
// swallowed and logged rather than failing the whole push.
export async function syncContainsLink(
  content: string,
  type: string,
  key: string,
  FEATURES_DIR: string,
  jiraRequest: (method: string, urlPath: string, body?: unknown) => Promise<unknown>,
  logWarn: Logger['logWarn']
): Promise<void> {
  if (type !== 'epic') return;
  const featureFilename = extractFrontmatterField(content, 'Feature_ID');
  if (!featureFilename || featureFilename === 'TBD') return;
  const featureJiraId = await resolveParentJiraId(FEATURES_DIR, featureFilename);
  if (!featureJiraId) return;
  const linkTypeName = await getContainsLinkTypeName(jiraRequest, logWarn);
  if (!linkTypeName) return;
  await jiraRequest('POST', '/issueLink', {
    type: { name: linkTypeName },
    inwardIssue: { key },
    outwardIssue: { key: featureJiraId },
  }).catch((e) =>
    logWarn(
      'jira/push',
      `Could not create "${linkTypeName}" link: ${e instanceof Error ? e.message : String(e)}`
    )
  );
}

export function createJiraService({
  JIRA_BASE,
  JIRA_TOKEN,
  FIELD_EPIC_NAME: _FIELD_EPIC_NAME,
  FIELD_STORY_POINTS,
  TYPE_CONFIG,
  isoDate,
  slugify: _slugify,
}: JiraServiceConfig): JiraServiceInstance {
  async function _jiraFetch(
    fullUrl: string,
    method: string,
    body: unknown,
    label: string
  ): Promise<unknown> {
    const RETRY_DELAYS = [2_000, 4_000, 8_000];
    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JIRA_TIMEOUT_MS);
      const opts: RequestInit = {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${JIRA_TOKEN}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      };
      if (body) opts.body = JSON.stringify(body);

      let res: Response;
      try {
        res = await fetch(fullUrl, opts);
      } catch (err: unknown) {
        clearTimeout(timer);
        if ((err as { name?: string }).name === 'AbortError')
          throw new Error(`${label} request timed out after ${JIRA_TIMEOUT_MS / 1000}s`);
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (res.status !== 429) {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const safeText = text
            .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
            .slice(0, 300);
          throw new Error(`${label} → ${res.status}: ${safeText}`);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : undefined;
      }

      if (attempt === MAX_ATTEMPTS - 1)
        throw new Error(`${label} rate limit exceeded after ${MAX_ATTEMPTS} retries`);

      const retryAfterSec = Number(res.headers.get('Retry-After'));
      const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : RETRY_DELAYS[attempt];
      await new Promise((r) => setTimeout(r, waitMs));
    }

    throw new Error(`${label} rate limit exceeded after ${MAX_ATTEMPTS} retries`);
  }

  async function jiraRequest(method: string, urlPath: string, body?: unknown): Promise<unknown> {
    return _jiraFetch(
      `${JIRA_BASE}/rest/api/2${urlPath}`,
      method,
      body,
      `JIRA ${method} ${urlPath}`
    );
  }

  async function jiraAgileRequest(
    method: string,
    urlPath: string,
    body?: unknown
  ): Promise<unknown> {
    return _jiraFetch(
      `${JIRA_BASE}/rest/agile/1.0${urlPath}`,
      method,
      body,
      `JIRA Agile ${method} ${urlPath}`
    );
  }

  async function jiraPagedRequest(
    jql: string,
    fields: string,
    {
      maxResults = 100,
      maxTotal = 500,
      expand,
    }: { maxResults?: number; maxTotal?: number; expand?: string } = {}
  ): Promise<unknown[]> {
    const all: unknown[] = [];
    let startAt = 0;

    while (true) {
      let url = `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&startAt=${startAt}&fields=${encodeURIComponent(fields)}`;
      if (expand) url += `&expand=${encodeURIComponent(expand)}`;
      const page = (await jiraRequest('GET', url)) as Record<string, unknown>;
      const issues = (page.issues as unknown[] | undefined) || [];
      all.push(...issues);

      if (
        all.length >= maxTotal ||
        all.length >= ((page.total as number) || 0) ||
        issues.length < maxResults
      )
        break;
      startAt += issues.length;
    }

    return all.slice(0, maxTotal);
  }

  // O(n) disk-scan fallback. docIndex.findByJiraId is the primary, O(1) lookup
  // path everywhere (docs stay in sync because docIndex.invalidate is called on
  // every write); this is only meant to be reached as a last-resort safety net
  // if the index is ever missing an entry it should have. Callers that use it
  // as a fallback should log a warning when it fires so a docIndex bug doesn't
  // go unnoticed.
  async function findLocalFileByJiraId(
    jiraId: string
  ): Promise<{ docType: string; filename: string } | null> {
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const f of (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.md'))) {
        const content = await fs.promises.readFile(path.join(dir, f), 'utf-8');
        const m = content.match(/^JIRA_ID:\s*(.+)$/m);
        if (m && m[1].trim() === jiraId) return { docType, filename: f };
      }
    }
    return null;
  }

  function jiraIssueToMarkdown(issue: unknown): { docType: string; content: string } {
    const { key, fields } = issue as {
      key: string;
      fields: Record<string, unknown> & {
        summary?: string;
        description?: string;
        issuetype?: { name?: string };
        priority?: { name?: string };
        fixVersions?: Array<{ name?: string }>;
      };
    };
    const summary = (fields.summary || '').replace(/[\r\n]+/g, ' ').trim();
    const description = jiraToMarkdown(fields.description || '');
    const issueType = fields.issuetype?.name || 'Epic';
    const priority = fields.priority?.name || 'Medium';
    const docType = JIRA_TO_LOCAL_TYPE[issueType] || 'epic';
    const fixVersion = fields.fixVersions?.[0]?.name || 'TBD';
    const jiraUrl = `${JIRA_BASE}/browse/${key}`;
    const spRaw = FIELD_STORY_POINTS ? fields[FIELD_STORY_POINTS] : null;
    const storyPoints = spRaw != null ? String(spRaw) : 'TBD';

    const content = `---
JIRA_ID: ${key}
JIRA_URL: ${jiraUrl}
Story_Points: ${storyPoints}
Status: Created in JIRA
Priority: ${priority}
Fix_Version: ${fixVersion}
Squad: TBD
PI: TBD
Sprint: TBD
Created: ${isoDate()}
---

## ${summary}

${description || '_No description in JIRA._'}
`;
    return { docType, content };
  }

  const COVE_HEADINGS = /^(Context|Objective|Value|Execution|Acceptance Criteria|Out of Scope)$/;

  function extractJiraSummary(content: string): string {
    const storyHeader = content.match(/^## Story \d+:\s*(.+?)(?:\s*<!--.*?-->)?\s*$/m);
    if (storyHeader) return storyHeader[1].trim();
    const namedSection = content.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
    if (namedSection) return namedSection[1].trim();
    // Find first ## heading that is NOT a COVE section heading
    const headings = content.matchAll(/^## (.+)/gm);
    for (const m of headings) {
      const heading = m[1].replace(/<!--.*?-->/g, '').trim();
      if (!COVE_HEADINGS.test(heading)) return heading;
    }
    const h1 = content.match(/^# (.+)/m);
    if (h1) return h1[1].trim();
    return 'Untitled';
  }

  async function jiraUploadAttachment(
    issueKey: string,
    filename: string,
    buffer: Buffer
  ): Promise<unknown> {
    const url = `${JIRA_BASE}/rest/api/2/issue/${issueKey}/attachments`;
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(buffer)]), filename);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        'X-Atlassian-Token': 'no-check',
      },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA attachment upload → ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return await res.json();
    } catch {
      return { success: true };
    }
  }

  return {
    jiraRequest,
    jiraAgileRequest,
    jiraPagedRequest,
    jiraUploadAttachment,
    findLocalFileByJiraId,
    jiraIssueToMarkdown,
    extractJiraSummary,
  };
}

// ── Shared helpers for jira-sync routes ──────────────────────────────────────

/**
 * Appends a JIRA description change history note to the inbox file.
 * Creates the inbox file if it doesn't exist yet.
 */
export async function appendDescriptionHistory(
  inboxPath: string,
  oldBody: string,
  newBody: string
): Promise<void> {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const note = `\n\n---\n\n## JIRA Description Update — ${ts}\n\n**Previous description:**\n${oldBody || '_empty_'}\n\n**New description from JIRA:**\n${newBody || '_empty_'}\n`;
  if (fs.existsSync(inboxPath)) {
    await fs.promises.appendFile(inboxPath, note);
  } else {
    await fs.promises.mkdir(path.dirname(inboxPath), { recursive: true });
    await fs.promises.writeFile(inboxPath, note.trimStart());
  }
}

/**
 * Extracts the body text from a markdown document (strips frontmatter, first heading, and
 * any trailing ## Comments section).
 */
export function extractBodyText(content: string): string {
  const body = stripFrontmatter(content);
  return body
    .replace(/^## .+\n?/m, '')
    .replace(/\n## Comments\b[\s\S]*$/, '')
    .trim();
}

export type JiraPreviewIssue = {
  key: string;
  fields?: Record<string, unknown> & {
    summary?: string;
    issuetype?: { name?: string };
    description?: string;
    issuelinks?: Array<{ inwardIssue?: { key: string } }>;
  };
};

export type PreviewItem = {
  jiraKey: string;
  jiraTitle: string;
  jiraType: string;
  localFilename: string | null;
  localDocType: string;
  action: string;
  changes: Record<string, unknown>[];
};

interface BuildPreviewItemContext {
  TYPE_CONFIG: TypeConfig;
  FIELD_STORY_POINTS: string;
  docIndex: DocIndexInstance;
  findExistingByJiraIdFn: (jiraId: string) => Promise<{ filename: string; docType: string } | null>;
  extractJiraSummaryFn: (content: string) => string;
  logWarn: Logger['logWarn'];
}

/**
 * Builds a preview item describing what would change if the given JIRA issue were pulled locally.
 */
export async function buildPreviewItem(
  iss: JiraPreviewIssue,
  {
    TYPE_CONFIG,
    FIELD_STORY_POINTS,
    findExistingByJiraIdFn,
    extractJiraSummaryFn,
    logWarn,
  }: BuildPreviewItemContext
): Promise<PreviewItem> {
  const existing = await findExistingByJiraIdFn(iss.key);
  const jiraTitle = String(iss.fields?.summary || '').trim();
  const jiraSP = iss.fields?.[FIELD_STORY_POINTS] ?? null;
  const jiraTypeName = iss.fields?.issuetype?.name || '';
  const localType = JIRA_TO_LOCAL_TYPE[jiraTypeName] || 'story';

  const changes: Record<string, unknown>[] = [];
  const item: PreviewItem = {
    jiraKey: iss.key,
    jiraTitle,
    jiraType: jiraTypeName,
    localFilename: existing?.filename || null,
    localDocType: existing?.docType || localType,
    action: existing ? 'update' : 'create',
    changes,
  };

  if (existing) {
    try {
      const localContent = await fs.promises.readFile(
        path.join(TYPE_CONFIG[existing.docType].dir(), existing.filename),
        'utf-8'
      );
      const localTitle = extractJiraSummaryFn(localContent);
      const localSPRaw = extractFrontmatterField(localContent, 'Story_Points');
      const localSP = localSPRaw && localSPRaw !== 'TBD' ? Number(localSPRaw) : null;
      const localBody = extractBodyText(localContent);
      const jiraDesc = jiraToMarkdown(iss.fields?.description || '').trim();

      if (jiraTitle !== localTitle)
        changes.push({ field: 'title', from: localTitle, to: jiraTitle });
      if (jiraDesc !== localBody) changes.push({ field: 'description', changed: true });
      if (jiraSP !== localSP) changes.push({ field: 'storyPoints', from: localSP, to: jiraSP });
    } catch (err) {
      logWarn('jira/sync', `could not compare local content for preview`, {
        error: err instanceof Error ? err.message : String(err),
      });
      changes.push({ field: 'description', changed: true });
    }
  } else {
    if (jiraTitle) changes.push({ field: 'title', to: jiraTitle });
    changes.push({ field: 'description', changed: true });
    if (jiraSP !== null) changes.push({ field: 'storyPoints', to: jiraSP });
  }
  return item;
}
