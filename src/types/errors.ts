// ── Canonical API error response shape ────────────────────────────────────────
// All route handlers must return this shape for error responses so the client
// can rely on a single, predictable structure.
export interface ApiError {
  error: string; // human-readable message
  code: string; // machine-readable code, e.g. "DOC_NOT_FOUND"
  details?: unknown; // optional structured context (cycle path, field name, etc.)
}
