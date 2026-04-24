// ── Shared route helpers ──────────────────────────────────────────────────────
// Extracted from server.js so route modules can reuse them.
import fs from 'fs';
import path from 'path';
import { WORKFLOW_STATUSES } from './transforms.js';

export function sendError(res, status, code, message, details = null) {
  return res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function parseApiError(err, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = 'Unexpected server error') {
  if (!err) return { code: fallbackCode, message: fallbackMessage };
  if (typeof err === 'string') return { code: fallbackCode, message: err };
  return {
    code: err.code || fallbackCode,
    message: err.message || fallbackMessage,
    ...(err.details ? { details: err.details } : {}),
  };
}

export function normalizeType(value) {
  return String(value || '').toLowerCase().trim();
}

export function assertDocType(type, TYPE_CONFIG) {
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

export function assertStatus(status) {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw {
      code: 'INVALID_STATUS',
      message: 'Invalid workflow status',
      details: { allowed: WORKFLOW_STATUSES, received: status },
    };
  }
}

export function assertFilename(filename) {
  const cleaned = path.basename(String(filename || '').trim());
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw {
      code: 'INVALID_FILENAME',
      message: 'Filename is required and must be valid',
    };
  }
  return cleaned;
}
