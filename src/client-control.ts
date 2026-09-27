// Interruptions, artifacts, account and health, split out of `client.ts` on 2026-08-21. A resource mixin:
// `ScalebrowserClient` merges this class (interface-extends + applyMixins in
// `client.ts`), so every method here IS a public client method. Excluded from
// the wire-type mirror (client*.ts) and listed in sdk_coverage.rs.
import { ClientCore, enc } from './client-core';
/** What to assume of a daemon too old to answer `/v1/account`: nothing is connected
 *  and nothing may start. The optimistic version of this constant is how an unpaired
 *  machine presented itself as fully usable. */
const NO_ACCOUNT: Account = {
  licensed: false,
  signed_in: false,
  running_local: 0,
  profiles_local: 0,
  permits_launch: false,
};

import { ApiError } from './errors';
import type { Account, ArtifactBytes, ArtifactPutResult, Connection, DeleteInterruptionRuleParams, HealthStatus, InterruptionLockView, InterruptionRuleRow, ReadyStatus, SetInterruptionLockBody, SetInterruptionRuleBody } from './types-control';

export class ControlApi extends ClientCore {
  // ── Interruptions ──────────────────────────────────────────────────────────

  /** Which browser surfaces are locked shut, and what actually applies. */
  listInterruptionLocks(signal?: AbortSignal): Promise<InterruptionLockView> {
    return this.request<InterruptionLockView>('GET', '/v1/interruptions/locks', undefined, { signal });
  }

  /** Omit `profile_id` to set the fleet-wide default. */
  setInterruptionLock(body: SetInterruptionLockBody): Promise<unknown> {
    return this.request('PUT', '/v1/interruptions/locks', body);
  }

  /** Standing answers per origin and kind. */
  listInterruptionRules(signal?: AbortSignal): Promise<InterruptionRuleRow[]> {
    return this.request<InterruptionRuleRow[]>('GET', '/v1/interruptions/rules', undefined, { signal });
  }

  setInterruptionRule(body: SetInterruptionRuleBody): Promise<unknown> {
    return this.request('PUT', '/v1/interruptions/rules', body);
  }

  deleteInterruptionRule(params: DeleteInterruptionRuleParams): Promise<unknown> {
    return this.request('DELETE', '/v1/interruptions/rules', undefined, {
      query: { origin: params.origin, kind: params.kind, profile_id: params.profile_id },
    });
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────

  /**
   * Hand the daemon a file so `interact action=upload` has something to attach.
   *
   * The bytes are bound to the PROFILE, not to a lease: set a file up
   * before leasing, and a lease released mid-task does not destroy it.
   */
  putArtifact(
    profileId: string,
    bytes: Uint8Array | ArrayBuffer,
    name?: string,
  ): Promise<ArtifactPutResult> {
    return this.request<ArtifactPutResult>('POST', `/v1/profiles/${enc(profileId)}/artifacts`, bytes, {
      query: { name },
    });
  }

  /**
   * Fetch one artifact's bytes: a screenshot, a download, a saved PDF.
   *
   * A miss is a plain 404 whether the id never existed, expired, or belonged to
   * a released lease: the caller's next move is the same in all three cases.
   */
  getArtifact(artifactId: string, signal?: AbortSignal): Promise<ArtifactBytes> {
    return this.requestBytes('GET', `/v1/artifacts/${enc(artifactId)}`, { signal });
  }

  // ── Account + health ───────────────────────────────────────────────────────

  /**
   * Licence state for display. The launch gate stays the authority on starts.
   *
   * A daemon predating the route answers 404, and that is not an error worth
   * throwing, but it is read pessimistically: nothing can be shown to be
   * connected or permitted. Same shape of tolerance as {@link getMetrics}.
   */
  async getAccount(signal?: AbortSignal): Promise<Account> {
    try {
      return await this.request<Account>('GET', '/v1/account', undefined, { signal });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { ...NO_ACCOUNT };
      throw err;
    }
  }

  /**
   * Which installation answered: its data directory and its binary.
   *
   * `health()` tells you something is there. This tells you WHAT, and the two are
   * different questions whenever a machine holds more than one installation. The
   * data directory is the identity; the address is not, because a port is a
   * preference and a stale `runtime.json` can name one that moved.
   */
  getConnection(signal?: AbortSignal): Promise<Connection> {
    return this.request<Connection>('GET', '/v1/connection', undefined, { signal });
  }

  /** "Is the daemon alive?" Public, needs no token. */
  health(signal?: AbortSignal): Promise<HealthStatus> {
    return this.request<HealthStatus>('GET', '/health', undefined, { signal });
  }

  /** "Can it serve?" Local facts only; the control plane is deliberately not consulted. */
  ready(signal?: AbortSignal): Promise<ReadyStatus> {
    return this.request<ReadyStatus>('GET', '/health/ready', undefined, { signal });
  }

}
