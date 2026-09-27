/**
 * Direct-CDP driver: a minimal, nodriver-style Chrome
 * DevTools Protocol client over a raw websocket. This is the recommended SDK
 * driver plane: it is NOT the Playwright/Puppeteer control plane (which is a
 * detection vector independent of patch quality). We never call `Runtime.enable`
 * (a known leak surface); `Runtime.evaluate` works without it, and isolated
 * worlds are created explicitly via `Page.createIsolatedWorld`.
 */
import WebSocket, { type RawData } from 'ws';
import { CdpError, NetworkError } from './errors';
import type { TrustedInputBody } from './types';

/** The slice of the REST client the CDP driver needs for `humanize*` helpers. */
export interface InputClient {
  sendInput(profileId: string, body: TrustedInputBody): Promise<unknown>;
}

/** A CDP event frame (no `id`): `{ method, params, sessionId? }`. */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface CdpResponseFrame {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

// ── CDP result shapes we read (kept precise, no `any`) ──────────────────────

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}
interface GetTargetsResult {
  targetInfos: TargetInfo[];
}
interface CreateTargetResult {
  targetId: string;
}
interface AttachResult {
  sessionId: string;
}
interface NavigateResult {
  frameId: string;
  loaderId?: string;
  errorText?: string;
}
interface FrameTreeResult {
  frameTree: { frame: { id: string } };
}
interface IsolatedWorldResult {
  executionContextId: number;
}
interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
}
interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: { text?: string; exception?: RemoteObject };
}

type PendingResolver = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/**
 * The websocket multiplexer: assigns command ids, resolves responses, and fans
 * CDP events out to subscribers. One connection backs the root session and every
 * attached page session.
 */
