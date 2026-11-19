/**
 * Typed error catalogue for the P0 prototype.
 *
 * Every domain/repository failure carries a stable `code`, a safe human
 * `message` (no stack traces, SQL, ids of foreign objects, or PII), and an
 * optional hint about the next allowed step. The UI may show `message` and
 * `nextStep`; it must never show internal detail.
 *
 * Structural/business errors are NOT retryable. Only `transient_network`,
 * `rate_limited` and `internal` are candidates for a bounded retry, and only for
 * idempotent operations.
 */

export type ErrorCode =
  | "validation"
  | "forbidden"
  | "not_found"
  | "stale_data"
  | "conflict"
  | "unavailable"
  | "transient_network"
  | "rate_limited"
  | "internal";

/** Codes that a caller may retry, with backoff, for an idempotent operation. */
export const RETRYABLE_CODES: readonly ErrorCode[] = [
  "transient_network",
  "rate_limited",
  "internal",
];

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.includes(code);
}

interface AppErrorOptions {
  /** A short, safe hint for the next allowed step (optional). */
  readonly nextStep?: string;
  /** Non-sensitive context. Never put PII, secrets, or foreign ids here. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * A single error type for all expected failures. `code` is stable and safe to
 * branch on; `message` is safe to render.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly nextStep: string | undefined;
  readonly context: Readonly<Record<string, string | number | boolean>>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.nextStep = options.nextStep;
    this.context = options.context ?? {};
  }
}

export const validationError = (message: string, opts?: AppErrorOptions): AppError =>
  new AppError("validation", message, opts);
export const forbiddenError = (
  message = "Недостаточно прав.",
  opts?: AppErrorOptions,
): AppError => new AppError("forbidden", message, opts);
export const notFoundError = (
  message = "Объект не найден.",
  opts?: AppErrorOptions,
): AppError => new AppError("not_found", message, opts);
export const staleDataError = (
  message = "Данные устарели, нужно подтверждение.",
  opts?: AppErrorOptions,
): AppError => new AppError("stale_data", message, opts);
export const conflictError = (
  message = "Данные изменились, перечитайте их.",
  opts?: AppErrorOptions,
): AppError => new AppError("conflict", message, opts);
export const unavailableError = (
  message = "Недоступно.",
  opts?: AppErrorOptions,
): AppError => new AppError("unavailable", message, opts);

/** Map an unknown thrown value to a safe user-facing message + code. */
export function toSafeError(e: unknown): {
  code: ErrorCode;
  message: string;
  nextStep?: string;
} {
  if (e instanceof AppError) {
    return e.nextStep !== undefined
      ? { code: e.code, message: e.message, nextStep: e.nextStep }
      : { code: e.code, message: e.message };
  }
  // Anything else is internal: never leak the raw message to the user.
  return { code: "internal", message: "Произошла внутренняя ошибка (демо)." };
}
