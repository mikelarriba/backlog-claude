// ── Shared document helpers ────────────────────────────────────────────────────

/**
 * Find an existing local document by its JIRA issue key.
 *
 * Uses the O(1) docIndex lookup as the primary path and falls back to the
 * provided async disk-scan fallback only as a last resort.  Logs loudly via
 * `logWarn` when the fallback fires so docIndex staleness bugs don't go
 * unnoticed.
 */
export async function findExistingByJiraId(
  jiraId: string,
  indexLookup: (id: string) => { docType: string; filename: string } | undefined,
  diskScanFallback: (id: string) => Promise<{ docType: string; filename: string } | null>,
  logWarn: (context: string, message: string) => void,
  logContext: string
): Promise<{ docType: string; filename: string } | undefined | null> {
  const existing = indexLookup(jiraId);
  if (existing) return existing;
  const fallback = await diskScanFallback(jiraId);
  if (fallback) {
    logWarn(logContext, `docIndex missed ${jiraId} that a full disk scan found — check docIndex sync`);
  }
  return fallback;
}

/**
 * Strip C0/C1 control characters (except \t and \n which are valid in body
 * text) to prevent prompt injection via crafted null bytes or escape sequences.
 */
// eslint-disable-next-line no-control-regex
export function stripControls(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
