// ── Centralised request-validation helpers ────────────────────────────────────
// Throw ValidationError for invalid input; call parseApiError to convert to a
// 400 response.  A ValidationError middleware in server.ts catches any that
// bubble up through next(err).

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── Runtime enum constants ────────────────────────────────────────────────────
// Single source of truth consumed by both TypeScript types and runtime checks.

export const VALID_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const VALID_STATUSES = ['Draft', 'Created in JIRA', 'Archived'] as const;
export const VALID_DOC_TYPES = ['feature', 'epic', 'story', 'spike', 'bug'] as const;
export const VALID_LINK_TYPES = [
  'blocks',
  'parallel',
  'epic→feature',
  'story→epic',
  'spike→epic',
  'bug→epic',
] as const;

export type ValidPriority = (typeof VALID_PRIORITIES)[number];
export type ValidLinkType = (typeof VALID_LINK_TYPES)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function requireString(
  value: unknown,
  fieldName: string,
  opts?: { maxLength?: number; pattern?: RegExp }
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${fieldName} is required and must be a non-empty string`);
  }
  if (opts?.maxLength !== undefined && value.length > opts.maxLength) {
    throw new ValidationError(`${fieldName} must be ${opts.maxLength} characters or fewer`);
  }
  if (opts?.pattern && !opts.pattern.test(value)) {
    throw new ValidationError(`${fieldName} has an invalid format`);
  }
  return value;
}

export function requirePositiveInt(
  value: unknown,
  fieldName: string,
  opts?: { max?: number }
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new ValidationError(`${fieldName} cannot exceed ${opts.max}`);
  }
  return n;
}

export function optionalString(
  value: unknown,
  fieldName: string,
  opts?: { maxLength?: number }
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, fieldName, opts);
}