class CdpConnection {
  readonly #ws: WebSocket;
  #nextId = 0;
  readonly #pending = new Map<number, PendingResolver>();
  readonly #subscribers = new Set<(event: CdpEvent) => void>();
  readonly #closeListeners = new Set<() => void>();
  #closeReason: Error | null = null;

  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on('message', (data) => this.#onMessage(data));
    ws.on('close', () => this.#onClose(new CdpError(-1, 'CDP connection closed')));
    ws.on('error', (err) => this.#onClose(new NetworkError('CDP connection error', err)));
  }

  request<T>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    if (this.#closeReason) return Promise.reject(this.#closeReason);
    const id = ++this.#nextId;
    const frame: Record<string, unknown> = { id, method };
    if (params !== undefined) frame['params'] = params;
    if (sessionId !== undefined) frame['sessionId'] = sessionId;

    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#ws.send(JSON.stringify(frame), (err) => {
        if (err) {
          this.#pending.delete(id);
          reject(new NetworkError('failed to send CDP command', err));
        }
      });
    });
  }

  subscribe(cb: (event: CdpEvent) => void): () => void {
    this.#subscribers.add(cb);
    return () => this.#subscribers.delete(cb);
  }

  /** Register a callback fired once when the connection closes (immediately if
   *  it already has); event streams use this to end instead of hanging. */
  onClose(cb: () => void): () => void {
    if (this.#closeReason) {
      cb();
      return () => {};
    }
    this.#closeListeners.add(cb);
    return () => this.#closeListeners.delete(cb);
  }

  close(): void {
    this.#ws.close();
  }

  get closed(): boolean {
    return this.#closeReason !== null;
  }

  #onMessage(data: RawData): void {
    let frame: CdpResponseFrame;
    try {
      frame = JSON.parse(rawToString(data)) as CdpResponseFrame;
    } catch {
      return;
    }

    if (typeof frame.id === 'number') {
      const pending = this.#pending.get(frame.id);
      if (!pending) return;
      this.#pending.delete(frame.id);
      if (frame.error) pending.reject(new CdpError(frame.error.code, frame.error.message, frame.error.data));
      else pending.resolve(frame.result);
      return;
    }

    if (typeof frame.method === 'string') {
      const event: CdpEvent = { method: frame.method, params: frame.params ?? {}, sessionId: frame.sessionId };
      for (const cb of [...this.#subscribers]) cb(event);
    }
  }

  #onClose(reason: Error): void {
    if (this.#closeReason) return;
    this.#closeReason = reason;
    for (const [, pending] of this.#pending) pending.reject(reason);
    this.#pending.clear();
    this.#subscribers.clear();
    // Signal end-of-stream: async iterators resolve their pending next() with
    // { done: true } here. Without this a `for await` would hang forever.
    for (const cb of [...this.#closeListeners]) cb();
    this.#closeListeners.clear();
  }
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

export interface AttachOptions {
  /** Attach to this exact target; otherwise the first `page` target is used. */
  targetId?: string;
  /** Create a fresh target (tab) instead of reusing an existing one. */
  create?: boolean;
  /** Initial URL when creating a target (default `about:blank`). */
  url?: string;
}

export interface NavigateOptions {
  /** Wait until `document.readyState === 'complete'` (default true). */
  wait?: boolean;
  /** Wait timeout in ms (default 30000). */
  timeout?: number;
}

export interface EvaluateOptions {
  awaitPromise?: boolean;
  returnByValue?: boolean;
  /** Run in a fresh isolated world rather than the page's main world. */
  isolated?: boolean;
}

export interface ClickOptions {
  button?: string;
  clickCount?: number;
  /**
   * B5: element-relative targeting. The effective target width (an element's
   * bounding-box size). The daemon's Fitts-law approach lands within the element
   * instead of on a fixed corner. Prefer {@link CdpSession.humanizeClickElement}.
   */
  width?: number;
}

export interface MoveOptions {
  /** B5: element-relative target width (see {@link ClickOptions.width}). */
  width?: number;
}

export interface ScrollOptions {
  deltaX?: number;
  deltaY?: number;
}

/** A DOM element's bounding box (e.g. from `getBoundingClientRect()`). */
export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A CDP session. The root session (no `sessionId`) speaks browser-level CDP;
 * `attachToPage()` returns a page-bound session whose commands carry its
 * `sessionId` (flatten mode). `navigate`/`evaluate`/`createIsolatedWorld` and
 * the `humanize*` helpers operate on a page-bound session.
 */
export class CdpSession {
  readonly #conn: CdpConnection;
  readonly sessionId: string | undefined;
  readonly #client: InputClient | undefined;
  readonly #profileId: string | undefined;
  #isolatedContextId: number | undefined;

  constructor(conn: CdpConnection, sessionId?: string, client?: InputClient, profileId?: string) {
    this.#conn = conn;
    this.sessionId = sessionId;
    this.#client = client;
    this.#profileId = profileId;
  }

  /** Send a raw CDP command and await its result (by id). */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.#conn.request<T>(method, params, this.sessionId);
  }

  /** Register a callback for a CDP event scoped to this session. Returns unsubscribe. */
  on(method: string, callback: (params: Record<string, unknown>) => void): () => void {
    return this.#conn.subscribe((event) => {
      if (event.method === method && event.sessionId === this.sessionId) callback(event.params);
    });
  }

  /** `for await (const event of session.events())` over this session's CDP events. */
  events(): AsyncIterableIterator<CdpEvent> {
    return scopedEventStream(this.#conn, this.sessionId);
  }

  /** Attach to a page target, returning a page-bound child session. */
  async attachToPage(opts: AttachOptions = {}): Promise<CdpSession> {
    let targetId = opts.targetId;
    if (opts.create) {
      const created = await this.send<CreateTargetResult>('Target.createTarget', { url: opts.url ?? 'about:blank' });
      targetId = created.targetId;
    } else if (!targetId) {
      const { targetInfos } = await this.send<GetTargetsResult>('Target.getTargets');
      const page = targetInfos.find((t) => t.type === 'page');
      if (page) {
        targetId = page.targetId;
      } else {
        const created = await this.send<CreateTargetResult>('Target.createTarget', { url: opts.url ?? 'about:blank' });
        targetId = created.targetId;
      }
    }
    const { sessionId } = await this.send<AttachResult>('Target.attachToTarget', { targetId, flatten: true });
    return new CdpSession(this.#conn, sessionId, this.#client, this.#profileId);
  }

  /** Navigate the page; optionally wait for load. Never calls `Runtime.enable`. */
  async navigate(url: string, opts: NavigateOptions = {}): Promise<NavigateResult> {
    const res = await this.send<NavigateResult>('Page.navigate', { url });
    if (res.errorText) throw new CdpError(-1, `navigation failed: ${res.errorText}`);
    if (opts.wait !== false) await this.#waitForLoad(opts.timeout ?? 30_000);
    return res;
  }

  /** Evaluate a JS expression in the page (or an isolated world) and return its value. */
  async evaluate<T = unknown>(expression: string, opts: EvaluateOptions = {}): Promise<T> {
    const params: Record<string, unknown> = {
      expression,
      awaitPromise: opts.awaitPromise ?? true,
      returnByValue: opts.returnByValue ?? true,
    };
    if (opts.isolated) params['contextId'] = await this.#isolatedContext();
    const res = await this.send<EvaluateResult>('Runtime.evaluate', params);
    if (res.exceptionDetails) {
      throw new CdpError(-1, res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'evaluate exception');
    }
    return res.result.value as T;
  }

  /** Create an isolated world for the (main) frame and return its execution context id. */
  async createIsolatedWorld(frameId?: string, worldName = '__sb'): Promise<number> {
    let frame = frameId;
    if (!frame) {
      const { frameTree } = await this.send<FrameTreeResult>('Page.getFrameTree');
      frame = frameTree.frame.id;
    }
    const { executionContextId } = await this.send<IsolatedWorldResult>('Page.createIsolatedWorld', {
      frameId: frame,
      worldName,
      grantUniveralAccess: false,
    });
    return executionContextId;
  }

  // ── Humanized trusted input (routes through the daemon) ────────────────────

  humanizeMove(x: number, y: number, opts: MoveOptions = {}): Promise<unknown> {
    return this.#input({ action: 'move', x, y, width: opts.width });
  }

  humanizeClick(x: number, y: number, opts: ClickOptions = {}): Promise<unknown> {
    return this.#input({
      action: 'click',
      x,
      y,
      button: opts.button ?? 'left',
      click_count: opts.clickCount ?? 1,
      width: opts.width,
    });
  }

  /**
   * B5: humanized move to the CENTRE of an element box, with the box width fed to the
   * daemon's Fitts-law approach so the pointer lands *within* the element (not on a
   * fixed corner). Pass a `getBoundingClientRect()`-shaped box.
   */
  humanizeMoveToElement(box: ElementBox): Promise<unknown> {
    return this.humanizeMove(box.x + box.width / 2, box.y + box.height / 2, { width: box.width });
  }

  /** B5: humanized click at the centre of an element box (see {@link humanizeMoveToElement}). */
  humanizeClickElement(box: ElementBox, opts: ClickOptions = {}): Promise<unknown> {
    return this.humanizeClick(box.x + box.width / 2, box.y + box.height / 2, { ...opts, width: box.width });
  }

  humanizeType(text: string): Promise<unknown> {
    return this.#input({ action: 'type', text });
  }

  humanizeScroll(x: number, y: number, opts: ScrollOptions = {}): Promise<unknown> {
    return this.#input({ action: 'scroll', x, y, delta_x: opts.deltaX ?? 0, delta_y: opts.deltaY ?? 0 });
  }

  /** Close the underlying CDP connection. */
  close(): void {
    this.#conn.close();
  }

  #input(body: TrustedInputBody): Promise<unknown> {
    if (!this.#client || !this.#profileId) {
      return Promise.reject(
        new CdpError(-1, 'humanize requires a CDP session created via client.connectCdp(result, profileId)'),
      );
    }
    return this.#client.sendInput(this.#profileId, { ...body, humanize: true } as TrustedInputBody);
  }

  async #isolatedContext(): Promise<number> {
    if (this.#isolatedContextId === undefined) this.#isolatedContextId = await this.createIsolatedWorld();
    return this.#isolatedContextId;
  }

  async #waitForLoad(timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const ready = await this.evaluate<string>('document.readyState');
      if (ready === 'complete') return;
      if (Date.now() > deadline) throw new CdpError(-1, 'navigation wait timed out');
      await delay(50);
    }
  }
}

