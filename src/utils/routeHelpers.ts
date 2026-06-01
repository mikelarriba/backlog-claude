// ── Shared route helpers ──────────────────────────────────────────────────────
// Extracted from server.js so route modules can reuse them.
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { WORKFLOW_STATUSES } from './transforms.js';
import { ValidationError } from './validate.js';

interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export function sendError(res: Response, status: number, code: string, message: string, details: any = null): Response {
  return res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function parseApiError(err: any, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = 'Unexpected server error'): ApiError {
  if (!err) return { code: fallbackCode, message: fallbackMessage };
  if (err instanceof ValidationError) return { code: 'VALIDATION_ERROR', message: err.message };
  if (typeof err === 'string') return { code: fallbackCode, message: err };
  return {
    code: err.code || fallbackCode,
    message: err.message || fallbackMessage,
    ...(err.details ? { details: err.details } : {}),
  };
}

export function normalizeType(value: any): string {
  return String(value || '').toLowerCase().trim();
}

export function assertDocType(type: any, TYPE_CONFIG: Record<string, any>): string {
  const normalized = normalizeType(type);
  if (!TYPE_CONFIG[normalized]) {
    throw {
      code: 'INVALID_TYPE',
      message: 'Invalid document type',
      details: { allowed: Object.keys(TYPE_CONFIG), received: type },
    };
  }
  return normalized;
}

export function assertStatus(status: string): void {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw {
      code: 'INVALID_STATUS',
      message: 'Invalid workflow status',
      details: { allowed: WORKFLOW_STATUSES, received: status },
    };
  }
}

// Allow-list regex: lowercase alphanumeric + hyphens, must end in .md.
// Rejects path traversal (../../), uppercase, spaces, and any other chars.
const SAFE_FILENAME_RE = /^[a-z0-9][a-z0-9\-]*\.md$/;

export function assertFilename(filename: any): string {
  const cleaned = path.basename(String(filename || '').trim());
  if (!cleaned || !SAFE_FILENAME_RE.test(cleaned)) {
    throw {
      code: 'INVALID_FILENAME',
      message: 'Filename must match pattern: lowercase letters, digits, hyphens, ending in .md',
    };
  }
  return cleaned;
}

export function assertBody(body: Record<string, any>, required: string[]): void {
  const missing = required.filter(k => body[k] === undefined || body[k] === null || body[k] === '');
  if (missing.length) {
    throw {
      code: 'MISSING_FIELDS',
      message: `Missing required fields: ${missing.join(', ')}`,
      details: { missing },
    };
  }
}

export function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

export function resolveDocPath(req: Request, TYPE_CONFIG: Record<string, any>): { docType: string; cfg: any; filename: string; filepath: string } {
  const docType  = assertDocType(req.params.type, TYPE_CONFIG);
  const cfg      = TYPE_CONFIG[docType];
  const filename = assertFilename(req.params.filename);
  const filepath = path.join(cfg.dir(), filename);
  return { docType, cfg, filename, filepath };
}
