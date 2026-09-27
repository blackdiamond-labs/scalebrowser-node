/**
 * Error model: the stable numeric API error codes and the typed exceptions
 * the SDK throws.
 */

/** Stable numeric API error codes (4001–4013, append-only: a retired code stays
 * reserved rather than being reused). */
export const ErrorCode = {
  NotFound: 4001,
  ProxyGeo: 4002,
  Capacity: 4003,
  EngineMissing: 4004,
  Preflight: 4005,
  AlreadyRunning: 4006,
  /** Retired: the removed Methode-D (VM) tier produced this. Reserved (never reused)
   * to match the server's append-only code contract; never returned now. */
  VmProvisionFailed: 4007,
  /** The subscription's abo-wide concurrent-browser allowance is used up.
   * Distinct from Capacity (4003 = this machine is full, wait): the caller's move
   * is to stop a running browser anywhere or upgrade the plan. */
  ConcurrencyLimit: 4008,
  Unauthorized: 4010,
  /** No account is connected to this machine, so nothing may run.
   * Distinct from Unauthorized (4010 = the daemon's own bearer token is wrong, so
   * re-read the token): 4011 means the machine needs to be signed in, and no token
   * a client holds can substitute for that. Connect it in the desktop app. */
  NotSignedIn: 4011,
  /** This ONE profile is open on another machine of the same account.
   * Distinct from ConcurrencyLimit (4008 = the plan is full, buy more or free any
   * browser): the caller's move here costs nothing. Close it on that machine, or
   * take it over from the app running there. */
  ProfileInUse: 4012,
  /** The exit address this start drew belongs to another profile.
   * Distinct from ProxyGeo (4002 = wrong country or wrong kind of exit, so change
   * the proxy): here the proxy is fine and the address is simply spoken for. Wait
   * for a term to run out, let the daemon draw again, or turn exclusivity off for
   * this profile. */
  ExitAddressTaken: 4013,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Human-readable, actionable labels for each coded business error. */
const CODE_LABELS: Record<number, string> = {
  4001: 'Not found',
  4002: 'Proxy or geo check failed',
  4003: 'Capacity exceeded',
  4004: 'Engine missing',
  4005: 'Launch preflight failed',
  4006: 'Profile already running',
  4008: 'Concurrent-browser limit reached (subscription-wide)',
  4010: 'Unauthorized',
  4011: 'No account connected to this machine',
  4012: 'This profile is open on another machine',
  4013: 'This exit address belongs to another profile',
};

/** Error body shape: `{ code, message }`. */
export interface ApiErrorBody {
  code?: number;
  message?: string;
}

/** Base class for every error this SDK throws, so callers can `catch` one type. */
export class ScalebrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A typed transport/contract error. Carries the HTTP `status` and the daemon's
 * numeric `code` so callers (and the auth layer) can react, e.g. 401 / code
 * 4010 → re-authenticate.
 */
export class ApiError extends ScalebrowserError {
  readonly status: number;
  readonly code?: number;
  readonly body?: ApiErrorBody;

  constructor(status: number, body?: ApiErrorBody, fallbackMessage?: string) {
    const label = body?.code ? CODE_LABELS[body.code] : undefined;
    super(body?.message || label || fallbackMessage || `Request failed (HTTP ${status})`);
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }

  /** True for auth failures that must trigger re-authentication. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === ErrorCode.Unauthorized;
  }

  /** Short label for the error code, if any. */
  get codeLabel(): string | undefined {
    return this.code ? CODE_LABELS[this.code] : undefined;
  }
}

/** A network-level failure (daemon unreachable, socket error, fetch rejected). */
export class NetworkError extends ScalebrowserError {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** A CDP command that returned an `error` frame, or a closed CDP connection. */
export class CdpError extends ScalebrowserError {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** Narrow an unknown thrown value to a user-facing message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
