import { describe, expect, it } from 'vitest';
import { ScalebrowserClient } from '../src/client';
import type { FetchLike } from '../src/events';

/**
 * Every method of the published client, called once, against a recording fetch.
 *
 * WHAT THE THREE TESTS BESIDE THIS ONE ALREADY DO, and why this is still
 * missing: `client-surface.test.ts` freezes the public surface at the TYPE
 * level: a method lost in a refactor becomes a type error. `client-coverage`
 * and `client.test.ts` pin the wire form of the endpoints someone had a reason
 * to write a case for. Neither EXECUTES the rest, which is why this file sat at
 * 39.7 % statements and 36 % functions on 2026-09-09, in a package that is
 * published, MIT, on npm.
 *
 * WHAT THIS ADDS. It walks the prototype chain, calls every method with a blunt
 * probe, and checks what reaches the wire. That finds the class of defect a
 * reader cannot: a mistyped path, a method that issues two requests where the
 * caller expects one, a forgotten `/v1` prefix. It deliberately asserts nothing
 * about the RESPONSE: the mock answers whatever it is told, and the shape of a
 * real answer is what the env-gated e2e test is for.
 *
 * Methods whose arguments the blunt probe cannot satisfy are counted, not
 * judged. The floor below is what makes that honest: if a change drops the
 * number that reach the wire, the test says so.
 */

interface RecordedRequest {
  method: string;
  url: string;
}

function makeClient(): { client: ScalebrowserClient; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    // `String(input)` is not enough: at least one method hands `fetch` a
    // `Request` object, and stringifying that yields `[object Request]`.
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ method: init?.method ?? 'GET', url });
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as unknown as FetchLike;
  return {
    client: new ScalebrowserClient({
      baseUrl: 'http://127.0.0.1:8787',
      token: 'test-token',
      fetch: fetchImpl,
    }),
    calls,
  };
}

/** Every callable on the instance and its prototype chain, minus the plumbing. */
function methodenNamen(client: ScalebrowserClient): string[] {
  const namen = new Set<string>();
  for (let o: object | null = client; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key === 'constructor' || key.startsWith('_')) continue;
      const beschreibung = Object.getOwnPropertyDescriptor(o, key);
      if (typeof beschreibung?.value === 'function') namen.add(key);
    }
  }
  return [...namen].sort();
}

/** Methods that must NOT be driven blind: they open sockets or spawn work. */
const NICHT_BLIND = new Set([
  // Opens a real WebSocket to the CDP endpoint.
  'connectCdp',
  // Long-lived server-sent-events stream; a blunt call would leave it open.
  'events',
  'streamEvents',
  // Convenience wrapper that starts AND stops a profile; it drives other
  // methods, so a blind call would double-count their requests.
  'launch',
  // The two generic escape hatches. They take `(method, path, …)`, so a blunt
  // probe builds `http://…[object Object]` out of them. Driving them
  // blind would prove nothing about a route anyway: they ARE the door every
  // wrapper walks through, and the wrappers are what this test measures.
  'request',
  'requestBytes',
]);

/**
 * Paths that deliberately sit OUTSIDE `/v1`.
 *
 * `/health` is the daemon's public, token-free probe. `/v1/health` does not
 * exist, and a client that asked for it behind a proxy could get a 502 that is
 * indistinguishable from a dead daemon.
 */
const OHNE_V1 = new Set(['/health', '/health/ready']);

/**
 * Methods that legitimately issue MORE than one request, each with its reason.
 *
 * `downloadVideoFile` mints a one-shot grant (`POST .../access`) and then
 * fetches the bytes with it. Two calls are the design: the grant is what keeps
 * the byte route from needing the bearer.
 */
const MEHRERE_ANFRAGEN: Record<string, number> = { downloadVideoFile: 2 };

describe('the published client, on the wire', () => {
  it('exposes the surface the type guard freezes', () => {
    const { client } = makeClient();
    const namen = methodenNamen(client);
    // `client-surface.test.ts` pins 85 methods at the type level; this is the
    // same claim measured at runtime, so a method that exists only as a type
    // (or only at runtime) shows up here.
    expect(namen.length).toBeGreaterThanOrEqual(80);
    expect(namen).toContain('listProfiles');
    expect(namen).toContain('startProfile');
  });

  it('every method issues exactly one /v1 request, or none at all', async () => {
    const { client, calls } = makeClient();
    const sonde = ['probe-id', {}, {}];
    let gerufen = 0;
    let gefahren = 0;
    const falsch: string[] = [];

    for (const name of methodenNamen(client)) {
      if (NICHT_BLIND.has(name)) continue;
      gerufen++;
      const vorher = calls.length;
      try {
        await (client as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!(
          ...sonde,
        );
      } catch {
        // An argument the blunt probe cannot supply is not a finding here.
      }
      const neu = calls.slice(vorher);
      if (neu.length === 0) continue;
      gefahren++;
      const erlaubt = MEHRERE_ANFRAGEN[name] ?? 1;
      if (neu.length !== erlaubt) {
        falsch.push(`${name} issued ${neu.length} requests, expected ${erlaubt}`);
      }
      for (const c of neu) {
        // Parsed against a base so a relative path reads the same way.
        const pfad = new URL(c.url, 'http://127.0.0.1:8787').pathname;
        if (pfad.startsWith('/v1/') || OHNE_V1.has(pfad)) continue;
        falsch.push(`${name} hit "${pfad}", neither /v1/... nor a known public path`);
      }
    }

    expect(falsch, falsch.join('\n')).toEqual([]);
    // Measured on 2026-09-09: 84 methods driven, 78 of them reach the wire. The
    // floors sit below that so a new method with its own argument shape does not
    // turn this red. A drop does.
    expect(gerufen).toBeGreaterThanOrEqual(75);
    expect(gefahren).toBeGreaterThanOrEqual(70);
  });

  it('carries the bearer on every request', async () => {
    // The one header a caller cannot add afterwards, and the one whose absence
    // shows up as a 401 at a customer rather than here.
    const kopfzeilen: Array<Record<string, string>> = [];
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
      const h: Record<string, string> = {};
      const roh = init?.headers;
      if (roh && typeof roh === 'object' && !Array.isArray(roh)) {
        for (const [k, v] of Object.entries(roh)) h[k.toLowerCase()] = String(v);
      }
      kopfzeilen.push(h);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as FetchLike;

    const client = new ScalebrowserClient({
      baseUrl: 'http://127.0.0.1:8787',
      token: 'test-token',
      fetch: fetchImpl,
    });
    await client.listProfiles();
    await client.listGroups();
    expect(kopfzeilen).toHaveLength(2);
    for (const h of kopfzeilen) expect(h['authorization']).toBe('Bearer test-token');
  });

  it('keeps an identifier with special characters in ONE path segment', async () => {
    // Same property the web-ui wrappers carry, and the same reason: an id with
    // a `/` in it must not become two segments and hit a different route.
    const { client, calls } = makeClient();
    await client.getProfile('a/b#c?d');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/v1/profiles/a%2Fb%23c%3Fd');
  });
});
