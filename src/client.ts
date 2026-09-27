/**
 * `ScalebrowserClient`: the one typed HTTP surface every REST call goes
 * through. It centralises the base URL, Bearer auth, query-string building, JSON
 * (de)serialisation and error mapping (`{ code, message }` → {@link ApiError}).
 * Backend endpoint drift is a change in THIS file (paths) plus `types.ts`
 * (shapes), nowhere else.
 */
import { applyMixins, ClientCore, enc } from './client-core';
import { ControlApi } from './client-control';
import { ExtensionsApi } from './client-extensions';
import { IdentityApi } from './client-identity';
import { TasksApi } from './client-tasks';
import { RunsApi } from './client-runs';
import { VideosApi } from './client-videos';
import { ApiError } from './errors';
import {
  type StreamHandlers,
  eventStream,
  subscribeEvents,
} from './events';
import { type CdpSession, openCdpSession } from './cdp';
import type {
  AuditStatus,
  ExitStatus,
  CreateGroupBody,
  CreatePresetBody,
  Group,
  PersonaConstraintOptions,
  Preset,
  Profile,
  Proxy,
  ProxyRow,
  SessionExportBody,
  SessionExportResult,
  SessionImportBody,
  TrustedInputBody,
  UpdateGroupBody,
  UpdatePresetBody,
  VideoPreset,
  VideoPresetClip,
  VideoPresetClipBody,
  VideoPresetPreview,
  VideoPresetPreviewBody,
} from './types'
import type {
  } from './types-credentials'
import type {
  LifecycleEvent,
} from './types-events'
import type {
  Metrics,
} from './types-metrics'
import type {
  BulkAssignProxyBody,
  BulkCreateBody,
  BulkStartResult,
  CheckProxyConfigBody,
  CreateProfileBody,
  CreateProxyBody,
  ListProfilesParams,
  ProfileCounts,
  ProfileIdsResult,
  ProxyCheckResult,
  StartProfileBody,
  StartProfileResult,
  ReleaseProfileResult,
  StopProfileResult,
  TakeoverResult,
  UpdateProfileBody,
  UpdateProxyBody,
} from './types-requests';
import type { ArtifactBytes, ExitRuleStatus, RemoteStatus } from './types-control';


/** The daemon's own default capacity limits. */
export const DEFAULT_CAPACITY = {
  max_concurrent: 64,
  ram_budget_mb: 24_576,
  vram_budget_mb: null as number | null,
};


/** A live, CDP-driven browser launched via {@link ScalebrowserClient.launch}. */
export interface LaunchHandle {
  /** The page-bound CDP session. */
  readonly cdp: CdpSession;
  /** The `start` result (`cdp_ws`, `debug_port`, `headless`). */
  readonly result: StartProfileResult;
  /** Close the CDP connection and stop the profile. */
  stop(): Promise<void>;
  /** `await using` support; calls {@link stop}. */
  [Symbol.asyncDispose](): Promise<void>;
}

export class ScalebrowserClient extends ClientCore {
  // ── Profiles ───────────────────────────────────────────────────────────────

  listProfiles(params: ListProfilesParams = {}, signal?: AbortSignal): Promise<Profile[]> {
    return this.request<Profile[]>('GET', '/v1/profiles', undefined, {
      query: {
        group: params.group,
        state: params.state,
        q: params.q,
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        order: params.order,
      },
      signal,
    });
  }

  /**
   * Every id matching `params`, unpaged: what "act on all matches" needs.
   *
   * `listProfiles` is paged, so acting on "everything" from it only ever covers the
   * page you fetched. Asking for ids costs one request and no persona payloads.
   */
  listProfileIds(params: ListProfilesParams = {}, signal?: AbortSignal): Promise<ProfileIdsResult> {
    return this.request<ProfileIdsResult>('GET', '/v1/profiles/ids', undefined, {
      query: {
        group: params.group,
        state: params.state,
        q: params.q,
        sort: params.sort,
        order: params.order,
      },
      signal,
    });
  }

  /**
   * How many profiles match `params`, split by runtime state. One request, and
   * its size does not grow with the fleet.
   *
   * `listProfiles` is paged and answers a bare array, so counting what came back
   * counts the page. `listProfileIds` carries the same total but ships an
   * identifier per profile to do it, and cannot split by state at all.
   *
   * `params.state` is ignored here on purpose: a caller labelling every state is
   * sitting in one of them.
   */
  countProfiles(params: ListProfilesParams = {}, signal?: AbortSignal): Promise<ProfileCounts> {
    return this.request<ProfileCounts>('GET', '/v1/profiles/count', undefined, {
      query: { group: params.group, q: params.q },
      signal,
    });
  }

