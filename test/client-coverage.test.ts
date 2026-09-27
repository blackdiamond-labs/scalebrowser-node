/**
 * The endpoints added on 2026-08-20 to close a measured gap: the daemon served
 * 57 routes under `/v1` and this client reached 37. Runs, mailboxes, passkeys,
 * interruptions, artifacts, the cookie reveal and the account view were all
 * missing, and nothing failed. A test on the daemon's side now counts them.
 *
 * These cases pin the WIRE FORM: method, path, query and body. What they cannot
 * pin is whether the daemon really answers in the shape declared in
 * `types-*.ts`: a mock answers whatever it is told to. That is what the
 * env-gated e2e test is for.
 */
import { describe, expect, it } from 'vitest';
import { ScalebrowserClient } from '../src/client';
import { ApiError } from '../src/errors';
import type { FetchLike } from '../src/events';
import type { VideoPresetConfig } from '../src/types';

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response>;

function makeClient(handler: Handler): { client: ScalebrowserClient; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    }
    const raw = init?.body;
    const body =
      raw === undefined || raw === null ? undefined : typeof raw === 'string' ? JSON.parse(raw) : raw;
    calls.push({ method: init?.method ?? 'GET', url: String(input), body, headers });
    return Promise.resolve(handler(calls[calls.length - 1]!));
  }) as FetchLike;
  return {
    client: new ScalebrowserClient({ baseUrl: 'http://daemon', token: 'secret-token', fetch: fetchImpl }),
    calls,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('agent runs', () => {
  it('lists runs with the paging query', async () => {
    const { client, calls } = makeClient(() => json([]));
    await client.listRuns({ profile_id: 'p1', limit: 10, offset: 20 });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://daemon/v1/runs?profile_id=p1&limit=10&offset=20');
  });

  it('fetches one run and its steps', async () => {
    const { client, calls } = makeClient((req) =>
      req.url.includes('/steps') ? json([{ seq: 1, kind: 'page' }]) : json({ id: 'r1' }),
    );
    const run = await client.getRun('r1');
    const steps = await client.listRunSteps('r1', { limit: 5 });
    expect(run.id).toBe('r1');
    expect(steps[0]?.seq).toBe(1);
    expect(calls[0]?.url).toBe('http://daemon/v1/runs/r1');
    expect(calls[1]?.url).toBe('http://daemon/v1/runs/r1/steps?limit=5');
  });

  it('encodes an id that would otherwise change the path', async () => {
    const { client, calls } = makeClient(() => json({ id: 'x' }));
    await client.getRun('a/b?c');
    expect(calls[0]?.url).toBe('http://daemon/v1/runs/a%2Fb%3Fc');
  });

  it('returns a run still as bytes, with its filename', async () => {
    const { client } = makeClient(
      () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-disposition': 'attachment; filename="shot.jpg"',
          },
        }),
    );
    const shot = await client.getRunShot('r1', 3);
    expect(Array.from(shot.bytes)).toEqual([0xff, 0xd8, 0xff]);
    expect(shot.content_type).toBe('image/jpeg');
    expect(shot.filename).toBe('shot.jpg');
  });

  it('maps a failed byte fetch to ApiError, not to a broken buffer', async () => {
    const { client } = makeClient(() => json({ code: 4001, message: 'gone' }, 404));
    const err = await client.getArtifact('missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(4001);
  });

  it('reads the activity snapshot', async () => {
    const { client, calls } = makeClient(() => json({ sampled_at: 1, profiles: [] }));
    const snapshot = await client.getActivity();
    expect(snapshot.profiles).toEqual([]);
    expect(calls[0]?.url).toBe('http://daemon/v1/activity');
  });
});

describe('mailboxes', () => {
  it('creates, updates and deletes a mailbox', async () => {
    const { client, calls } = makeClient(() => json({ id: 'i1' }));
    const body = { name: 'm', host: 'imap.test', port: 993, user: 'u', password: 'p', tls: true, folder: 'INBOX' };
    await client.createInbox(body);
    await client.updateInbox('i1', { ...body, password: undefined });
    await client.deleteInbox('i1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://daemon/v1/inboxes',
      'PUT http://daemon/v1/inboxes/i1',
      'DELETE http://daemon/v1/inboxes/i1',
    ]);
    // An omitted password means "keep the stored one", so it must not be sent.
    expect((calls[1]?.body as Record<string, unknown>)['password']).toBeUndefined();
  });

  it('binds and unbinds a profile channel', async () => {
    const { client, calls } = makeClient(() => json({ bindings: [] }));
    await client.bindInbox('p1', { channel: 'email', inbox_id: 'i1' });
    await client.unbindInbox('p1', 'email');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT http://daemon/v1/profiles/p1/inbox',
      'DELETE http://daemon/v1/profiles/p1/inbox/email',
    ]);
  });
});

describe('passkeys', () => {
  it('lists and retires', async () => {
    const { client, calls } = makeClient(() => json([]));
    await client.listPasskeys('p1');
    await client.deletePasskey('p1', 'cred-1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://daemon/v1/profiles/p1/passkeys',
      'DELETE http://daemon/v1/profiles/p1/passkeys/cred-1',
    ]);
  });
});

