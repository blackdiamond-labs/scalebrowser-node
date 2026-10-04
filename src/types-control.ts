/**
 * What the browser asks (interruptions), the bytes that go in and out
 * (artifacts), and what the licence says (account).
 *
 * One of the files that are the daemon's wire contract.
 */

// ── Interruptions (`/v1/interruptions/*`) ─────────────────────────────────────

/** What an operator has taken out of an agent's hands. */
export type InterruptionLock = 'always_block' | 'always_allow' | 'agent_decides';

/**
 * One answer, in the browser's OWN vocabulary, hence `allowOnce` in camelCase
 * while everything else in this API is snake_case. The daemon's enum is
 * `#[serde(rename_all = "camelCase")]`; sending `allow_once` is a 400.
 */
export type InterruptionChoice = 'allow' | 'allowOnce' | 'block' | 'dismiss';

export interface InterruptionLockRow {
  kind: string;
  /** Null for the account-wide row. */
  profile_id: string | null;
  decision: InterruptionLock;
}

/** What applies right now for one kind, account-wide. */
export interface EffectiveInterruptionLock {
  kind: string;
  /** Null means the agent decides. */
  decision: InterruptionLock | null;
}

/**
 * Everything about locks in one call, `effective` included.
 *
 * The daemon computes `effective` with the same function the launch path uses.
 * Recomputing it yourself would be a second opinion, and code that disagrees
 * with the browser is worse than code that shows nothing.
 */
export interface InterruptionLockView {
  kinds: string[];
  locked_by_default: string[];
  rows: InterruptionLockRow[];
  effective: EffectiveInterruptionLock[];
}

export interface SetInterruptionLockBody {
  kind: string;
  profile_id?: string | null;
  decision: InterruptionLock;
}

export interface InterruptionRuleRow {
  origin: string;
  kind: string;
  choice: InterruptionChoice;
  /** Who wrote it: an agent must not be able to widen what the operator allowed. */
  author: 'operator' | 'agent';
  profile_id: string | null;
}

export interface SetInterruptionRuleBody {
  origin: string;
  kind: string;
  choice: InterruptionChoice;
  profile_id?: string | null;
}

export interface DeleteInterruptionRuleParams {
  origin: string;
  kind: string;
  profile_id?: string | null;
}

// ── Artifacts (`/v1/artifacts`, `/v1/profiles/:id/artifacts`) ─────────────────

/** The reply to a file handed in for a later upload. */
export interface ArtifactPutResult {
  artifact_id: string;
  size_bytes: number;
  name: string | null;
}

/** Bytes plus what the daemon said they are. */
export interface ArtifactBytes {
  bytes: Uint8Array;
  content_type: string | null;
  /** Parsed out of `Content-Disposition`, when the daemon sent one. */
  filename: string | null;
}

// ── Connection (`/v1/connection`) ─────────────────────────────────────────────

/**
 * Which installation this daemon is: the data directory it serves and the binary
 * it runs from.
 *
 * One machine can hold several installations, and they are told apart by their
 * data directory, never by their address. A port is a preference: the desktop app
 * takes the first free one from 8787, and a `runtime.json` left behind by an
 * earlier daemon can name a port that something else now holds. Ask this before
 * assuming the daemon you reached is the one you meant.
 */
export interface Connection {
  /** The address the native API is bound to, as resolved. */
  native_addr: string;
  /** The data directory, in a form suitable for showing or for a command line. */
  data_dir: string;
  /**
   * The same directory, in the form two daemons compare. Case is folded on
   * Windows and links are resolved, so do not show this one to anybody; compare
   * it with another daemon's value and nothing else.
   */
  data_dir_key: string;
  /** Absolute path of the running binary, for a client that launches it over stdio. */
  executable?: string;
  /** The AdsPower-compatible adapter's address, when that adapter is enabled. */
  adspower_addr?: string;
}

// ── Account (`/v1/account`) ───────────────────────────────────────────────────

/**
 * Licence state, for display.
 *
 * The daemon decides on every launch whether a start is allowed; this never
 * gets a say in it. Never gate your own code on it: a green light on a profile
 * the launch gate refuses is worse than no light.
 */
export interface Account {
  /** Whether an entitlement snapshot has arrived. Also `false` in the seconds
   *  between signing in and the first refresh, so it never answers "is this
   *  machine connected to an account"; `signed_in` does. */
  licensed: boolean;
  /** Whether an account is connected to this machine. One without an account
   *  starts no browser. */
  signed_in: boolean;
  plan?: string;
  status?: string;
  /**
   * Browsers the subscription may run AT ONCE. Replaced the profile allowance
   * on 2026-08-18: profiles are unlimited on every plan now.
   */
  concurrency?: number;
  /** Browsers running on THIS machine, not the abo-wide count. */
  running_local: number;
  /** Profiles stored on THIS machine. */
  profiles_local: number;
  features?: string[];
  /** Unix seconds; when the cached entitlement stops being valid. */
  expires_at?: number;
  permits_launch: boolean;
  /** The control plane refused this machine because the account has no active
   *  plan. Choosing one on the pricing page is the only remedy; the daemon
   *  enrols the machine by itself on its next check after that. Absent when
   *  false. */
  plan_required?: boolean;
  /** With `plan_required`: the control plane said this account still has its
   *  free trial. Absent when false. */
  trial_available?: boolean;
}

// ── Health (`/health`) ────────────────────────────────────────────────────────

export interface HealthStatus {
  status: string;
  service?: string;
}

export interface ReadyStatus {
  status: string;
  /** Where the daemon looks for engines. Whether one is INSTALLED is a
   *  launch-time question the preflight answers properly. */
  engines_dir: string;
}

/** What `GET /v1/remote` answers: the machine's own remote-access switch. */
export interface RemoteStatus {
  /** Is remote access on? */
  enabled: boolean;
  /** Did a person decide this, or is the configured default still standing? */
  explicit: boolean;
  /** The relay the tunnel goes to. */
  relay_url: string;
  /** Without a control-plane session there is no ticket and so no tunnel,
   *  whatever the switch says. */
  ready: boolean;
}

/**
 * What `GET /v1/exit-rule` answers: the machine's own exit-address exclusivity
 * switch.
 *
 * On by default. Turn it off for a provider that hands out ONE address on
 * purpose, a residential line you pay for or a whitelisted office address, where
 * the rule would refuse every start after the first.
 */
export interface ExitRuleStatus {
  /** Does the rule apply on this machine? */
  enabled: boolean;
  /** Did a person decide this, or is the configured default still standing? */
  explicit: boolean;
  /**
   * How many profiles switched the rule off for themselves.
   *
   * A global "on" reads as "every profile is separated", and that stops being
   * true the moment one profile has its own switch off.
   */
  profiles_opted_out: number;
}