export interface CdpConnectOptions {
  token?: string | null;
  client?: InputClient;
  profileId?: string;
  /** Auto-attach to a page target so navigate/evaluate work (default true). */
  autoAttach?: boolean;
  /** Create a fresh tab on attach instead of reusing an existing page (default false). */
  createTarget?: boolean;
  /** Initial URL when creating a target. */
  targetUrl?: string;
  /** Websocket handshake timeout in ms (default 30000). */
  openTimeout?: number;
}

/** Open a CDP websocket and return a (page-bound, unless `autoAttach:false`) session. */
export async function openCdpSession(url: string, options: CdpConnectOptions = {}): Promise<CdpSession> {
  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  const ws = new WebSocket(url, { headers, handshakeTimeout: options.openTimeout ?? 30_000 });
  await waitForOpen(ws);
  const conn = new CdpConnection(ws);
  const root = new CdpSession(conn, undefined, options.client, options.profileId);
  if (options.autoAttach === false) return root;
  return root.attachToPage({ create: options.createTarget ?? false, url: options.targetUrl });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(new NetworkError('CDP websocket failed to open', err));
    };
    const cleanup = (): void => {
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    ws.on('open', onOpen);
    ws.on('error', onError);
  });
}

function scopedEventStream(conn: CdpConnection, sessionId: string | undefined): AsyncIterableIterator<CdpEvent> {
  const buffer: CdpEvent[] = [];
  const waiters: ((r: IteratorResult<CdpEvent>) => void)[] = [];
  let done = false;

  const unsubscribe = conn.subscribe((event) => {
    if (event.sessionId !== sessionId) return;
    const waiter = waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else buffer.push(event);
  });

  let offClose: () => void = () => {};
  const finish = (): IteratorResult<CdpEvent> => {
    if (!done) {
      done = true;
      unsubscribe();
      offClose();
      for (const w of waiters.splice(0)) w({ value: undefined, done: true });
    }
    return { value: undefined, done: true };
  };
  // End the stream when the connection dies (browser exit / network drop) so
  // `for await` loops terminate instead of awaiting a next() that never comes.
  offClose = conn.onClose(() => {
    finish();
  });

  return {
    next(): Promise<IteratorResult<CdpEvent>> {
      const next = buffer.shift();
      if (next !== undefined) return Promise.resolve({ value: next, done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
    return(): Promise<IteratorResult<CdpEvent>> {
      return Promise.resolve(finish());
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
