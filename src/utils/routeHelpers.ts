// ── Shared route helpers ──────────────────────────────────────────────────────
// Extracted from server.js so route modules can reuse them.
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { WORKFLOW_STATUSES } from './transforms.js';
import { ValidationError } from './validate.js';
import type { TypeConfig, TypeConfigEntry } from '../types.js';
import type { ApiError } from '../types/errors.js';
import { AppError } from '../types/errors.js';

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = undefined
): Response {
  const body: ApiError = { error: message, code, ...(details !== undefined ? { details } : {}) };
  return res.status(status).json(body);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface ParsedError {
  code: string;
  message: string;
  details?: unknown;
}

export function parseApiError(
  err: unknown,
  fallbackCode = 'INTERNAL_ERROR',
  fallbackMessage = 'Unexpected server error'
): ParsedError {
  if (!err) return { code: fallbackCode, message: fallbackMessage };
  if (err instanceof AppError)
    return {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
  if (err instanceof ValidationError) return { code: 'VALIDATION_ERROR', message: err.message };
  // Generic Error instances (including CircuitOpenError, which carries its own
  // `.code`) fall through to the duck-typed handling below, which already
  // picks up `.code`/`.message`/`.details` from any error-shaped object.
  if (typeof err === 'string') return { code: fallbackCode, message: err };
  const e = err as Record<string, unknown>;
  return {
    code: (typeof e.code === 'string' ? e.code : null) || fallbackCode,
    message: (typeof e.message === 'string' ? e.message : null) || fallbackMessage,
    ...(e.details ? { details: e.details } : {}),
  };
}

export function normalizeType(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .trim();
}

export function assertDocType(type: unknown, TYPE_CONFIG: TypeConfig): string {
  const normalized = normalizeType(type);
  if (!TYPE_CONFIG[normalized]) {
    throw new AppError('INVALID_TYPE', 'Invalid document type', {
      allowed: Object.keys(TYPE_CONFIG),
      received: type,
    });
  }
  return normalized;
}

export function assertStatus(status: string): void {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new AppError('INVALID_STATUS', 'Invalid workflow status', {
      allowed: WORKFLOW_STATUSES,
      received: status,
    });
  }
}

// Allow-list regex: lowercase alphanumeric + hyphens, must end in .md.
// Rejects path traversal (../../), uppercase, spaces, and any other chars.
const SAFE_FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

export function assertFilename(filename: unknown): string {
  const cleaned = path.basename(String(filename || '').trim());
  if (!cleaned || !SAFE_FILENAME_RE.test(cleaned)) {
    throw new AppError(
      'INVALID_FILENAME',
      'Filename must match pattern: lowercase letters, digits, hyphens, ending in .md'
    );
  }
  return cleaned;
}

export function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

export function resolveDocPath(
  req: Request,
  TYPE_CONFIG: TypeConfig
): { docType: string; cfg: TypeConfigEntry; filename: string; filepath: string } {
  const docType = assertDocType(req.params.type, TYPE_CONFIG);
  const cfg = TYPE_CONFIG[docType];
  const filename = assertFilename(req.params.filename);
  const filepath = path.join(cfg.dir(), filename);
  return { docType, cfg, filename, filepath };
}
