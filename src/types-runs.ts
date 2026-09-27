/**
 * Agent runs and live activity (`/v1/runs`, `/v1/activity`).
 *
 * All of it is display: nothing here starts, stops or changes anything.
 *
 * `RunActor`, `RunOutcome`, `StepKind`, `StepTarget`, `RunStep` and
 * `ProfileActivity` are NOT redeclared here; they live in `types.ts` because
 * the live event stream carries them, and the run list describes the same rows.
 * A second copy would let the two drift apart while both looked right.
 *
 * One of the files that are the daemon's wire contract.
 */
import type { ProfileActivity, RunActor, RunOutcome } from './types';

/** Who made the outcome claim. `derived` means nobody did. */
export type OutcomeSource = 'agent' | 'check' | 'human' | 'derived';

/** Whether the goal text was stated or merely describes the session. */
export type GoalSource = 'agent' | 'derived';

export interface AgentRun {
  id: string;
  /** Groups runs that shared one profile lease. */
  session_id: string;
  profile_id: string;
  profile_name: string;
  actor: RunActor;
  /** Never empty; described when it was not declared (see `goal_source`). */
  goal: string;
  goal_source: GoalSource;
  /**
   * `reached` and `partial` are CLAIMS: the daemon can tell that a run ended,
   * never that it worked, so those two only ever come from an agent, a check or
   * a person.
   */
  outcome: RunOutcome;
  outcome_source: OutcomeSource | null;
  note: string | null;
  started_at: number;
  ended_at: number | null;
  step_count: number;
  /**
   * Steps that never reached the trail because the writer queue was full. Zero
   * on a healthy run, and worth reading: a trail missing entries looks exactly
   * like an agent that did less work.
   */
  steps_lost: number;
  first_domain: string | null;
}

export interface ActivitySnapshot {
  sampled_at: number | null;
  profiles: ProfileActivity[];
}

export interface ListRunsParams {
  profile_id?: string;
  limit?: number;
  offset?: number;
}

export interface ListStepsParams {
  limit?: number;
  offset?: number;
}
