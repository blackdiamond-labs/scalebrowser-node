import { describe, expect, it } from 'vitest';
import { eventStream, parseSseFrame, subscribeEvents } from '../src/events';
import type { FetchLike } from '../src/events';
import type {
  LifecycleEvent,
} from '../src/types-events';

describe('parseSseFrame', () => {
  it('parses a single data line into a typed event', () => {
    const evt = parseSseFrame('data: {"type":"profile_started","profile_id":"p1","cdp_ws":"ws://x","headless":true,"at":1}');
    expect(evt).toEqual({ type: 'profile_started', profile_id: 'p1', cdp_ws: 'ws://x', headless: true, at: 1 });
  });

  it('joins multiple data lines', () => {
    const evt = parseSseFrame('event: msg\ndata: {"type":"profile_stopped",\ndata: "profile_id":"p1","at":2}');
    expect(evt).toEqual({ type: 'profile_stopped', profile_id: 'p1', at: 2 });
  });

  it('returns null for non-data frames and [DONE]', () => {
    expect(parseSseFrame(': keepalive')).toBeNull();
    expect(parseSseFrame('data: [DONE]')).toBeNull();
    expect(parseSseFrame('data: not-json')).toBeNull();
  });

  /**
   * The run and activity events used to be missing from the union entirely, so
   * a consumer typing on `event.type` had no case for the ones a working agent
   * produces most. They carry the whole step and the whole row.
   */
  it('keeps a run step whole, still and error included', () => {
    const evt = parseSseFrame(
      'data: {"seq":11,"type":"run_step","run_id":"R","profile_id":"p1","at":3,' +
        '"step":{"seq":1,"at":3,"duration_ms":430,"kind":"interruption","tool":"click",' +
        '"target":{"role":"button","name":"Allow"},"summary":"Clicked Allow","redacted":false,' +
        '"url":null,"shot_path":"R/1.jpg","error":"the page moved the element"}}',
    );
    expect(evt?.type).toBe('run_step');
    if (evt?.type !== 'run_step') throw new Error('narrowing failed');
    expect(evt.step.shot_path).toBe('R/1.jpg');
    expect(evt.step.error).toBe('the page moved the element');
    expect(evt.step.kind).toBe('interruption');
    expect(evt.seq).toBe(11);
  });

  it('carries a whole activity row, and its departure', () => {
    const changed = parseSseFrame(
      'data: {"seq":5,"type":"profile_activity_changed","at":4,"activity":{"profile_id":"p1",' +
        '"profile_name":"demo","url":"https://example.test/","title":"Example","actor":"agent",' +
        '"since":4,"stale":false}}',
    );
    if (changed?.type !== 'profile_activity_changed') throw new Error('narrowing failed');
    expect(changed.activity.title).toBe('Example');
    expect(changed.activity.stale).toBe(false);

    const gone = parseSseFrame('data: {"seq":6,"type":"profile_activity_gone","profile_id":"p1","at":5}');
    expect(gone?.type).toBe('profile_activity_gone');
  });

  /** Loss is an event, not a silence. */
  it('parses the resync notice', () => {
    const evt = parseSseFrame('data: {"seq":7,"type":"resync","dropped":12,"at":6}');
    if (evt?.type !== 'resync') throw new Error('narrowing failed');
    expect(evt.dropped).toBe(12);
  });
});

describe('eventStream', () => {
  it('yields events parsed from a streamed body', async () => {
    const frames = [
      'data: {"type":"profile_state_changed","profile_id":"p1","from":"stopped","to":"starting","at":1}\n\n',
      'data: {"type":"profile_started","profile_id":"p1","cdp_ws":"ws://x","headless":true,"at":2}\n\n',
    ];
    let call = 0;
    const fetchImpl = (() => {
      call += 1;
      if (call > 1) return Promise.resolve(new Response(null, { status: 401 }));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) controller.enqueue(encoder.encode(f));
          controller.close();
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    }) as FetchLike;

    const received: LifecycleEvent[] = [];
    for await (const evt of eventStream({ baseUrl: 'http://daemon', token: 't', fetch: fetchImpl })) {
      received.push(evt);
      if (received.length === 2) break; // break → iterator.return() unsubscribes
    }

    expect(received.map((e) => e.type)).toEqual(['profile_state_changed', 'profile_started']);
  });
});

