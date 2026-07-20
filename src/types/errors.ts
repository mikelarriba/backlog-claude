// ── Canonical API error response shape ────────────────────────────────────────
// All route handlers must return this shape for error responses so the client
// can rely on a single, predictable structure.
export interface ApiError {
  error: string; // human-readable message
  code: string; // machine-readable code, e.g. "DOC_NOT_FOUND"
  details?: unknown; // optional structured context (cycle path, field name, etc.)
}

// ── Application error ─────────────────────────────────────────────────────────
// A proper Error subclass carrying a machine-readable code and optional
// structured details. Thrown by the assert* request-validation helpers in
// routeHelpers.ts instead of plain object literals, so `err instanceof Error`
// checks (used throughout the route layer, e.g. logging/formatting) work
// correctly. parseApiError() (routeHelpers.ts) knows how to convert this
// (and ValidationError / CircuitOpenError / generic Error) into an ApiError.
export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly statusCode: number;

  constructor(code: string, message: string, details?: unknown, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}
