// ── JIRA startup configuration validator ─────────────────────────────────────
// Validates JIRA env vars, token, and custom field IDs at startup.
// All failures are logged as warnings — the server always continues.
import type { Logger } from '../utils/logger.js';

interface JiraValidatorConfig {
  jiraBase: string;
  jiraToken: string;
  fieldStoryPoints: string;
  fieldEpicLink: string;
  fieldEpicName: string;
  logInfo: Logger['logInfo'];
  logWarn: Logger['logWarn'];
}

export async function validateJiraConfig({
  jiraBase,
  jiraToken,
  fieldStoryPoints,
  fieldEpicLink,
  fieldEpicName,
  logInfo,
  logWarn,
}: JiraValidatorConfig): Promise<void> {
  // If no token is set, JIRA is not configured — skip silently
  if (!jiraToken) {
    logInfo('jira-validator', 'JIRA_API_TOKEN not set — skipping JIRA validation');
    return;
  }

  const missingVars: string[] = [];
  if (!jiraBase) missingVars.push('JIRA_BASE_URL');
  if (!fieldStoryPoints) missingVars.push('JIRA_FIELD_STORY_POINTS');
  if (!fieldEpicLink) missingVars.push('JIRA_FIELD_EPIC_LINK');
  if (!fieldEpicName) missingVars.push('JIRA_FIELD_EPIC_NAME');

  if (missingVars.length) {
    logWarn('jira-validator', `Missing JIRA env vars: ${missingVars.join(', ')}`);
    return;
  }

  const headers = {
    Authorization: `Bearer ${jiraToken}`,
    Accept: 'application/json',
  };

  // ── Step 1: verify token via /myself ─────────────────────────────────────
  try {
    const res = await fetch(`${jiraBase}/rest/api/2/myself`, { headers });
    if (res.status === 401 || res.status === 403) {
      logWarn('jira-validator', `JIRA token is invalid or lacks permissions (HTTP ${res.status})`);
      return;
    }
    if (!res.ok) {
      logWarn(
        'jira-validator',
        `JIRA /myself check returned HTTP ${res.status} — validation skipped`
      );
      return;
    }
  } catch (err: any) {
    logWarn('jira-validator', `JIRA /myself check failed: ${err.message} — validation skipped`);
    return;
  }

  // ── Step 2: verify custom field IDs exist ────────────────────────────────
  let fields: Array<{ id: string; name: string }>;
  try {
    const res = await fetch(`${jiraBase}/rest/api/2/field`, { headers });
    if (!res.ok) {
      logWarn(
        'jira-validator',
        `JIRA /field check returned HTTP ${res.status} — field validation skipped`
      );
      return;
    }
    fields = (await res.json()) as Array<{ id: string; name: string }>;
  } catch (err: any) {
    logWarn(
      'jira-validator',
      `JIRA /field check failed: ${err.message} — field validation skipped`
    );
    return;
  }

  const fieldIds = new Set(fields.map((f) => f.id));
  const customFields = [
    { id: fieldStoryPoints, envVar: 'JIRA_FIELD_STORY_POINTS' },
    { id: fieldEpicLink, envVar: 'JIRA_FIELD_EPIC_LINK' },
    { id: fieldEpicName, envVar: 'JIRA_FIELD_EPIC_NAME' },
  ];

  let allFieldsOk = true;
  for (const { id, envVar } of customFields) {
    if (!fieldIds.has(id)) {
      logWarn('jira-validator', `${envVar}=${id} does not exist in this JIRA instance`);
      allFieldsOk = false;
    }
  }

  if (allFieldsOk) {
    logInfo('jira-validator', 'JIRA configuration valid ✓');
  }
}
