/**
 * The per-profile task list and the profile's own durable memory.
 *
 * One of the files that are the daemon's wire contract.
 */

// -- Tasks (`/v1/tasks`) ------------------------------------------------------

/**
 * Where a task stands.
 *
 * Four words and no more. There is deliberately no `blocked` and no `partial`:
 * `in_progress` already carries "somebody tried and did not finish", and why it
 * failed belongs in the run trail, which is built to hold exactly that.
 *
 * `cancelled` is `done` with a different word. Both are endings, both fall out
 * of the list a day later; the separate word is so a reader can tell "we did it"
 * from "we called it off".
 */
export type TaskState = 'open' | 'in_progress' | 'done' | 'cancelled';

/** One task on one profile. */
export interface ProfileTask {
  id: string;
  profile_id: string;
  /** Carried along so a fleet-wide list can say whose task a row is. */
  profile_name: string;
  /**
   * The IANA zone `due_at` should be READ in: the profile's own.
   *
   * Without it a viewer reads their own clock and acts on the wrong number, and
   * an account posting at three in the morning local time is exactly the
   * behavioural tell this product avoids everywhere else. Derived at query time,
   * never stored on the task: `geo_mode = follow_exit` rewrites the persona's
   * zone at every launch.
   */
  profile_timezone: string | null;
  /** One line saying what to do. A task names its material, it does not hold it. */
  title: string;
  state: TaskState;
  /**
   * Deadline in unix seconds (UTC), or `null` for work that is owed but not owed
   * at any particular moment.
   *
   * Read it in the PROFILE's timezone, not the viewer's: a task due at nine means
   * nine where the identity lives, and an account that posts at three in the
   * morning local time is a behavioural tell.
   *
   * It is a deadline, not a trigger. Nothing runs by itself.
   */
  due_at: number | null;
  created_at: number;
  /** When the current claim was taken; cleared when the task leaves `in_progress`. */
  claimed_at: number | null;
  finished_at: number | null;
  /**
   * Set when a claim nobody finished was handed back after six hours.
   *
   * Whoever picks such a task up has to check whether the work already happened:
   * the previous run may have published the post and died before it could say so.
   */
  last_attempt_at: number | null;
}

/** Filters for listing tasks. All are narrowings; absent means unconstrained. */
export interface ListTasksParams {
  profile_id?: string;
  state?: TaskState;
  /** Only tasks whose deadline is at or before this unix second. */
  due_before?: number;
  /** Substring of the title, case-insensitive. */
  q?: string;
  limit?: number;
  offset?: number;
}

/** Add the same task to one or many profiles, one row each. */
export interface CreateTasksBody {
  profile_ids: string[];
  title: string;
  due_at?: number | null;
}

/** What one create call did. */
export interface CreateTasksResult {
  created: ProfileTask[];
  /**
   * Profiles that no longer exist. Named rather than dropped: adding a task to
   * twenty profiles of which three were deleted writes seventeen rows and says
   * which three it could not.
   */
  missing: string[];
}

/** The one transition this surface performs. */
export interface PatchTaskBody {
  /** Only `cancelled`, and only on a task nobody has claimed. */
  state: 'cancelled';
}

// -- Profile memory (`/v1/profiles/:id/memory`) -------------------------------

/**
 * A profile's durable memory: the `PROFILE.md` at the top of its directory.
 *
 * Same purpose as a repository's `CLAUDE.md`. What goes in it is the customer's
 * business; nothing writes a scaffold or seeds a value, and a profile starts with
 * no file rather than an empty one.
 */
export interface ProfileMemory {
  /** `null` while nobody has written one. */
  content: string | null;
  /** The absolute path, so a person can open it in their own editor. */
  path: string;
  updated_at: number | null;
  /** The ceiling a write is measured against, in bytes. */
  max_bytes: number;
}

/** Replace a profile's memory. The text is stored verbatim. */
export interface WriteMemoryBody {
  content: string;
}
