import { describe, expect, it } from 'vitest';
import { ScalebrowserClient } from '../src/client';
import { ApiError, NetworkError } from '../src/errors';
import type { FetchLike } from '../src/events';
import type { Profile } from '../src/types';

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response>;

function makeClient(handler: Handler, opts: { token?: string | null } = {}): {
  client: ScalebrowserClient;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    }
    // A `.crx` upload sends raw bytes; only a JSON body is parsed.
    const raw = init?.body;
    const body =
      raw === undefined || raw === null ? undefined : typeof raw === 'string' ? JSON.parse(raw) : raw;
    const req: RecordedRequest = { method: init?.method ?? 'GET', url: String(input), body, headers };
    calls.push(req);
    return Promise.resolve(handler(req));
  }) as FetchLike;
  return {
    client: new ScalebrowserClient({ baseUrl: 'http://daemon', token: opts.token ?? 'secret-token', fetch: fetchImpl }),
    calls,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const sampleProfile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p1',
    name: 'acct-01',
    runtime_state: 'stopped',
    enabled: true,
    crash_reason: null,
    pid: null,
    run_lock: null,
    seed: 'seed-1',
    engine_version: '120.0',
    persona: {} as Profile['persona'],
    gpu_persona: null,
    group_id: null,
    proxy_id: null,
    geo_mode: 'follow_exit',
    expected_country: null,
    data_dir: '/data/p1',
    created_at: 1,
    last_open_at: null,
    ...over,
  }) as Profile;

