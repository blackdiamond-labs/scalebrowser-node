// The task list and the profile memory. A resource mixin: `ScalebrowserClient`
// merges this class (interface-extends + applyMixins in `client.ts`), so every
// method here IS a public client method. Excluded from the wire-type mirror
// (client*.ts) and listed in sdk_coverage.rs.
import { ClientCore, enc } from './client-core';
import type { CreateTasksBody, CreateTasksResult, ListTasksParams, ProfileMemory, ProfileTask } from './types-tasks';

export class TasksApi extends ClientCore {
  // -- Tasks ------------------------------------------------------------------
  //
  // Fleet-wide by default, and deliberately so: the question this surface exists
  // for is "what is outstanding across my twenty accounts", and a per-profile
  // route would make a client ask it twenty times and sort the answers itself.
  //
  // None of these starts a browser. A task is a row, so reading the whole fleet's
  // list costs nothing from the plan's concurrent-browser allowance. Reserve only
  // the profiles that turn out to have work.

  /**
   * What is still to be done. No filter means every task of every profile.
   *
   * Pass `state: 'open'` for what is outstanding; without it, tasks finished
   * within the last day are included too.
   */
  listTasks(params?: ListTasksParams, signal?: AbortSignal): Promise<ProfileTask[]> {
    // Spread into a plain record: `ListTasksParams` is a closed interface, and
    // `Query` wants an index signature. Naming the fields here would be a second
    // list to keep in step with the first.
    return this.request<ProfileTask[]>('GET', '/v1/tasks', undefined, {
      query: { ...params },
      signal,
    });
  }

  /**
   * Put the same task on one or many profiles, one row each.
   *
   * A task is a LINE, not a document: name the work and leave the material where
   * it lives. `due_at` is a deadline, not a trigger; nothing runs by itself.
   *
   * Profiles that no longer exist come back in `missing` instead of failing the
   * whole call.
   */
  createTasks(body: CreateTasksBody): Promise<CreateTasksResult> {
    return this.request<CreateTasksResult>('POST', '/v1/tasks', body);
  }

  /**
   * Call a task off.
   *
   * Only a task nobody has claimed can be cancelled here. One an agent is working
   * on right now is stopped by telling that agent, which is a channel that already
   * reaches it; this surface answers `409` for it rather than pretending.
   */
  cancelTask(id: string): Promise<ProfileTask> {
    return this.request<ProfileTask>('PATCH', `/v1/tasks/${enc(id)}`, { state: 'cancelled' });
  }

  /** Remove a task outright. */
  deleteTask(id: string): Promise<void> {
    return this.request('DELETE', `/v1/tasks/${enc(id)}`);
  }

  // -- Profile memory ---------------------------------------------------------

  /**
   * A profile's durable memory, the `PROFILE.md` at the top of its directory.
   *
   * `content` is `null` while nobody has written one: a profile starts with no
   * file, not with an empty one.
   */
  getProfileMemory(profileId: string, signal?: AbortSignal): Promise<ProfileMemory> {
    return this.request<ProfileMemory>('GET', `/v1/profiles/${enc(profileId)}/memory`, undefined, {
      signal,
    });
  }

  /**
   * Replace a profile's memory.
   *
   * Stored verbatim: no trimming, no appended newline, no line-ending
   * translation. The last write wins and nothing warns, exactly as with a file
   * two people can open.
   */
  putProfileMemory(profileId: string, content: string): Promise<ProfileMemory> {
    return this.request<ProfileMemory>('PUT', `/v1/profiles/${enc(profileId)}/memory`, { content });
  }

  /** Remove a profile's memory. Removing one that is not there is not an error. */
  deleteProfileMemory(profileId: string): Promise<void> {
    return this.request('DELETE', `/v1/profiles/${enc(profileId)}/memory`);
  }
}