describe('interruptions', () => {
  it('reads locks and sets one', async () => {
    const { client, calls } = makeClient(() =>
      json({ kinds: [], locked_by_default: [], rows: [], effective: [] }),
    );
    await client.listInterruptionLocks();
    await client.setInterruptionLock({ kind: 'geolocation', decision: 'always_block' });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toBe('http://daemon/v1/interruptions/locks');
  });

  it("sends the browser's own camelCase choice, which is not the API's usual casing", async () => {
    const { client, calls } = makeClient(() => json({}));
    await client.setInterruptionRule({ origin: 'https://x.test', kind: 'notifications', choice: 'allowOnce' });
    expect((calls[0]?.body as Record<string, unknown>)['choice']).toBe('allowOnce');
  });

  it('deletes a rule by query, not by path', async () => {
    const { client, calls } = makeClient(() => json({}));
    await client.deleteInterruptionRule({ origin: 'https://x.test', kind: 'notifications' });
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(
      'http://daemon/v1/interruptions/rules?origin=https%3A%2F%2Fx.test&kind=notifications',
    );
  });
});

describe('artifacts', () => {
  it('uploads raw bytes with the name as a query parameter', async () => {
    const { client, calls } = makeClient(() => json({ artifact_id: 'a1', size_bytes: 3, name: 'x.csv' }, 201));
    const result = await client.putArtifact('p1', new Uint8Array([1, 2, 3]), 'x.csv');
    expect(result.artifact_id).toBe('a1');
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles/p1/artifacts?name=x.csv');
    expect(calls[0]?.headers['Content-Type']).toBe('application/octet-stream');
    expect(calls[0]?.body).toBeInstanceOf(Uint8Array);
  });
});

