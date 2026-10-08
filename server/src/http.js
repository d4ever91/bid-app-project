/**
 * Response envelope + errors.
 *
 * Every response is `{ success, data, message, meta?, error? }` — the shape `src/api.ts`
 * unwraps. Validation failures carry `error.details.fields = { field: ['message'] }`,
 * which the frontend flattens straight into its form errors.
 */

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new HttpError(400, 'VALIDATION_ERROR', message, fields);
export const unauthorized = (message = 'Sign in to continue') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, fields) => new HttpError(409, 'CONFLICT', message, fields);

export function ok(res, data, message = null, { status = 200, meta } = {}) {
  res.status(status).json({ success: true, data: data ?? null, message, ...(meta ? { meta } : {}) });
}

export function sendError(res, status, code, message, fields) {
  const details = fields && Object.keys(fields).length
    ? { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])) }
    : undefined;
  res.status(status).json({
    success: false,
    data: null,
    message,
    error: { code, message, ...(details ? { details } : {}) }
  });
}

/* ---------------- validation ---------------- */

const text = (v) => (v === undefined || v === null ? '' : String(v)).trim();

export const rules = {
  required: (msg = 'Required') => (v) => (Array.isArray(v) ? v.length : text(v)) ? null : msg,
  minLen: (n, msg) => (v) => !text(v) || text(v).length >= n ? null : msg ?? `Must be at least ${n} characters`,
  maxLen: (n, msg) => (v) => text(v).length <= n ? null : msg ?? `Must be ${n} characters or fewer`,
  email: (msg = "That email address doesn't look right") => (v) =>
    !text(v) || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(text(v)) ? null : msg,
  domain: (msg = 'Enter a domain like ordinal.io') => (v) =>
    !text(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text(v)) ? null : msg,
  oneOf: (options, msg) => (v) =>
    v === undefined || v === null || v === '' || options.includes(v) ? null : msg ?? `Must be one of: ${options.join(', ')}`,
  int: (min, max, msg) => (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? null : msg ?? `Must be a whole number between ${min} and ${max}`;
  },
  number: (min, max, msg) => (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? null : msg ?? `Must be between ${min} and ${max}`;
  },
  array: (msg = 'Must be a list') => (v) => (v === undefined || Array.isArray(v) ? null : msg)
};

/**
 * Runs `{ field: [rule, ...] }` over an object. First failing rule per field wins.
 * `prefix` namespaces nested objects (e.g. `company.role`).
 */
export function validate(values, schema, prefix = '') {
  const fields = {};
  for (const [key, list] of Object.entries(schema)) {
    for (const rule of list) {
      const message = rule(values?.[key], values);
      if (message) {
        fields[prefix + key] = message;
        break;
      }
    }
  }
  return fields;
}

export function assertValid(fields, message = 'Some fields need attention') {
  if (Object.keys(fields).length) throw badRequest(message, fields);
}

export const clean = text;

/** Page/limit from the query string, clamped to sane bounds. */
export function paging(query, defaultLimit = 25) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { page, limit };
}

export function paginate(rows, { page, limit }) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  return { items: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, total, pages } };
}
