// ── Shared HTTP retry/backoff/timeout client ──────────────────────────────────
// Extracted from the near-identical _jiraFetch (jiraService.ts) and
// _confluenceFetch (confluenceService.ts): same retry/backoff/timeout/
// redaction shape, differing only in auth header and redaction pattern.
export interface HttpRetryFetchOptions {
  authHeader: string;
  timeoutMs: number;
  redactPattern: RegExp;
  redactReplacement: string;
}

export async function httpRetryFetch(
  url: string,
  method: string,
  body: unknown,
  label: string,
  { authHeader, timeoutMs, redactPattern, redactReplacement }: HttpRetryFetchOptions
): Promise<unknown> {
  const RETRY_DELAYS = [2_000, 4_000, 8_000];
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      res = await fetch(url, opts);
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as { name?: string }).name === 'AbortError')
        throw new Error(`${label} request timed out after ${timeoutMs / 1000}s`);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status !== 429) {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const safeText = text.replace(redactPattern, redactReplacement).slice(0, 300);
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
