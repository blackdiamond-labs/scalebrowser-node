import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { CdpError } from '../src/errors';
import { openCdpSession } from '../src/cdp';
import { ScalebrowserClient } from '../src/client';
import type { FetchLike } from '../src/events';

interface CdpCommand {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/** A tiny fake CDP endpoint that answers the commands the driver issues. */
function handleCommand(ws: WsSocket, msg: CdpCommand): void {
  const { id, method, params } = msg;
  const reply = (result: unknown): void => ws.send(JSON.stringify({ id, result }));

  switch (method) {
    case 'Target.getTargets':
      return reply({ targetInfos: [{ targetId: 't1', type: 'page', title: '', url: 'about:blank', attached: false }] });
    case 'Target.createTarget':
      return reply({ targetId: 't-new' });
    case 'Target.attachToTarget':
      return reply({ sessionId: 'sess-1' });
    case 'Page.navigate':
      return reply({ frameId: 'f1' });
    case 'Page.getFrameTree':
      return reply({ frameTree: { frame: { id: 'f1' } } });
    case 'Page.createIsolatedWorld':
      return reply({ executionContextId: 42 });
    case 'Runtime.evaluate': {
      const expr = String(params?.['expression']);
      let value: unknown;
      if (expr === 'document.readyState') value = 'complete';
      else if (expr === 'document.title') value = 'Example Domain';
      else if (expr === '1+1') value = 2;
      else if (params?.['contextId'] !== undefined) value = `iso:${String(params['contextId'])}`;
      else value = 'ok';
      return reply({ result: { type: typeof value === 'number' ? 'number' : 'string', value } });
    }
    case 'Test.emit':
      reply({ ok: true });
      ws.send(JSON.stringify({ method: 'Custom.ping', params: { hello: 'world' }, sessionId: 'sess-1' }));
      return;
    case 'Test.error':
      ws.send(JSON.stringify({ id, error: { code: -32000, message: 'boom' } }));
      return;
    default:
      return reply({});
  }
}

let server: WebSocketServer;
let url: string;

beforeAll(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  server.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        handleCommand(ws, JSON.parse(raw.toString()) as CdpCommand);
      } catch {
        /* ignore malformed */
      }
    });
  });
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe('direct-CDP driver', () => {
  it('auto-attaches to a page and exposes the sessionId', async () => {
    const session = await openCdpSession(url);
    expect(session.sessionId).toBe('sess-1');
    session.close();
  });

  it('navigates and waits for readyState=complete (no Runtime.enable)', async () => {
    const session = await openCdpSession(url);
    const res = await session.navigate('https://example.com');
    expect(res.frameId).toBe('f1');
    session.close();
  });

  it('evaluates expressions and returns values by id', async () => {
    const session = await openCdpSession(url);
    expect(await session.evaluate<string>('document.title')).toBe('Example Domain');
    expect(await session.evaluate<number>('1+1')).toBe(2);
    session.close();
  });

  it('runs concurrent requests, demuxed by id', async () => {
    const session = await openCdpSession(url);
    const [title, sum, ready] = await Promise.all([
      session.evaluate<string>('document.title'),
      session.evaluate<number>('1+1'),
      session.evaluate<string>('document.readyState'),
    ]);
    expect([title, sum, ready]).toEqual(['Example Domain', 2, 'complete']);
    session.close();
  });

  it('evaluates inside an isolated world', async () => {
    const session = await openCdpSession(url);
    const ctx = await session.createIsolatedWorld();
    expect(ctx).toBe(42);
    expect(await session.evaluate<string>('whatever', { isolated: true })).toBe('iso:42');
    session.close();
  });

  it('subscribes to CDP events scoped to the session', async () => {
    const session = await openCdpSession(url);
    const got = new Promise<Record<string, unknown>>((resolve) => {
      session.on('Custom.ping', resolve);
    });
    await session.send('Test.emit');
    expect(await got).toEqual({ hello: 'world' });
    session.close();
  });

  it('exposes events() as an async iterator', async () => {
    const session = await openCdpSession(url);
    const iterator = session.events();
    const next = iterator.next();
    await session.send('Test.emit');
    const { value } = await next;
    expect(value?.method).toBe('Custom.ping');
    await iterator.return?.();
    session.close();
  });

  it('ends events() iteration when the connection closes', async () => {
    const session = await openCdpSession(url);
    const iterator = session.events();
    const pending = iterator.next();
    // Closing the websocket must resolve the awaited next() with done: a
    // `for await` loop terminates instead of hanging forever on disconnect.
    session.close();
    const result = await pending;
    expect(result.done).toBe(true);
    // And the iterator stays terminated afterwards.
    expect((await iterator.next()).done).toBe(true);
  });

  it('events() opened after a close is immediately done', async () => {
    const session = await openCdpSession(url);
    session.close();
    // Wait until the close reaches the client side.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await session.events().next();
    expect(result.done).toBe(true);
  });

  it('rejects error frames with a CdpError', async () => {
    const session = await openCdpSession(url);
    await expect(session.send('Test.error')).rejects.toBeInstanceOf(CdpError);
    session.close();
  });

  it('routes humanize* through the daemon trusted-input endpoint', async () => {
    let inputBody: unknown;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      inputBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      expect(String(input)).toBe('http://daemon/v1/profiles/p1/input');
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as FetchLike;

    const client = new ScalebrowserClient({ baseUrl: 'http://daemon', token: 't', fetch: fetchImpl });
    const session = await client.connectCdp(url, 'p1');
    await session.humanizeClick(120, 240);
    expect(inputBody).toEqual({ action: 'click', x: 120, y: 240, button: 'left', click_count: 1, humanize: true });
    session.close();
  });

  it('throws when humanize is used without a bound profile', async () => {
    const session = await openCdpSession(url);
    await expect(session.humanizeMove(1, 2)).rejects.toBeInstanceOf(CdpError);
    session.close();
  });
});
