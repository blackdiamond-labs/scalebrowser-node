// Lifecycle events (SSE/WS tagged union), split out of `types.ts` on 2026-08-21 (the file was a 780-line
// churn hotspot). This file is part of the one source of the daemon's wire contract.
// ── Lifecycle events (SSE `/v1/events`, WS `/v1/ws`): tagged union on `type` ─

import type {
  ExitScope,
  ProfileActivity,
  RunActor,
  RunOutcome,
  RunStep,
  RuntimeState,
} from "./types"
import type { Recording, Video } from "./types-videos"
import type { ProfileTask } from "./types-tasks"

/**
 * A daemon lifecycle event. Named `LifecycleEvent` (not `Event`) to avoid
 * clashing with the global `Event`; also re-exported as `Event` for parity with
 * the web-ui contract.
 *
 * Each event carries the whole state of the thing it is about, so a reader never
 * has to fetch to act on one. The exception is an image: `RunStep.shot_path` is
 * a reference, and the picture is already on disk when the event arrives.
 */
export type LifecycleEvent =
  | { type: 'profile_state_changed'; profile_id: string; from: RuntimeState; to: RuntimeState; at: number }
  | { type: 'profile_started'; profile_id: string; cdp_ws: string; headless: boolean; at: number }
  | { type: 'profile_stopped'; profile_id: string; at: number }
  | { type: 'profile_crashed'; profile_id: string; reason: string; at: number }
  | { type: 'preflight_failed'; profile_id: string; detail: string; at: number }
  | { type: 'proxy_checked'; proxy_id: string; healthy: boolean; country: string | null; at: number }
  | { type: 'capacity_rejected'; profile_id: string; at: number }
  /** An agent declared a task on a profile, or one was opened for undeclared work. */
  | { type: 'run_started'; run_id: string; profile_id: string; actor: RunActor; goal: string; at: number }
  /** One tool call was appended to a run's trail: the whole stored step. */
  | { type: 'run_step'; run_id: string; profile_id: string; step: RunStep; at: number }
  | { type: 'run_finished'; run_id: string; profile_id: string; outcome: RunOutcome; at: number }
  /** A running profile's row appeared, or something about it is different. */
  | { type: 'profile_activity_changed'; activity: ProfileActivity; at: number }
  /** A profile is no longer running: its row goes away. */
  | { type: 'profile_activity_gone'; profile_id: string; at: number }
  /** A recording appeared or changed: the whole row, upsert it. */
  | { type: 'recording_changed'; recording: Recording; at: number }
  /**
   * A video appeared or changed. Carries state AND progress: while it renders
   * this fires every 2 % or 2 s, and the row is the whole truth.
   */
  | { type: 'video_changed'; video: Video; at: number }
  /** A video is gone: deleted, remove its row. */
  | { type: 'video_gone'; video_id: string; at: number }
  /**
   * A task appeared or changed. One variant for both, because the row is
   * complete: a reader writes it whether or not it knew the task before, and a
   * separate "created" event would only buy a distinction that goes wrong the
   * first time one is missed.
   */
  | { type: 'task_changed'; task: ProfileTask; at: number }
  /** A task is gone: cancelled and swept, finished and swept, or deleted. */
  | { type: 'task_gone'; task_id: string; profile_id: string; at: number }
  /**
   * Frames were lost; re-read rather than carry on. Raised when the daemon
   * notices this connection fell behind. `dropped` counts what it skipped.
   */
  /**
   * The exit-address guard's verdict for one running profile.
   *
   * The whole state, like every other live row here: a display rebuilt from
   * parts is what makes it confidently wrong, and the one frame that matters
   * most is the wire being cut.
   */
  | {
      type: 'exit_guard_changed';
      profile_id: string;
      state: 'ok' | 'degraded' | 'unverified' | 'severed';
      addr: string;
      class: string;
      scope: ExitScope;
      owned: number;
      detail: string | null;
      at: number;
    }
  /** A profile stopped: its guard row goes away. */
  | { type: 'exit_guard_gone'; profile_id: string; at: number }
  | { type: 'resync'; dropped: number; at: number };


/**
 * An event as it arrives, with its position in this connection's stream.
 *
 * The daemon numbers every frame, starting at 1. A jump means frames were lost, and
 * the only way to tell "nothing happened" from "something happened and I did not
 * get it". Optional so a daemon predating the numbering still type-checks.
 */
export type StreamedEvent = LifecycleEvent & { seq?: number };

/** Kept for consumers that imported the old name; the web-ui uses `LifecycleEvent`. */
export type { LifecycleEvent as Event };

