/**
 * Live lifecycle event stream (`GET /v1/events`).
 *
 * Read as `text/event-stream` over `fetch` (so the Bearer header is attached, which
 * the browser `EventSource` cannot do that) and reconnect with backoff. A
 * `/v1/ws` websocket carries the same events; SSE is sufficient for one-way
 * fan-out.
 */
import type {
  LifecycleEvent,
  StreamedEvent,
} from './types-events';
import { NetworkError } from './errors';

/** Injectable `fetch`; defaults to the global at call time. */
export type FetchLike = typeof globalThis.fetch;

export type StreamStatus = 'connecting' | 'open' | 'closed';

export interface StreamParams {
  baseUrl: string;
  token?: string | null;
  fetch?: FetchLike;
  /** When unauthorized (401 / code 4010), stop and notify instead of retrying. */
  onUnauthorized?: () => void;
}

export interface StreamHandlers {
  onEvent: (event: LifecycleEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * Subscribe to the lifecycle event stream. Returns an unsubscribe function that
 * aborts the connection and stops reconnection.
 *
 * **Loss is reported, never swallowed.** Two things can cost frames, and both
 * end in the same synthetic `resync` event so a reader has one case to handle:
 * a jump in the numbering (a frame the daemon sent and this side did not get),
 * and a reconnect (a gap of unknown length). A third, the daemon noticing that
 * this connection fell behind, arrives as a real `resync` from the other side.
 *
 * The FIRST connection is deliberately not a reconnect: nothing was subscribed
 * before it, so there is nothing a gap could have cost.
 */
export function subscribeEvents(params: StreamParams, handlers: StreamHandlers): () => void {
  const controller = new AbortController();
  const fetchImpl = params.fetch ?? globalThis.fetch;
  let closed = false;
  let attempt = 0;
  /** The last frame number seen; `null` until the first frame of a connection. */
  let lastSeq: number | null = null;
  let everConnected = false;

  const setStatus = (s: StreamStatus): void => handlers.onStatus?.(s);

  const resync = (dropped: number): void =>
    handlers.onEvent({ type: 'resync', dropped, at: Math.floor(Date.now() / 1000) });

  /** Hand one arrived frame on, announcing a gap before it. */
  const deliver = (event: StreamedEvent): void => {
    if (typeof event.seq === 'number') {
      if (lastSeq !== null && event.seq > lastSeq + 1) resync(event.seq - lastSeq - 1);
      lastSeq = event.seq;
    }
    handlers.onEvent(event);
  };

  async function connect(): Promise<void> {
    while (!closed) {
      setStatus('connecting');
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (params.token) headers['Authorization'] = `Bearer ${params.token}`;

        const res = await fetchImpl(`${params.baseUrl}/v1/events`, {
          headers,
          signal: controller.signal,
        });

        if (res.status === 401) {
          params.onUnauthorized?.();
          break;
        }
        if (!res.ok || !res.body) {
          throw new NetworkError(`event stream failed (HTTP ${res.status})`);
        }

        attempt = 0;
        setStatus('open');
        // A new connection starts its own numbering, and everything that
        // happened while there was none is unaccounted for.
        lastSeq = null;
        if (everConnected) resync(0);
        everConnected = true;
        await pump(res.body, deliver, controller.signal);
      } catch {
        if (closed || controller.signal.aborted) break;
        // fall through to backoff + retry
      }

      if (closed) break;
      setStatus('connecting');
      attempt += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(attempt, 5));
      await sleep(delay, controller.signal);
    }
    setStatus('closed');
  }

  void connect();

  return () => {
    closed = true;
    controller.abort();
  };
}

/** Read the stream body, split SSE frames, parse `data:` JSON into events. */
async function pump(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: LifecycleEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = indexOfFrameEnd(buffer)) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, '');
        const event = parseSseFrame(frame);
        if (event) onEvent(event);
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function indexOfFrameEnd(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/** Extract and JSON-parse the `data:` payload of a single SSE frame. */
export function parseSseFrame(frame: string): StreamedEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('\n');
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as StreamedEvent;
  } catch {
    return null;
  }
}

/**
 * `for await (const event of eventStream({...}))` ergonomics over
 * {@link subscribeEvents}. Break out of the loop (or call `.return()`) to
 * unsubscribe.
 */
export function eventStream(params: StreamParams): AsyncIterableIterator<LifecycleEvent> {
  const buffer: LifecycleEvent[] = [];
  const waiters: ((r: IteratorResult<LifecycleEvent>) => void)[] = [];
  let done = false;

  const unsubscribe = subscribeEvents(params, {
    onEvent: (event) => {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else buffer.push(event);
    },
  });

  const finish = (): IteratorResult<LifecycleEvent> => {
    if (!done) {
      done = true;
      unsubscribe();
      for (const w of waiters.splice(0)) w({ value: undefined, done: true });
    }
    return { value: undefined, done: true };
  };

  return {
    next(): Promise<IteratorResult<LifecycleEvent>> {
      const next = buffer.shift();
      if (next !== undefined) return Promise.resolve({ value: next, done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
    return(): Promise<IteratorResult<LifecycleEvent>> {
      return Promise.resolve(finish());
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
