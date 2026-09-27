// The transport half of the SDK client, split out of `client.ts` on
// 2026-08-21 (905-line churn hotspot). `ScalebrowserClient` and its resource
// mixins all extend this class: the Bearer token and the fetch stay #private
// HERE, the request primitives are `protected`, and the public class name the
// package exports is untouched.
import { ApiError, type ApiErrorBody, NetworkError } from './errors';
import type { FetchLike } from './events';
import type { ArtifactBytes } from './types-control';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';

export interface ScalebrowserClientOptions {
  /** Daemon base URL. Default `http://127.0.0.1:8787`. */
  baseUrl?: string;
  /** Bearer token. */
  token?: string | null;
  /** Injectable `fetch` (for testing / custom agents). Default `globalThis.fetch`. */
  fetch?: FetchLike;
}

type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  signal?: AbortSignal;
}

export class ClientCore {
  readonly baseUrl: string;
  #token: string | null;
  readonly #fetch: FetchLike;

  constructor(options: ScalebrowserClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.#token = options.token ?? null;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** For subclasses that hand the token to a sibling transport (SSE, CDP). */
  protected get token(): string | null {
    return this.#token;
  }

  protected get fetchImpl(): FetchLike {
    return this.#fetch;
  }

  /** Rotate the Bearer token at runtime. */
  setToken(token: string | null): void {
    this.#token = token && token.trim() ? token.trim() : null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  protected async request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.#token) headers['Authorization'] = `Bearer ${this.#token}`;
    let payload: string | Uint8Array | undefined;
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      // A `.crx` upload is the file itself, not JSON around it.
      headers['Content-Type'] = 'application/octet-stream';
      payload = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.#fetch(this.#buildUrl(path, opts?.query), {
        method,
        headers,
        body: payload,
        signal: opts?.signal,
      });
    } catch (cause) {
      throw new NetworkError('Could not reach the daemon. Is it running?', cause);
    }

    if (!res.ok) {
      throw new ApiError(res.status, await safeJson(res), res.status === 401 ? 'Unauthorized' : undefined);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? (JSON.parse(text) as T) : (undefined as T));
  }

  /**
   * A route that answers with bytes, not JSON: artifacts and run stills.
   *
   * Separate from {@link ClientCore.request} rather than a flag on it, because the two
   * differ in the error path as well: a failed byte fetch still answers JSON,
   * so the mapping to {@link ApiError} has to happen before the body is read as
   * binary.
   */
  protected async requestBytes(method: string, path: string, opts?: RequestOptions): Promise<ArtifactBytes> {
    const headers: Record<string, string> = {};
    if (this.#token) headers['Authorization'] = `Bearer ${this.#token}`;

    let res: Response;
    try {
      res = await this.#fetch(this.#buildUrl(path, opts?.query), {
        method,
        headers,
        signal: opts?.signal,
      });
    } catch (cause) {
      throw new NetworkError('Could not reach the daemon. Is it running?', cause);
    }
    if (!res.ok) {
      throw new ApiError(res.status, await safeJson(res), res.status === 401 ? 'Unauthorized' : undefined);
    }

    const disposition = res.headers.get('content-disposition');
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      content_type: res.headers.get('content-type'),
      filename: parseFilename(disposition),
    };
  }

  #buildUrl(path: string, query?: Query): string {
    const url = this.baseUrl + path;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  /** Never leak the token in logs / inspection. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `${this.constructor.name} { baseUrl: '${this.baseUrl}', token: ${this.#token ? "'***'" : 'null'} }`;
  }
}

/** Copies the prototype methods of resource mixin classes onto the target,
 *  the classic TS mixin pattern; the matching `interface … extends` merge in
 *  `client.ts` carries the types. */
export function applyMixins(
  target: abstract new (...args: never[]) => unknown,
  mixins: Array<abstract new (...args: never[]) => unknown>
): void {
  for (const mixin of mixins) {
    for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
      if (name === 'constructor') continue;
      Object.defineProperty(
        target.prototype,
        name,
        Object.getOwnPropertyDescriptor(mixin.prototype, name)!
      );
    }
  }
}

/** `attachment; filename="shot.jpg"` → `shot.jpg`. */
function parseFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="([^"]*)"/.exec(disposition) ?? /filename=([^;]+)/.exec(disposition);
  const name = match?.[1]?.trim();
  return name ? name : null;
}

async function safeJson(res: Response): Promise<ApiErrorBody | undefined> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as ApiErrorBody) : undefined;
  } catch {
    return undefined;
  }
}


export function enc(id: string): string {
  return encodeURIComponent(id);
}

