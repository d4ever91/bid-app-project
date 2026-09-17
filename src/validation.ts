/**
 * Small rule-based validator.
 *
 * A rule takes the field's value plus the whole draft (so rules can compare fields)
 * and returns an error string, or null when the value is fine. Rules run in order
 * and the first failure wins, which keeps messages specific — "required" never
 * shows up alongside "must be a valid email".
 */
export type Rule<T> = (value: unknown, all: T) => string | null;
export type Schema<T> = Partial<Record<keyof T & string, Rule<T>[]>>;
export type Errors<T> = Partial<Record<keyof T & string, string>>;

const text = (v: unknown): string => (v == null ? '' : String(v)).trim();

export const required = (message = 'Required'): Rule<never> => (v) => (text(v) ? null : message);

export const email = (message = "That email address doesn't look right"): Rule<never> => (v) =>
  !text(v) || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(text(v)) ? null : message;

export const domain = (message = 'Enter a domain like ordinal.io'): Rule<never> => (v) =>
  !text(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text(v)) ? null : message;

export const minLen = (n: number, message?: string): Rule<never> => (v) =>
  !text(v) || text(v).length >= n ? null : message ?? `Must be at least ${n} characters`;

export const maxLen = (n: number, message?: string): Rule<never> => (v) =>
  text(v).length <= n ? null : message ?? `Must be ${n} characters or fewer`;

export const pattern = (re: RegExp, message: string): Rule<never> => (v) =>
  !text(v) || re.test(text(v)) ? null : message;

export const integer = (message = 'Whole numbers only'): Rule<never> => (v) =>
  !text(v) || /^\d+$/.test(text(v).replace(/[,\s]/g, '')) ? null : message;

export const range = (min: number, max: number, message?: string): Rule<never> => (v) => {
  if (!text(v)) return null;
  const n = Number(text(v).replace(/[,\s]/g, ''));
  if (Number.isNaN(n)) return message ?? 'Enter a number';
  return n >= min && n <= max ? null : message ?? `Must be between ${min} and ${max}`;
};

/** Rejects a value already used by another record — the client-side half of a unique index. */
export const unique = <T,>(
  existing: () => string[],
  message = 'That value is already in use'
): Rule<T> => (v) => {
  const value = text(v).toLowerCase();
  if (!value) return null;
  return existing().some((x) => x.toLowerCase() === value) ? message : null;
};

/** Accepts the loose date strings this app uses ("14 Aug 2026", "2026-08-14"). */
export const dateish = (message = 'Use a date like 14 Aug 2026'): Rule<never> => (v) =>
  !text(v) || !Number.isNaN(Date.parse(text(v))) || /^\d{1,2} \w{3,} \d{4}$/.test(text(v)) ? null : message;

export const accepted = (message = 'Please confirm to continue'): Rule<never> => (v) =>
  v === true ? null : message;

/** Runs a schema over a draft and returns only the fields that failed. */
export function runSchema<T extends Record<string, unknown>>(values: T, schema: Schema<T>): Errors<T> {
  const errors: Errors<T> = {};
  for (const key of Object.keys(schema) as (keyof T & string)[]) {
    for (const rule of schema[key] ?? []) {
      const message = rule(values[key], values);
      if (message) {
        errors[key] = message;
        break;
      }
    }
  }
  return errors;
}

/**
 * Per-field visibility. Errors stay hidden until a field has been blurred, or the
 * user has attempted to submit — so a pristine form is never a wall of red.
 */
export function visible<T extends Record<string, unknown>>(
  errors: Errors<T>,
  touched: Record<string, boolean>,
  submitted: boolean
): Errors<T> {
  if (submitted) return errors;
  const out: Errors<T> = {};
  for (const key of Object.keys(errors) as (keyof T & string)[]) {
    if (touched[key]) out[key] = errors[key];
  }
  return out;
}

export const firstError = <T,>(errors: Errors<T>): string | null => Object.values(errors)[0] ?? null;
export const errorCount = <T,>(errors: Errors<T>): number => Object.keys(errors).length;
