// ── Structured audit logging ───────────────────────────────────────────────────
// Appends NDJSON audit events to audit.log (or AUDIT_LOG_PATH env var).
// Fire-and-forget: errors are swallowed so a broken log path never affects responses.
import fs from 'fs';
import path from 'path';
import type { AuditEvent } from '../types.js';

export function logAudit(event: Omit<AuditEvent, 'ts'>): void {
  const auditPath = process.env.AUDIT_LOG_PATH ?? './audit.log';
  if (!auditPath || auditPath === 'none') return;

  const entry: AuditEvent = { ts: new Date().toISOString(), ...event };
  const line = JSON.stringify(entry) + '\n';

  fs.appendFile(path.resolve(auditPath), line, (err) => {
    if (err) console.warn('[audit] write failed:', err.message);
  });
}
