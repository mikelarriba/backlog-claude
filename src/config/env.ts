// ── Centralised & validated environment configuration ────────────────────────
// All process.env reads (except dynamic test flags) live here.
// The app exits at startup with a human-readable error if any variable fails
// validation. Every variable has a documented default.
import { z } from 'zod';

const EnvSchema = z.object({
  // ── Server ─────────────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(3000),

  // ── Logging ────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Audit log ──────────────────────────────────────────────────────────────
  // Set to "none" to disable auditing entirely.
  AUDIT_LOG_PATH: z.string().default('./audit.log'),

  // ── Inbox watcher ──────────────────────────────────────────────────────────
  INBOX_MAX_RETRIES: z.coerce.number().default(3),

  // ── SSE connections ────────────────────────────────────────────────────────
  SSE_IDLE_TIMEOUT_MS: z.coerce.number().default(300_000),

  // ── AI generation (Claude CLI / GitHub Models / Ollama) ───────────────────
  CLAUDE_CONCURRENCY: z.coerce.number().default(3),
  CLAUDE_TIMEOUT_MS: z.coerce.number().default(180_000),
  CLAUDE_STREAM_TIMEOUT_MS: z.coerce.number().default(300_000),
  // Optional – if set, the GitHub Models provider becomes available.
  GITHUB_MODELS_TOKEN: z.string().optional(),
  // Optional – override the Ollama base URL.
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),

  // ── JIRA connection ────────────────────────────────────────────────────────
  JIRA_BASE_URL: z.string().default('https://devstack.vwgroup.com/jira'),
  JIRA_API_TOKEN: z.string().default(''),
  JIRA_PROJECT: z.string().default('EAMDM'),
  JIRA_LABEL: z.string().default('MIDAS_Development'),
  JIRA_FIELD_EPIC_NAME: z.string().default('customfield_10002'),
  JIRA_FIELD_EPIC_LINK: z.string().default('customfield_10000'),
  JIRA_FIELD_STORY_POINTS: z.string().default('customfield_10006'),
  JIRA_BOARD_ID: z.string().default(''),
  JIRA_CONCURRENCY: z.coerce.number().default(5),
  JIRA_TIMEOUT_MS: z.coerce.number().default(30_000),

  // ── Rate limiting ──────────────────────────────────────────────────────────
  RATE_LIMIT_API: z.coerce.number().default(300),
  RATE_LIMIT_AI: z.coerce.number().default(20),
  RATE_LIMIT_JIRA: z.coerce.number().default(60),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[startup] Invalid environment configuration:\n', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
