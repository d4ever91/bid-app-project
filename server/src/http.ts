/**
 * Response envelope + errors + validation.
 *
 * Every response is `{ success, data, message, meta?, error? }` — the shape `src/api.ts`
 * unwraps. Validation failures carry `error.details.fields = { field: ['message'] }`,
 * which the frontend flattens straight into its form errors.
 */
import type { Response } from 'express';

export type FieldErrors = Record<string, string>;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: FieldErrors
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: FieldErrors) => new HttpError(400, 'VALIDATION_ERROR', message, fields);
export const unauthorized = (message = 'Sign in to continue') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, fields?: FieldErrors) => new HttpError(409, 'CONFLICT', message, fields);

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export function ok<T>(
  res: Response,
  data: T,
  message: string | null = null,
  { status = 200, meta }: { status?: number; meta?: PageMeta } = {}
): void {
  res.status(status).json({ success: true, data: data ?? null, message, ...(meta ? { meta } : {}) });
}

export function sendError(res: Response, status: number, code: string, message: string, fields?: FieldErrors): void {
  const details =
    fields && Object.keys(fields).length
      ? { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]])) }
      : undefined;
  res.status(status).json({ success: false, data: null, message, error: { code, message, ...(details ? { details } : {}) } });
}

/* ---------------- validation ---------------- */

/** Trimmed string form of any input. */
export const clean = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

export type Rule = (value: unknown) => string | null;

const empty = (v: unknown) => v === undefined || v === null || v === '';

export const rules = {
  required: (msg = 'Required'): Rule => (v) => ((Array.isArray(v) ? v.length : clean(v)) ? null : msg),
  minLen: (n: number, msg?: string): Rule => (v) =>
    !clean(v) || clean(v).length >= n ? null : msg ?? `Must be at least ${n} characters`,
  maxLen: (n: number, msg?: string): Rule => (v) => (clean(v).length <= n ? null : msg ?? `Must be ${n} characters or fewer`),
  email: (msg = "That email address doesn't look right"): Rule => (v) =>
    !clean(v) || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(clean(v)) ? null : msg,
  domain: (msg = 'Enter a domain like ordinal.io'): Rule => (v) =>
    !clean(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(clean(v)) ? null : msg,
  oneOf: (options: readonly unknown[], msg?: string): Rule => (v) =>
    empty(v) || options.includes(v) ? null : msg ?? `Must be one of: ${options.join(', ')}`,
  int: (min: number, max: number, msg?: string): Rule => (v) => {
    if (empty(v)) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? null : msg ?? `Must be a whole number between ${min} and ${max}`;
  },
  number: (min: number, max: number, msg?: string): Rule => (v) => {
    if (empty(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? null : msg ?? `Must be between ${min} and ${max}`;
  },
  array: (msg = 'Must be a list'): Rule => (v) => (v === undefined || Array.isArray(v) ? null : msg),
  boolean: (msg = 'Must be true or false'): Rule => (v) => (v === undefined || typeof v === 'boolean' ? null : msg)
};

export type Schema = Record<string, Rule[]>;

/** Runs `{ field: [rule, ...] }` over an object. First failing rule per field wins. */
export function validate(values: unknown, schema: Schema, prefix = ''): FieldErrors {
  const source = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const fields: FieldErrors = {};
  for (const [key, list] of Object.entries(schema)) {
    for (const rule of list) {
      const message = rule(source[key]);
      if (message) {
        fields[prefix + key] = message;
        break;
      }
    }
  }
  return fields;
}

export function assertValid(fields: FieldErrors, message = 'Some fields need attention'): void {
  if (Object.keys(fields).length) throw badRequest(message, fields);
}

/** Page/limit from the query string, clamped to sane bounds. */
export function paging(query: Record<string, unknown>, defaultLimit = 25): { page: number; limit: number } {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? ''), 10) || defaultLimit));
  const page = Math.max(1, Number.parseInt(String(query.page ?? ''), 10) || 1);
  return { page, limit };
}

export const pageMeta = (page: number, limit: number, total: number): PageMeta => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit))
});

/** Request body as a plain object (never undefined). */
export const bodyOf = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

/** First value of a query-string parameter, as a string. */
export const q = (value: unknown): string => (Array.isArray(value) ? clean(value[0]) : clean(value));
