# @scalebrowser/sdk

Official **Node / TypeScript SDK** for the [Scalebrowser](https://scalebrowser.net)
daemon: a typed REST client plus a **direct-CDP driver plane**.

The driver plane is deliberately **direct-CDP (nodriver-style), not Playwright /
Puppeteer**: anti-bot stacks block the Playwright control plane independently of
how good the browser patches are, so this SDK speaks the Chrome DevTools
Protocol over a raw websocket and never calls `Runtime.enable`.

## Install

```bash
npm install @scalebrowser/sdk
```

Ships dual ESM + CJS with full type declarations, and needs Node ≥ 18. The SDK
is MIT-licensed, and its source is public at
[blackdiamond-labs/scalebrowser-node](https://github.com/blackdiamond-labs/scalebrowser-node):
npm builds every release there and publishes it with a provenance attestation.
The daemon it talks to is a separate, licensed product.

## Quickstart

```ts
import { ScalebrowserClient } from '@scalebrowser/sdk';

const sb = new ScalebrowserClient({
  baseUrl: 'http://127.0.0.1:8787', // daemon native API (default)
  token: process.env.SCALEBROWSER_TOKEN,
});

// Create a coherent, per-seed-unlinkable profile.
const profile = await sb.createProfile({ name: 'acct-01' });

// Start it + open a direct-CDP session. `await using` stops the profile and
// closes CDP when the block exits.
await using session = await sb.launch(profile.id, { headless: true });

await session.cdp.navigate('https://example.com');
const title = await session.cdp.evaluate<string>('document.title');

// Humanized, trusted input is routed through the daemon (real OS/CDP events).
await session.cdp.humanizeMove(120, 220);
await session.cdp.humanizeClick(120, 220);
```

Without `await using` (or for explicit control):

```ts
const { cdp_ws } = await sb.startProfile(profile.id, { headless: true });
const cdp = await sb.connectCdp(cdp_ws, profile.id);
try {
  await cdp.navigate('https://example.com');
} finally {
  cdp.close();
  await sb.stopProfile(profile.id);
}
```

## REST surface

Every `/v1` endpoint is a typed method on `ScalebrowserClient`:

- **Profiles**: `listProfiles`, `getProfile`, `createProfile`, `updateProfile`,
  `deleteProfile`, `startProfile`, `stopProfile`
- **Bulk**: `bulkCreateProfiles`, `bulkStart`, `bulkStop`, `bulkDelete`,
  `bulkAssignProxy`
- **Groups / Presets**: `listGroups`/`createGroup`/`getGroup`/`updateGroup`/`deleteGroup`,
  `listPresets`/`createPreset`/`getPreset`/`updatePreset`/`deletePreset`,
  `getPersonaConstraints`. A preset is `config` (what the profiles do:
  `geo_mode`, `proxy_id`, …) plus `constraints` (what they are: `country`, which
  pins the persona's language, timezone and voices). Both are typed and the daemon
  refuses an unknown key with a 400, so read the valid regions from
  `getPersonaConstraints()` rather than hardcoding them.
- **Proxies**: `listProxies`, `createProxy`, `getProxy`, `updateProxy`,
  `deleteProxy`, `checkProxy`, `checkProxyConfig` (probe a config before you save
  it; pass `id` to reuse an existing proxy's stored credentials). Credentials
  are write-only, never returned
- **Extensions**: `listExtensions`, `attachExtension`, `detachExtension`, plus
  the daemon-wide library (`uploadExtension`, `getLibraryExtension`,
  `deleteLibraryExtension`). An attached package IS loaded into the browser at
  launch, under the canonical Web-Store id its own key derives
- **Credentials**: `listCredentials`, `putCredential`, `revealCredential`
  (needs the vault password), `exportCredentials`, `importCredentials`
- **Cookies**: `revealCookies`, the one route a cookie VALUE leaves through,
  behind the same vault password
- **Sessions**: `exportSession`, `importSession`
- **Mailboxes**: `listInboxes`, `createInbox`, `updateInbox`, `deleteInbox`,
  `getInboxBindings`, `bindInbox`, `unbindInbox`, which is where a profile's
  confirmation codes arrive
- **Passkeys**: `listPasskeys`, `deletePasskey`. Metadata only: the private key
  has no field and no endpoint
- **Agent runs**: `listRuns`, `getRun`, `listRunSteps`, `getRunShot`,
  `getActivity`. Read-only, all of it
- **Interruptions**: `listInterruptionLocks`, `setInterruptionLock`,
  `listInterruptionRules`, `setInterruptionRule`, `deleteInterruptionRule`: who
  may answer when the browser asks something
- **Artifacts**: `putArtifact` (hand the daemon a file to upload later),
  `getArtifact` (fetch a screenshot, download or saved PDF as bytes)
- **Input**: `sendInput`
- **Metrics / Account / Health**: `getMetrics`, `getAccount`, `health`, `ready`.
  The first two answer 404 on a daemon without them, which the SDK treats as
  information rather than as an error: metrics are then derived from profile
  state, and the account reads `licensed: false`, which is what "self-hosted, no
  control plane" means

Errors map to typed exceptions carrying the daemon's numeric code (4001–4012):

```ts
import { ApiError, ErrorCode } from '@scalebrowser/sdk';

try {
  await sb.startProfile(id);
} catch (err) {
  if (err instanceof ApiError && err.code === ErrorCode.Capacity) {
    // 4003: capacity exceeded
  }
}
```

## Lifecycle events (SSE)

```ts
// callback form
const unsubscribe = sb.subscribeEvents({
  onEvent: (e) => {
    if (e.type === 'profile_crashed') console.warn(e.profile_id, e.reason);
  },
});

// or async-iterator form
for await (const e of sb.events()) {
  if (e.type === 'profile_started') console.log(e.cdp_ws);
}
```

## Direct-CDP driver

`CdpSession` (returned by `connectCdp` / `launch`) gives you:

- `send<T>(method, params?)`: raw CDP command, awaited by id (concurrent-safe)
- `navigate(url, { wait, timeout })`, `evaluate<T>(expr, { isolated })`
- `createIsolatedWorld(frameId?, worldName?)`
- `attachToPage({ targetId?, create?, url? })`
- `on(method, cb)` / `events()`: CDP event subscription scoped to the session
- `humanizeMove` / `humanizeClick` / `humanizeType` / `humanizeScroll`
- `close()`

## Security

- Bearer token is sent on every request and the SSE/CDP handshakes; it is
  **never logged** (the client's inspect output masks it).
- Proxy credentials are injected by the daemon and never travel over CDP.
- **The CDP endpoint is guarded by the OS user, not by that token.** The engine's
  DevTools port has no authentication of its own: it answers a bogus bearer with
  `200`, measured, so the engine drops any connection whose peer process runs as
  a different user. Nothing to configure and nothing to pass: your process is the
  one that started the profile, so it is on the allowed side. A helper running as
  another account will not get in, by design.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm test            # vitest (unit; e2e skipped unless SCALEBROWSER_E2E=1)
```

The env-gated end-to-end test runs the full path against a real daemon + mock
engine:

```bash
SCALEBROWSER_E2E=1 SCALEBROWSER_BASE_URL=http://127.0.0.1:8787 \
  SCALEBROWSER_TOKEN=… npm test
```
