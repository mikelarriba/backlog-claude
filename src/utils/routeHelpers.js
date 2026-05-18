// ── Shared route helpers ──────────────────────────────────────────────────────
// Extracted from server.js so route modules can reuse them.
import fs from 'fs';
import path from 'path';
import { WORKFLOW_STATUSES } from './transforms.js';

/**
 * Send a structured JSON error response.
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {string} code   - Machine-readable error code, e.g. 'INVALID_TYPE'
 * @param {string} message
 * @param {*} [details]
 * @returns {import('express').Response}
 */
export function sendError(res, status, code, message, details = null) {
  return res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

/**
 * Create a directory if it does not already exist.
 * @param {string} dir - Absolute path
 */
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Normalise any caught error/string into a structured { code, message, details? } object.
 * @param {any} err
 * @param {string} [fallbackCode]
 * @param {string} [fallbackMessage]
 * @returns {{ code: string, message: string, details?: * }}
 */
export function parseApiError(err, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = 'Unexpected server error') {
  if (!err) return { code: fallbackCode, message: fallbackMessage };
  if (typeof err === 'string') return { code: fallbackCode, message: err };
  return {
    code: err.code || fallbackCode,
    message: err.message || fallbackMessage,
    ...(err.details ? { details: err.details } : {}),
  };
}

/**
 * Lowercase and trim a type string for case-insensitive matching.
 * @param {*} value
 * @returns {string}
 */
export function normalizeType(value) {
  return String(value || '').toLowerCase().trim();
}

/**
 * Assert that `type` is a known document type. Returns the normalised value.
 * @param {*} type
 * @param {Record<string, *>} TYPE_CONFIG
 * @returns {string}
 * @throws {{ code: 'INVALID_TYPE', message: string, details: object }}
 */
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

/**
 * Assert that `status` is a valid workflow status.
 * @param {string} status
 * @throws {{ code: 'INVALID_STATUS', message: string, details: object }}
 */
export function assertStatus(status) {
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

/**
 * Sanitise and validate a filename from user input or route params.
 * Returns the cleaned basename on success; throws on invalid input.
 * @param {*} filename
 * @returns {string}
 * @throws {{ code: 'INVALID_FILENAME', message: string }}
 */
export function assertFilename(filename) {
  const cleaned = path.basename(String(filename || '').trim());
  if (!cleaned || !SAFE_FILENAME_RE.test(cleaned)) {
    throw {
      code: 'INVALID_FILENAME',
      message: 'Filename must match pattern: lowercase letters, digits, hyphens, ending in .md',
    };
  }
  return cleaned;
}

/**
 * Validate required fields in a request body at API boundaries.
 * Throws a structured error listing all missing fields at once.
 * @param {Record<string, *>} body
 * @param {string[]} required - Names of required fields
 * @throws {{ code: 'MISSING_FIELDS', message: string, details: { missing: string[] } }}
 */
export function assertBody(body, required) {
  const missing = required.filter(k => body[k] === undefined || body[k] === null || body[k] === '');
  if (missing.length) {
    throw {
      code: 'MISSING_FIELDS',
      message: `Missing required fields: ${missing.join(', ')}`,
      details: { missing },
    };
  }
}

/**
 * Set the three SSE response headers. Call before writing any SSE frames.
 * @param {import('express').Response} res
 */
export function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

/**
 * Validate `:type` and `:filename` route params and resolve the absolute filepath.
 * Throws INVALID_TYPE / INVALID_FILENAME on bad input.
 * @param {import('express').Request} req
 * @param {Record<string, *>} TYPE_CONFIG
 * @returns {{ docType: string, cfg: *, filename: string, filepath: string }}
 */
export function resolveDocPath(req, TYPE_CONFIG) {
  const docType  = assertDocType(req.params.type, TYPE_CONFIG);
  const cfg      = TYPE_CONFIG[docType];
  const filename = assertFilename(req.params.filename);
  const filepath = path.join(cfg.dir(), filename);
  return { docType, cfg, filename, filepath };
}
