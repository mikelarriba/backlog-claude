// ── Structured audit logging ───────────────────────────────────────────────────
// Appends NDJSON audit events to audit.log (or AUDIT_LOG_PATH env var).
// Fire-and-forget: write failures are logged as warnings so a broken log path
// never affects responses but is still observable.
import fs from 'fs';
import path from 'path';
import type { AuditEvent } from '../types.js';
import { createLogger } from './logger.js';

const { logWarn } = createLogger('[audit]');

export function logAudit(event: Omit<AuditEvent, 'ts'>): void {
  // Read at call time so tests that change AUDIT_LOG_PATH mid-run are respected.
  const auditPath = process.env.AUDIT_LOG_PATH ?? './audit.log';
  if (!auditPath || auditPath === 'none') return;

  const entry: AuditEvent = { ts: new Date().toISOString(), ...event };
  const line = JSON.stringify(entry) + '\n';

  fs.appendFile(path.resolve(auditPath), line, (err) => {
    if (err) logWarn('write failed', err.message, { path: auditPath });
  });
}