describe('ScalebrowserClient REST', () => {
  it('lists profiles with query params and Bearer auth', async () => {
    const { client, calls } = makeClient(() => json([sampleProfile()]));
    const profiles = await client.listProfiles({ state: 'running', q: 'acct', limit: 50 });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.id).toBe('p1');
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles?state=running&q=acct&limit=50');
    expect(calls[0]?.headers['Authorization']).toBe('Bearer secret-token');
  });

  it('creates a profile (POST body round-trips)', async () => {
    const { client, calls } = makeClient((req) => json(sampleProfile({ name: (req.body as { name: string }).name })));
    const created = await client.createProfile({ name: 'acct-02', geo_mode: 'strict_expected' });
    expect(created.name).toBe('acct-02');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ name: 'acct-02', geo_mode: 'strict_expected' });
    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('carries a chosen region into the create body', async () => {
    // The coverage gate compares PATHS, so a field the types offer and the
    // client drops would pass every other check in this repo.
    const { client, calls } = makeClient(() => json(sampleProfile()));
    await client.createProfile({ name: 'de-01', persona_country: 'DE' });
    expect(calls[0]?.body).toEqual({ name: 'de-01', persona_country: 'DE' });
  });

  it('starts a profile → StartProfileResult', async () => {
    // Mirrors the daemon's answer to a profile start.
    const { client } = makeClient(() =>
      json({
        profile_id: 'p1',
        cdp_ws: 'ws://127.0.0.1:9222/devtools/browser/x',
        debug_port: 9222,
        headless: true,
        pid: 4242,
        started_at: 1,
      }),
    );
    const res = await client.startProfile('p1', { headless: true });
    expect(res.profile_id).toBe('p1');
    expect(res.cdp_ws).toMatch(/^ws:\/\//);
    expect(res.debug_port).toBe(9222);
    expect(res.headless).toBe(true);
  });

  it('handles 204 No Content on delete', async () => {
    const { client } = makeClient(() => new Response(null, { status: 204 }));
    await expect(client.deleteProfile('p1')).resolves.toBeUndefined();
  });

  it('bulk assign-proxy maps proxyId → proxy_id', async () => {
    const { client, calls } = makeClient(() => json({ ok: true }));
    await client.bulkAssignProxy(['a', 'b'], 'proxy-9');
    expect(calls[0]?.url).toBe('http://daemon/v1/bulk/assign-proxy');
    expect(calls[0]?.body).toEqual({ ids: ['a', 'b'], proxy_id: 'proxy-9' });
  });

  it('checks a proxy (POST /check)', async () => {
    const { client, calls } = makeClient(() => json({ healthy: true, exit_ip: '1.2.3.4', country: 'US', ja4t_mismatch: false }));
    const res = await client.checkProxy('proxy-1');
    expect(res.healthy).toBe(true);
    expect(res.country).toBe('US');
    expect(calls[0]?.url).toBe('http://daemon/v1/proxies/proxy-1/check');
  });

  it('bulk create forwards name_prefix + group_id, omits them when unset', async () => {
    const { client, calls } = makeClient(() => json([]));
    await client.bulkCreateProfiles({ preset_id: 'ps1', count: 3, name_prefix: 'acct', group_id: 'g7' });
    expect(calls[0]?.body).toEqual({ preset_id: 'ps1', count: 3, name_prefix: 'acct', group_id: 'g7' });
    await client.bulkCreateProfiles({ preset_id: 'ps1', count: 3 });
    expect(calls[1]?.body).toEqual({ preset_id: 'ps1', count: 3 });
  });

  it('drives the preset CRUD surface with typed halves', async () => {
    const preset = {
      id: 'ps1',
      name: 'DE shoppers',
      constraints: { country: 'DE' },
      config: { geo_mode: 'follow_exit' as const },
      created_at: 1,
    };
    const { client, calls } = makeClient(() => json(preset));

    await client.createPreset({
      name: 'DE shoppers',
      constraints: { country: 'DE' },
      config: { geo_mode: 'follow_exit' },
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/presets');
    expect(calls[0]?.body).toEqual({
      name: 'DE shoppers',
      constraints: { country: 'DE' },
      config: { geo_mode: 'follow_exit' },
    });

    await client.updatePreset('ps 1', { name: 'renamed' });
    expect(calls[1]?.method).toBe('PATCH');
    // The id is a path segment, so it must be encoded, not concatenated.
    expect(calls[1]?.url).toBe('http://daemon/v1/presets/ps%201');

    await client.getPreset('ps1');
    expect(calls[2]?.method).toBe('GET');
    await client.deletePreset('ps1');
    expect(calls[3]?.method).toBe('DELETE');
  });

  it('reads the constrainable regions from the daemon, not from a copy', async () => {
    const { client, calls } = makeClient(() => json({ countries: ['DE', 'GB', 'US'] }));
    const opts = await client.getPersonaConstraints();
    expect(calls[0]?.url).toBe('http://daemon/v1/persona/constraints');
    expect(opts.countries).toEqual(['DE', 'GB', 'US']);
  });

  it('checks an unsaved proxy config (POST /v1/proxies/check)', async () => {
    const { client, calls } = makeClient(() =>
      json({ healthy: true, exit_ip: '5.6.7.8', country: 'DE', is_mobile: true, latency_ms: 240 }),
    );
    const res = await client.checkProxyConfig({ kind: 'http', host: 'gw.test', port: 8080, username: 'u', password: 'p' });
    expect(calls[0]?.url).toBe('http://daemon/v1/proxies/check');
    expect(res.is_mobile).toBe(true);
    expect(res.latency_ms).toBe(240);
    // Nothing is persisted, so no id is sent unless the caller is in edit-mode.
    expect((calls[0]?.body as Record<string, unknown>).id).toBeUndefined();
  });

  it('checks a proxy config in edit-mode by id (stored credentials)', async () => {
    const { client, calls } = makeClient(() => json({ healthy: true, exit_ip: null, country: null }));
    await client.checkProxyConfig({ kind: 'http', host: 'h', port: 1, id: 'px1' });
    expect((calls[0]?.body as Record<string, unknown>).id).toBe('px1');
  });

  it('assigns, lists and unassigns a library extension (policy on every reply)', async () => {
    const EXT_ID = 'kinboipjmocapjnbohnmofgmdipafabp';
    const dir = `/data/sb-extensions/p1/${EXT_ID}/1.0.0`;
    const reply = (ids: string[]) =>
      json({
        profile_id: 'p1',
        extensions: ids,
        packages: ids.map((id) => ({
          id,
          name: 'uBlock',
          version: '1.0.0',
          public_key: 'AAAA',
          dir: `/data/extensions/${id}/1.0.0`,
          added_at: 1,
        })),
        policy: {
          id_model: 'canonical',
          delivery: 'per_profile_copy',
          engine_switches: ids.length
            ? [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`]
            : [],
        },
      });
    const { client, calls } = makeClient((req) => reply(req.method === 'POST' ? [EXT_ID] : []));

    const attached = await client.attachExtension('p1', EXT_ID);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles/p1/extensions');
    expect(calls[0]?.body).toEqual({ ext_ref: EXT_ID });
    expect(attached.extensions).toEqual([EXT_ID]);
    expect(attached.packages[0]?.name).toBe('uBlock');
    // The launch loads the profile's OWN copy, under the canonical id.
    expect(attached.policy.engine_switches).toContain(`--load-extension=${dir}`);
    expect(attached.policy.id_model).toBe('canonical');

    await client.listExtensions('p1');
    expect(calls[1]?.method).toBe('GET');

    // The id to unassign travels in a DELETE body, and it must not be dropped.
    await client.detachExtension('p1', EXT_ID);
    expect(calls[2]?.method).toBe('DELETE');
    expect(calls[2]?.body).toEqual({ ext_ref: EXT_ID });
  });

  it('uploads a .crx as raw bytes, not JSON', async () => {
    // Wrapping the package in JSON would corrupt it; the daemon parses the CRX
    // header straight off the body.
    const { client, calls } = makeClient(() =>
      json({ id: 'aaaa', name: 'x', version: '1.0', public_key: 'K', dir: '/d', added_at: 1 }),
    );
    const crx = new Uint8Array([0x43, 0x72, 0x32, 0x34, 0x03, 0x00, 0x00, 0x00]);

    const ext = await client.uploadExtension(crx);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/extensions');
    expect(calls[0]?.headers?.['Content-Type']).toBe('application/octet-stream');
    expect(ext.id).toBe('aaaa');
  });

  it('exports a session bundle', async () => {
    const { client } = makeClient(() => json({ bundle: 'enc:abc' }));
    const res = await client.exportSession('p1', { password: 'pw', kinds: ['cookies'] });
    expect(res.bundle).toBe('enc:abc');
  });

  it('sends trusted input', async () => {
    const { client, calls } = makeClient(() => json({ ok: true }));
    await client.sendInput('p1', { action: 'click', x: 10, y: 20, humanize: true });
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles/p1/input');
    expect(calls[0]?.body).toEqual({ action: 'click', x: 10, y: 20, humanize: true });
  });

  it('getMetrics falls back to deriving from profiles on 404', async () => {
    const { client, calls } = makeClient((req) => {
      if (req.url.includes('/v1/metrics')) return json({ code: 4001, message: 'not found' }, 404);
      return json([sampleProfile({ runtime_state: 'running' }), sampleProfile({ id: 'p2', runtime_state: 'stopped' })]);
    });
    const metrics = await client.getMetrics();
    expect(metrics.running).toBe(1);
    expect(metrics.capacity_max_concurrent).toBe(64);
    expect(metrics.source).toBe('derived');
    expect(metrics.availability?.gpu).toBe('unavailable');
    expect(metrics.profiles).toEqual([]);
    expect(calls.map((c) => c.url)).toContain('http://daemon/v1/metrics');
  });

  it('does not leak the token via inspection', () => {
    const { client } = makeClient(() => json({}), { token: 'super-secret' });
    const inspected = (client as unknown as { [k: symbol]: () => string })[Symbol.for('nodejs.util.inspect.custom')]();
    expect(inspected).not.toContain('super-secret');
    expect(inspected).toContain('***');
  });
});

describe('ScalebrowserClient error mapping (4001–4012)', () => {
  const cases: { code: number; status: number; auth: boolean }[] = [
    { code: 4001, status: 404, auth: false },
    { code: 4002, status: 409, auth: false },
    { code: 4003, status: 429, auth: false },
    { code: 4004, status: 503, auth: false },
    { code: 4005, status: 409, auth: false },
    { code: 4006, status: 409, auth: false },
    { code: 4007, status: 409, auth: false },
    { code: 4010, status: 401, auth: true },
  ];

  for (const { code, status, auth } of cases) {
    it(`maps code ${code} (HTTP ${status})`, async () => {
      const { client } = makeClient(() => json({ code, message: `err ${code}` }, status));
      const err = await client.startProfile('p1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe(code);
      expect(apiErr.status).toBe(status);
      expect(apiErr.isAuthError).toBe(auth);
    });
  }

  it('wraps fetch rejections as NetworkError', async () => {
    const { client } = makeClient(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(client.listProfiles()).rejects.toBeInstanceOf(NetworkError);
  });
});