  getProfile(id: string, signal?: AbortSignal): Promise<Profile> {
    return this.request<Profile>('GET', `/v1/profiles/${enc(id)}`, undefined, { signal });
  }

  createProfile(body: CreateProfileBody): Promise<Profile> {
    return this.request<Profile>('POST', '/v1/profiles', body);
  }

  updateProfile(id: string, body: UpdateProfileBody): Promise<Profile> {
    return this.request<Profile>('PATCH', `/v1/profiles/${enc(id)}`, body);
  }

  deleteProfile(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/profiles/${enc(id)}`);
  }

  /** Start a profile → CDP ws endpoint. Errors: 4002/4003/4005/4006/4008. */
  startProfile(id: string, body: StartProfileBody = {}): Promise<StartProfileResult> {
    return this.request<StartProfileResult>('POST', `/v1/profiles/${enc(id)}/start`, body);
  }

  stopProfile(id: string): Promise<StopProfileResult> {
    return this.request<StopProfileResult>('POST', `/v1/profiles/${enc(id)}/stop`, {});
  }

  /** Drop the profile's lease, the operator's way out.
   *
   *  An agent releases with its handle; this call needs none. The daemon stops
   *  the browser first when one is still up, then lets the lease go, so a dead
   *  session cannot park the profile until its TTL runs out. `released: false`
   *  is an honest no-op: there was nothing to let go. */
  releaseProfile(id: string): Promise<ReleaseProfileResult> {
    return this.request<ReleaseProfileResult>('POST', `/v1/profiles/${enc(id)}/release`, {});
  }

  /** Ask for a profile that is open on another machine of this account.
   *
   *  Closes nothing here and nothing there: the control plane revokes the holder's
   *  right, the holder closes its own browser at its next heartbeat. Start only
   *  after this answered `free`. Errors: 4012 when it is held elsewhere. */
  takeoverProfile(id: string): Promise<TakeoverResult> {
    return this.request<TakeoverResult>('POST', `/v1/profiles/${enc(id)}/takeover`, {});
  }

  // ── Bulk (PRD §D2) ───────────────────────────────────────────────────────

  bulkCreateProfiles(body: BulkCreateBody): Promise<Profile[]> {
    return this.request<Profile[]>('POST', '/v1/bulk/profiles', body);
  }

  /**
   * Start a batch. `headless` is the ONE visibility decision for the run; omitted
   * means headless, the right default for an unattended client. The daemon stops at
   * the machine's capacity limit and reports how far it got (`started` /
   * `remaining` / `stopped_reason`) instead of failing every remaining id.
   */
  bulkStart(ids: string[], headless?: boolean): Promise<BulkStartResult> {
    return this.request<BulkStartResult>('POST', '/v1/bulk/start', { ids, headless });
  }

  bulkStop(ids: string[]): Promise<unknown> {
    return this.request('POST', '/v1/bulk/stop', { ids });
  }

  bulkDelete(ids: string[]): Promise<unknown> {
    return this.request('POST', '/v1/bulk/delete', { ids });
  }

  bulkAssignProxy(ids: string[], proxyId: string): Promise<unknown> {
    return this.request('POST', '/v1/bulk/assign-proxy', { ids, proxy_id: proxyId } satisfies BulkAssignProxyBody);
  }

  /**
   * Give every id exactly this set of extensions.
   *
   * It REPLACES rather than adds, the same shape as assigning a proxy: picking a
   * set for a batch states what those profiles carry. An empty list is a
   * legitimate "none". An id the library does not hold refuses the whole call.
   */
  bulkAssignExtensions(ids: string[], extRefs: string[]): Promise<unknown> {
    return this.request('POST', '/v1/bulk/assign-extensions', { ids, ext_refs: extRefs });
  }

  // ── Groups & presets ───────────────────────────────────────────────────────

  listGroups(signal?: AbortSignal): Promise<Group[]> {
    return this.request<Group[]>('GET', '/v1/groups', undefined, { signal });
  }
  getGroup(id: string, signal?: AbortSignal): Promise<Group> {
    return this.request<Group>('GET', `/v1/groups/${enc(id)}`, undefined, { signal });
  }
  createGroup(body: CreateGroupBody): Promise<Group> {
    return this.request<Group>('POST', '/v1/groups', body);
  }
  updateGroup(id: string, body: UpdateGroupBody): Promise<Group> {
    return this.request<Group>('PATCH', `/v1/groups/${enc(id)}`, body);
  }
  deleteGroup(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/groups/${enc(id)}`);
  }

  listPresets(signal?: AbortSignal): Promise<Preset[]> {
    return this.request<Preset[]>('GET', '/v1/presets', undefined, { signal });
  }
  getPreset(id: string, signal?: AbortSignal): Promise<Preset> {
    return this.request<Preset>('GET', `/v1/presets/${enc(id)}`, undefined, { signal });
  }
  createPreset(body: CreatePresetBody): Promise<Preset> {
    return this.request<Preset>('POST', '/v1/presets', body);
  }
  updatePreset(id: string, body: UpdatePresetBody): Promise<Preset> {
    return this.request<Preset>('PATCH', `/v1/presets/${enc(id)}`, body);
  }
  deletePreset(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/presets/${enc(id)}`);
  }

  // ── Video presets ──────────────────────────────────────────────────────────

  listVideoPresets(signal?: AbortSignal): Promise<VideoPreset[]> {
    return this.request<VideoPreset[]>('GET', '/v1/video-presets', undefined, { signal });
  }

  getVideoPreset(id: string, signal?: AbortSignal): Promise<VideoPreset> {
    return this.request<VideoPreset>('GET', `/v1/video-presets/${enc(id)}`, undefined, { signal });
  }

  /** The daemon validates `config` strictly and names the failing field path. */
  createVideoPreset(body: { name: string; config?: Record<string, unknown> }): Promise<VideoPreset> {
    return this.request<VideoPreset>('POST', '/v1/video-presets', body);
  }

  /** A built-in preset refuses edits. Duplicate it and edit the copy. */
  updateVideoPreset(
    id: string,
    body: { name?: string; config?: Record<string, unknown> },
  ): Promise<VideoPreset> {
    return this.request<VideoPreset>('PATCH', `/v1/video-presets/${enc(id)}`, body);
  }

  /** The only way to make a built-in preset yours: copy, then edit the copy. */
  duplicateVideoPreset(id: string, body: { name?: string } = {}): Promise<VideoPreset> {
    return this.request<VideoPreset>('POST', `/v1/video-presets/${enc(id)}/duplicate`, body);
  }

  deleteVideoPreset(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/video-presets/${enc(id)}`);
  }

  /** One still of the sample film under an UNSAVED config, drawn by the daemon's own renderer.
   *  `moment` wins over `frame`; both absent means the daemon's default moment. */
  previewVideoPreset(body: VideoPresetPreviewBody, signal?: AbortSignal): Promise<VideoPresetPreview> {
    return this.request<VideoPresetPreview>('POST', '/v1/video-presets/preview', body, { signal });
  }

  /** A clip of the sample film, blocking until it is encoded (the editor uses the SSE form of the
   *  same route; a script waits). Fetch the bytes with `downloadVideoPresetClip`. */
  previewVideoPresetClip(body: VideoPresetClipBody, signal?: AbortSignal): Promise<VideoPresetClip> {
    return this.request<VideoPresetClip>('POST', '/v1/video-presets/preview/clip', body, { signal });
  }

  /** The clip's MP4 bytes. */
  downloadVideoPresetClip(id: string, signal?: AbortSignal): Promise<ArtifactBytes> {
    return this.requestBytes('GET', `/v1/video-presets/preview/clip/${enc(id)}`, { signal });
  }

  /**
   * The values a preset's `constraints` may take. Ask rather than hardcode: the
   * region list comes from the daemon's embedded persona model, so a pinned copy
   * drifts the moment that model changes and every create 400s.
   */
  getPersonaConstraints(signal?: AbortSignal): Promise<PersonaConstraintOptions> {
    return this.request<PersonaConstraintOptions>(
      'GET',
      '/v1/persona/constraints',
      undefined,
      { signal },
    );
  }

  // ── Proxies (credentials write-only) ────────────────────────────────────────

  /** The list carries `used_by` per row; `getProxy` below does not. */
  listProxies(signal?: AbortSignal): Promise<ProxyRow[]> {
    return this.request<ProxyRow[]>('GET', '/v1/proxies', undefined, { signal });
  }
  getProxy(id: string, signal?: AbortSignal): Promise<Proxy> {
    return this.request<Proxy>('GET', `/v1/proxies/${enc(id)}`, undefined, { signal });
  }
  createProxy(body: CreateProxyBody): Promise<Proxy> {
    return this.request<Proxy>('POST', '/v1/proxies', body);
  }
  updateProxy(id: string, body: UpdateProxyBody): Promise<Proxy> {
    return this.request<Proxy>('PATCH', `/v1/proxies/${enc(id)}`, body);
  }
  deleteProxy(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/proxies/${enc(id)}`);
  }
  /** Health + geo check (exit-ip/country/healthy + JA4↔JA4T verdict). */
  checkProxy(id: string): Promise<ProxyCheckResult> {
    return this.request<ProxyCheckResult>('POST', `/v1/proxies/${enc(id)}/check`, {});
  }
  /**
   * Probe a proxy config WITHOUT persisting it: validate before you commit.
   * Pass `id` (and omit the credentials) to probe an existing proxy's stored,
   * write-only credentials in an edit form.
   */
  checkProxyConfig(body: CheckProxyConfigBody): Promise<ProxyCheckResult> {
    return this.request<ProxyCheckResult>('POST', '/v1/proxies/check', body);
  }

  // ── Live detector audit ─────────────────────────────────────────────────────
  //
  // Drives the profile's OWN running browser through ~15 third-party fingerprint
  // sites and keeps what each one saw. The profile must be RUNNING; the run takes
  // minutes, so `startAudit` returns immediately and you poll `getAudit`.

  /** Queue a run → the status right after queueing. `409` if not running / already running. */
  startAudit(profileId: string): Promise<AuditStatus> {
    return this.request<AuditStatus>('POST', `/v1/profiles/${enc(profileId)}/audit`);
  }

  /** State plus the last stored report. */
  getAudit(profileId: string, signal?: AbortSignal): Promise<AuditStatus> {
    return this.request<AuditStatus>('GET', `/v1/profiles/${enc(profileId)}/audit`, undefined, {
      signal,
    });
  }

  // ── Exit-address exclusivity ────────────────────────────────────────────────

  /** Which exit addresses this profile owns, and how far the rule reaches.
   *
   * `scope` is `'machine'` while this computer has no account key. That is the
   * ordinary state of a second machine until sync is unlocked there once, and it is
   * reported rather than hidden: believing the rule spans three machines when it
   * spans one is worse than knowing. */
  getExitStatus(profileId: string, signal?: AbortSignal): Promise<ExitStatus> {
    return this.request<ExitStatus>('GET', `/v1/profiles/${enc(profileId)}/exit`, undefined, {
      signal,
    });
  }

  // ── Session bundles ─────────────────────────────────────────────────────────

  exportSession(profileId: string, body: SessionExportBody): Promise<SessionExportResult> {
    return this.request<SessionExportResult>('POST', `/v1/profiles/${enc(profileId)}/session/export`, body);
  }
  importSession(profileId: string, body: SessionImportBody): Promise<unknown> {
    return this.request('POST', `/v1/profiles/${enc(profileId)}/session/import`, body);
  }

  // ── Trusted input ──────────────────────────────────────────────────────────

  sendInput(profileId: string, body: TrustedInputBody): Promise<unknown> {
    return this.request('POST', `/v1/profiles/${enc(profileId)}/input`, body);
  }

  // ── Metrics (with graceful fallback) ────────────────────────────────────────

  async getMetrics(signal?: AbortSignal): Promise<Metrics> {
    try {
      return await this.request<Metrics>('GET', '/v1/metrics', undefined, { signal });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.code === 4001)) {
        return deriveMetricsFromProfiles(await this.listProfiles({ limit: 10_000 }, signal));
      }
      throw err;
    }
  }

  // ── Remote access (the machine's own switch) ────────────────────────────────

  /**
   * Is remote access on for this machine?
   *
   * The switch is deliberately local: a chat service reaches this browser only
   * once somebody at the machine has turned it on. On a headless install there
   * is no UI to click, which is why it is here as well.
   */
  async getRemoteAccess(signal?: AbortSignal): Promise<RemoteStatus> {
    return this.request<RemoteStatus>('GET', '/v1/remote', undefined, { signal });
  }

  /** Turn remote access on or off for this machine. */
  async setRemoteAccess(enabled: boolean, signal?: AbortSignal): Promise<RemoteStatus> {
    return this.request<RemoteStatus>('PUT', '/v1/remote', { enabled }, { signal });
  }

  // ── Exit-address exclusivity (the machine's own switch) ─────────────────────

  /**
   * Does one exit address belong to one profile on this machine?
   *
   * Local like the remote-access switch above, and here for the same reason: on
   * a headless install there is no UI to click, and setting up fifty machines by
   * hand is not setting them up.
   */
  async getExitRule(signal?: AbortSignal): Promise<ExitRuleStatus> {
    return this.request<ExitRuleStatus>('GET', '/v1/exit-rule', undefined, { signal });
  }

  /**
   * Turn the exit-address rule on or off for this machine.
   *
   * Off means two of your profiles can leave over the same address. Reach for it
   * when the provider hands out ONE address on purpose; a per-profile switch
   * exists for the narrower case (`updateProfile` with `exit_exclusive`).
   */
  async setExitRule(enabled: boolean, signal?: AbortSignal): Promise<ExitRuleStatus> {
    return this.request<ExitRuleStatus>('PUT', '/v1/exit-rule', { enabled }, { signal });
  }

  // ── Events (SSE) ───────────────────────────────────────────────────────────

  /** Subscribe to lifecycle events. Returns an unsubscribe function. */
  subscribeEvents(handlers: StreamHandlers): () => void {
    return subscribeEvents({ baseUrl: this.baseUrl, token: this.token, fetch: this.fetchImpl }, handlers);
  }

  /** `for await (const event of client.events())` over lifecycle events. */
  events(): AsyncIterableIterator<LifecycleEvent> {
    return eventStream({ baseUrl: this.baseUrl, token: this.token, fetch: this.fetchImpl });
  }

  // ── Direct-CDP driver plane ─────────────────────────────────────────────────

  /**
   * Open a direct-CDP session against a started profile's `cdp_ws`. Pass the
   * `profileId` so `humanize*` helpers can route trusted input through the daemon.
   */
  connectCdp(target: StartProfileResult | string, profileId?: string): Promise<CdpSession> {
    const url = typeof target === 'string' ? target : target.cdp_ws;
    return openCdpSession(url, { token: this.token, client: this, profileId });
  }

  /**
   * Start a profile, connect direct-CDP, and return a {@link LaunchHandle} whose
   * `stop()` (or `await using`) closes CDP and stops the profile.
   */
  async launch(profileId: string, body: StartProfileBody = {}): Promise<LaunchHandle> {
    const result = await this.startProfile(profileId, { headless: body.headless ?? true });
    const cdp = await this.connectCdp(result, profileId);
    const stop = async (): Promise<void> => {
      cdp.close();
      await this.stopProfile(profileId);
    };
    return { cdp, result, stop, [Symbol.asyncDispose]: stop };
  }
}

/** Fallback: compute what we can purely from profile runtime states. */
export function deriveMetricsFromProfiles(profiles: Profile[]): Metrics {
  const running = profiles.filter((p) => p.runtime_state === 'running').length;
  return {
    running,
    capacity_max_concurrent: DEFAULT_CAPACITY.max_concurrent,
    ram_used_mb: null,
    ram_budget_mb: DEFAULT_CAPACITY.ram_budget_mb,
    vram_used_mb: null,
    vram_budget_mb: DEFAULT_CAPACITY.vram_budget_mb,
    cpu_pct: null,
    gpu_pct: null,
    // Mark the fallback derived so consumers can tell it from a live sample
    // whose probes happen to be unavailable.
    source: 'derived',
    sampled_at: null,
    availability: {
      ram: 'unavailable',
      cpu: 'unavailable',
      gpu: 'unavailable',
      vram: 'unavailable',
      per_profile: 'unavailable',
    },
    profiles: [],
  };
}

// ── The mixin merge ─────────────────────────────────────────────────────────
// The resource classes each extend ClientCore; this pair of declarations
// puts their methods ON ScalebrowserClient; the interface carries the types,
// applyMixins carries the runtime. A method lost in a future split shows up in
// test/client-surface.test.ts as a type error, not as a silent d.ts gap.
export interface ScalebrowserClient
  extends IdentityApi,
    RunsApi,
    VideosApi,
    ControlApi,
    ExtensionsApi,
    TasksApi {}
applyMixins(ScalebrowserClient, [
  IdentityApi,
  RunsApi,
  VideosApi,
  ControlApi,
  ExtensionsApi,
  TasksApi,
]);

export type { ScalebrowserClientOptions } from './client-core';
