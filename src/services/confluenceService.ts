// ── Confluence REST API client (auth + CRUD) ──────────────────────────────────
// Thin wrapper around the Confluence Cloud REST API used by the Documentation
// feature. Mirrors the factory-function / bound-closure pattern used by
// jiraService.ts, but auth is Basic (email:api_token base64-encoded) rather
// than JIRA's Bearer token — see _confluenceFetch below.
//
// API-shape note: page CRUD (create/update/delete/get-by-id) uses the
// Confluence REST API **v2** endpoints (`/wiki/api/v2/pages...`) per the
// issue spec. `getPageByTitle` and `getSpace`, however, use the **v1**
// endpoints (`/wiki/rest/api/content` and `/wiki/rest/api/space/{key}`)
// because v1 lets you filter directly by space *key* and page *title* in a
// single call; the v2 `/pages` list endpoint only filters by numeric
// `space-id`, which would require an extra round-trip to resolve first. v1
// remains fully supported on Confluence Cloud, so this is a simplification,
// not a compatibility compromise. The numeric space id needed for v2
// create/update calls is resolved once via getSpace() and cached for the
// lifetime of the service instance (space-key → space-id essentially never
// changes at runtime).
import { config } from '../config/env.js';

const CONFLUENCE_TIMEOUT_MS = config.CONFLUENCE_TIMEOUT_MS;

export interface ConfluencePage {
  id: string;
  title: string;
  version: number;
  body: string;
  spaceKey: string;
}

export interface ConfluenceSpace {
  id: string;
  key: string;
}

interface ConfluenceServiceConfig {
  CONFLUENCE_BASE: string;
  CONFLUENCE_TOKEN: string;
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_SPACE_KEY: string;
}

export interface ConfluenceServiceInstance {
  getSpace: () => Promise<ConfluenceSpace>;
  getPageByTitle: (title: string) => Promise<ConfluencePage | null>;
  createPage: (title: string, body: string) => Promise<ConfluencePage>;
  updatePage: (id: string, version: number, title: string, body: string) => Promise<ConfluencePage>;
  deletePage: (id: string) => Promise<void>;
}

// ── Raw Confluence response shapes (only the fields we read) ─────────────────
interface RawConfluencePage {
  id: string | number;
  title: string;
  version?: { number: number };
  body?: { storage?: { value?: string } };
  space?: { key?: string };
  spaceId?: string | number;
}

interface RawConfluenceSpace {
  id: string | number;
  key: string;
}

export function createConfluenceService({
  CONFLUENCE_BASE,
  CONFLUENCE_TOKEN,
  CONFLUENCE_EMAIL,
  CONFLUENCE_SPACE_KEY,
}: ConfluenceServiceConfig): ConfluenceServiceInstance {
  const authHeader = `Basic ${Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_TOKEN}`).toString('base64')}`;

  async function _confluenceFetch(
    fullUrl: string,
    method: string,
    body: unknown,
    label: string
  ): Promise<unknown> {
    const RETRY_DELAYS = [2_000, 4_000, 8_000];
    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFLUENCE_TIMEOUT_MS);
      const opts: RequestInit = {
        method,
        signal: controller.signal,
        headers: {
          Authorization: authHeader,
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
          throw new Error(`${label} request timed out after ${CONFLUENCE_TIMEOUT_MS / 1000}s`);
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (res.status !== 429) {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const safeText = text
            .replace(/Basic\s+[A-Za-z0-9+/]+=*/g, 'Basic [REDACTED]')
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

  function mapPage(raw: RawConfluencePage): ConfluencePage {
    return {
      id: String(raw.id),
      title: raw.title,
      version: raw.version?.number ?? 1,
      body: raw.body?.storage?.value ?? '',
      spaceKey: raw.space?.key ?? CONFLUENCE_SPACE_KEY,
    };
  }

  // ── Space lookup ─────────────────────────────────────────────────────────
  // getSpace() always makes a live call — it backs the GET /api/confluence/test
  // connection check, which must reflect the *current* credentials/space on
  // every request, not a stale cached result. The numeric space id needed by
  // v2 create (which rarely if ever changes at runtime) is cached separately
  // via resolveSpaceId() below so createPage doesn't pay for an extra round
  // trip on every call.
  async function _fetchSpace(): Promise<ConfluenceSpace> {
    const raw = (await _confluenceFetch(
      `${CONFLUENCE_BASE}/wiki/rest/api/space/${encodeURIComponent(CONFLUENCE_SPACE_KEY)}`,
      'GET',
      undefined,
      'Confluence GET space'
    )) as RawConfluenceSpace;
    return { id: String(raw.id), key: raw.key };
  }

  async function getSpace(): Promise<ConfluenceSpace> {
    return _fetchSpace();
  }

  let _spaceIdCache: string | null = null;

  async function resolveSpaceId(): Promise<string> {
    if (_spaceIdCache) return _spaceIdCache;
    const space = await _fetchSpace();
    _spaceIdCache = space.id;
    return _spaceIdCache;
  }

  async function getPageByTitle(title: string): Promise<ConfluencePage | null> {
    const url =
      `${CONFLUENCE_BASE}/wiki/rest/api/content` +
      `?title=${encodeURIComponent(title)}` +
      `&spaceKey=${encodeURIComponent(CONFLUENCE_SPACE_KEY)}` +
      `&expand=body.storage,version,space`;
    const data = (await _confluenceFetch(url, 'GET', undefined, 'Confluence GET content')) as {
      results?: RawConfluencePage[];
    };
    const results = data.results || [];
    // Confluence returns 200 with an empty results array for "no match", not
    // a 404 — a real HTTP error status still propagates as a thrown Error
    // from _confluenceFetch above and is not swallowed here.
    if (results.length === 0) return null;
    return mapPage(results[0]);
  }

  async function createPage(title: string, body: string): Promise<ConfluencePage> {
    const spaceId = await resolveSpaceId();
    const raw = (await _confluenceFetch(
      `${CONFLUENCE_BASE}/wiki/api/v2/pages`,
      'POST',
      {
        spaceId,
        status: 'current',
        title,
        body: { representation: 'storage', value: body },
      },
      'Confluence POST page'
    )) as RawConfluencePage;
    return mapPage(raw);
  }

  async function updatePage(
    id: string,
    version: number,
    title: string,
    body: string
  ): Promise<ConfluencePage> {
    const raw = (await _confluenceFetch(
      `${CONFLUENCE_BASE}/wiki/api/v2/pages/${encodeURIComponent(id)}`,
      'PUT',
      {
        id,
        status: 'current',
        title,
        body: { representation: 'storage', value: body },
        version: { number: version, message: 'Updated via MIDAS' },
      },
      'Confluence PUT page'
    )) as RawConfluencePage;
    return mapPage(raw);
  }

  async function deletePage(id: string): Promise<void> {
    await _confluenceFetch(
      `${CONFLUENCE_BASE}/wiki/api/v2/pages/${encodeURIComponent(id)}`,
      'DELETE',
      undefined,
      'Confluence DELETE page'
    );
  }

  return {
    getSpace,
    getPageByTitle,
    createPage,
    updatePage,
    deletePage,
  };
}
