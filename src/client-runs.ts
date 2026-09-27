// Agent runs, steps, stills and the activity feed, split out of `client.ts` on 2026-08-21. A resource mixin:
// `ScalebrowserClient` merges this class (interface-extends + applyMixins in
// `client.ts`), so every method here IS a public client method. Excluded from
// the wire-type mirror (client*.ts) and listed in sdk_coverage.rs.
import { ClientCore, enc } from './client-core';
import type { RunStep } from './types';
import type { ArtifactBytes } from './types-control';
import type { ActivitySnapshot, AgentRun, ListRunsParams, ListStepsParams } from './types-runs';

export class RunsApi extends ClientCore {
  // ── Agent runs ─────────────────────────────────────────────────────────────

  /** Runs, newest first. Read-only, all of it. */
  listRuns(params: ListRunsParams = {}, signal?: AbortSignal): Promise<AgentRun[]> {
    return this.request<AgentRun[]>('GET', '/v1/runs', undefined, {
      query: { profile_id: params.profile_id, limit: params.limit, offset: params.offset },
      signal,
    });
  }

  /** One run. */
  getRun(runId: string, signal?: AbortSignal): Promise<AgentRun> {
    return this.request<AgentRun>('GET', `/v1/runs/${enc(runId)}`, undefined, { signal });
  }

  /** A run's steps, oldest first: the order they happened in. */
  listRunSteps(runId: string, params: ListStepsParams = {}, signal?: AbortSignal): Promise<RunStep[]> {
    return this.request<RunStep[]>('GET', `/v1/runs/${enc(runId)}/steps`, undefined, {
      query: { limit: params.limit, offset: params.offset },
      signal,
    });
  }

  /**
   * The still taken at one step, as JPEG bytes.
   *
   * The picture shows a customer's account, so it is decrypted only on the way
   * out and never cached anywhere shared.
   */
  getRunShot(runId: string, seq: number, signal?: AbortSignal): Promise<ArtifactBytes> {
    return this.requestBytes('GET', `/v1/runs/${enc(runId)}/shots/${seq}`, { signal });
  }

  /** What every running profile currently shows. */
  getActivity(signal?: AbortSignal): Promise<ActivitySnapshot> {
    return this.request<ActivitySnapshot>('GET', '/v1/activity', undefined, { signal });
  }

}