/**
 * Loss is reported, never swallowed (the SDK's own `StreamedEvent.seq` doc
 * promises it): a jump in the frame numbering and a reconnect both end in a
 * SYNTHETIC `resync` event, so a reader has one case to handle. The FIRST
 * connection is deliberately not a reconnect. The daemon's own web UI behaves
 * the same.
 */
describe('subscribeEvents seq/resync', () => {
  const sse = (frames: string[]): Response => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  const until = async (cond: () => boolean, timeoutMs = 10_000): Promise<void> => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error('condition never became true');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('delivers a gapless stream verbatim: no resync, none on first connect', async () => {
    let call = 0;
    const fetchImpl = (() => {
      call += 1;
      if (call > 1) return Promise.resolve(new Response(null, { status: 401 }));
      return Promise.resolve(
        sse([
          'data: {"seq":1,"type":"profile_started","profile_id":"p1","cdp_ws":"ws://x","headless":true,"at":1}\n\n',
          'data: {"seq":2,"type":"profile_stopped","profile_id":"p1","at":2}\n\n',
        ]),
      );
    }) as FetchLike;

    const events: LifecycleEvent[] = [];
    const unsubscribe = subscribeEvents(
      { baseUrl: 'http://daemon', token: 't', fetch: fetchImpl },
      { onEvent: (e) => events.push(e) },
    );
    await until(() => events.length >= 2);
    unsubscribe();
    expect(events.map((e) => e.type)).toEqual(['profile_started', 'profile_stopped']);
  });

  it('announces a numbering jump as resync with the dropped count', async () => {
    let call = 0;
    const fetchImpl = (() => {
      call += 1;
      if (call > 1) return Promise.resolve(new Response(null, { status: 401 }));
      return Promise.resolve(
        sse([
          'data: {"seq":5,"type":"profile_started","profile_id":"p1","cdp_ws":"ws://x","headless":true,"at":1}\n\n',
          'data: {"seq":7,"type":"profile_stopped","profile_id":"p1","at":2}\n\n',
        ]),
      );
    }) as FetchLike;

    const events: LifecycleEvent[] = [];
    const unsubscribe = subscribeEvents(
      { baseUrl: 'http://daemon', token: 't', fetch: fetchImpl },
      { onEvent: (e) => events.push(e) },
    );
    await until(() => events.length >= 3);
    unsubscribe();
    expect(events.map((e) => e.type)).toEqual(['profile_started', 'resync', 'profile_stopped']);
    const resync = events[1];
    if (resync.type !== 'resync') throw new Error('narrowing failed');
    expect(resync.dropped).toBe(1);
  });

  it('announces a reconnect as resync(0) and restarts the numbering', async () => {
    let call = 0;
    const fetchImpl = (() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          sse(['data: {"seq":9,"type":"profile_stopped","profile_id":"p1","at":1}\n\n']),
        );
      }
      if (call === 2) {
        // Fresh connection numbers from 1 again. Without the lastSeq reset this
        // would read as a huge backwards jump, not as a clean restart.
        return Promise.resolve(
          sse(['data: {"seq":1,"type":"profile_stopped","profile_id":"p2","at":2}\n\n']),
        );
      }
      return Promise.resolve(new Response(null, { status: 401 }));
    }) as FetchLike;

    const events: LifecycleEvent[] = [];
    const unsubscribe = subscribeEvents(
      { baseUrl: 'http://daemon', token: 't', fetch: fetchImpl },
      { onEvent: (e) => events.push(e) },
    );
    await until(() => events.length >= 3);
    unsubscribe();
    expect(events.map((e) => e.type)).toEqual(['profile_stopped', 'resync', 'profile_stopped']);
    const resync = events[1];
    if (resync.type !== 'resync') throw new Error('narrowing failed');
    expect(resync.dropped).toBe(0);
  });
});