describe('cookies', () => {
  it('reveals values only through the vault password', async () => {
    const { client, calls } = makeClient(() => json({ domain: 'x.test', cookies: [] }));
    await client.revealCookies('p1', { vault_password: 'pw', domain: 'x.test' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles/p1/cookies/reveal');
    expect((calls[0]?.body as Record<string, unknown>)['vault_password']).toBe('pw');
  });
});

describe('account + health', () => {
  it('reads the licence state', async () => {
    const { client } = makeClient(() =>
      json({ licensed: true, plan: 'solo', running_local: 1, profiles_local: 4, permits_launch: true }),
    );
    const account = await client.getAccount();
    expect(account.licensed).toBe(true);
    expect(account.concurrency).toBeUndefined();
  });

  it('reads a 404 pessimistically rather than throwing', async () => {
    // A daemon with no control plane has no such route. Throwing here would make
    // every self-hosted install look broken.
    const { client } = makeClient(() => json({ code: 4001, message: 'no route' }, 404));
    const account = await client.getAccount();
    // An unanswered account means nothing is connected and nothing may
    // start. The optimistic reading is what let an unpaired machine look usable.
    expect(account.licensed).toBe(false);
    expect(account.signed_in).toBe(false);
    expect(account.permits_launch).toBe(false);
  });

  it('asks which installation answered, not just whether one did', async () => {
    // The two questions are different whenever a machine holds more than one
    // installation, and telling them apart is the whole reason this route exists:
    // a port is a preference, the data directory is the identity.
    const { client, calls } = makeClient(() =>
      json({
        native_addr: '127.0.0.1:8787',
        data_dir: 'C:\\Users\\Someone\\AppData\\Local\\Scalebrowser',
        data_dir_key: 'c:\\users\\someone\\appdata\\local\\scalebrowser',
        executable: 'C:\\Program Files\\Scalebrowser\\scalebrowser-daemon.exe',
      }),
    );
    const conn = await client.getConnection();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://daemon/v1/connection');
    expect(conn.data_dir_key).toBe('c:\\users\\someone\\appdata\\local\\scalebrowser');
    expect(conn.executable).toContain('scalebrowser-daemon');
    // Absent when the adapter is off, and that is a real answer rather than a gap.
    expect(conn.adspower_addr).toBeUndefined();
  });

  it('asks health without needing a token', async () => {
    const { client, calls } = makeClient(() => json({ status: 'ok', service: 'scalebrowser-api' }));
    await client.health();
    await client.ready();
    expect(calls.map((c) => c.url)).toEqual(['http://daemon/health', 'http://daemon/health/ready']);
  });
});

describe('video preset preview', () => {
  // The editor's live picture (2026-08-29): a still of the sample film under an
  // UNSAVED config, the moments the daemon derived from the scene, and a clip
  // window. The daemon parses `config` strictly, so the body goes out verbatim.
  it('asks for a still under an unsaved config and reads the derived moments', async () => {
    const { client, calls } = makeClient(() =>
      json({
        width: 1920,
        height: 1080,
        fps: 60,
        frames: 1230,
        frame: 37,
        moments: [{ key: 'click', label: 'Click', frame: 37, from: 0, to: 120 }],
        hidden: [{ field: 'ai_label', why: 'needs a voice' }],
        notes: [],
        image: 'data:image/jpeg;base64,/9j/',
      }),
    );
    const config = { camera: { zoom: 'strong' } } as unknown as VideoPresetConfig;
    const still = await client.previewVideoPreset({ config, moment: 'click' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/video-presets/preview');
    expect(calls[0]?.body).toEqual({ config, moment: 'click' });
    expect(still.frame).toBe(37);
    expect(still.moments[0]?.from).toBe(0);
    expect(still.moments[0]?.to).toBe(120);
    expect(still.hidden[0]?.field).toBe('ai_label');
    expect(still.image.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('renders a clip window, then fetches its bytes by id', async () => {
    const id = 'a'.repeat(64);
    const { client, calls } = makeClient((req) =>
      req.url.endsWith('/preview/clip')
        ? json({
            id,
            from_frame: 0,
            to_frame: 90,
            fps: 60,
            width: 1920,
            height: 1080,
            frames: 90,
            seconds: 1.5,
            bytes: 4,
            encoder: 'openh264',
            cached: false,
            audio: false,
          })
        : new Response(new Uint8Array([0x00, 0x00, 0x00, 0x18]), {
            status: 200,
            headers: { 'content-type': 'video/mp4' },
          }),
    );
    const config = {} as VideoPresetConfig;
    const clip = await client.previewVideoPresetClip({ config, from_frame: 0, to_frame: 90 });
    const file = await client.downloadVideoPresetClip(clip.id);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://daemon/v1/video-presets/preview/clip');
    expect(calls[0]?.body).toEqual({ config, from_frame: 0, to_frame: 90 });
    expect(clip.frames).toBe(90);
    expect(clip.audio).toBe(false);
    expect(calls[1]?.method).toBe('GET');
    expect(calls[1]?.url).toBe(`http://daemon/v1/video-presets/preview/clip/${id}`);
    expect(file.content_type).toBe('video/mp4');
    expect(Array.from(file.bytes)).toEqual([0x00, 0x00, 0x00, 0x18]);
  });

  // -- Tasks and the profile memory (2026-08-29) ------------------------------

  const task = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    profile_id: 'p1',
    profile_name: 'reddit-01',
    profile_timezone: 'America/Chicago',
    title: 'Publish post p017',
    state: 'open',
    due_at: 1_800_000_000,
    created_at: 7,
    claimed_at: null,
    finished_at: null,
    last_attempt_at: null,
    ...over,
  });

  /**
   * The list is fleet-wide by default, which is the whole point of the endpoint:
   * a per-profile shape would make a client ask twenty times and sort the
   * answers itself.
   */
  it('asks for every profile\'s tasks by default and puts the filter in the query', async () => {
    const { client, calls } = makeClient(() => json([task()]));
    const rows = await client.listTasks();
    expect(rows[0]?.title).toBe('Publish post p017');
    expect(calls[0]?.url).toBe('http://daemon/v1/tasks');

    await client.listTasks({ profile_id: 'p1', state: 'open', due_before: 99 });
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe('/v1/tasks');
    expect(url.searchParams.get('profile_id')).toBe('p1');
    expect(url.searchParams.get('state')).toBe('open');
    expect(url.searchParams.get('due_before')).toBe('99');
  });

  it('writes one task per profile and reports the ones that are gone', async () => {
    const { client, calls } = makeClient(() =>
      json({ created: [task()], missing: ['gone'] }),
    );
    const made = await client.createTasks({
      profile_ids: ['p1', 'gone'],
      title: 'Publish post p017',
      due_at: 1_800_000_000,
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({
      profile_ids: ['p1', 'gone'],
      title: 'Publish post p017',
      due_at: 1_800_000_000,
    });
    expect(made.missing).toEqual(['gone']);
  });

  /** This surface cancels and nothing else: `done` is a claim about work. */
  it('sends exactly one transition when cancelling', async () => {
    const { client, calls } = makeClient(() => json(task({ state: 'cancelled' })));
    const cancelled = await client.cancelTask('t 1');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('http://daemon/v1/tasks/t%201');
    expect(calls[0]?.body).toEqual({ state: 'cancelled' });
    expect(cancelled.state).toBe('cancelled');
  });

  it('round-trips a profile memory verbatim', async () => {
    const { client, calls } = makeClient(() =>
      json({
        content: '- English only',
        path: '/data/profiles/p1/PROFILE.md',
        updated_at: 8,
        max_bytes: 262_144,
      }),
    );
    const memory = await client.getProfileMemory('p1');
    expect(calls[0]?.url).toBe('http://daemon/v1/profiles/p1/memory');
    expect(memory.max_bytes).toBe(262_144);

    // Trailing spaces and CRLF survive: the text is the customer's own rules,
    // and a helpful trim in a client would edit them.
    await client.putProfileMemory('p1', '- English only   \r\n- one post a day');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.body).toEqual({ content: '- English only   \r\n- one post a day' });

    await client.deleteProfileMemory('p1');
    expect(calls[2]?.method).toBe('DELETE');
  });
});
