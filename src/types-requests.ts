// Request payloads, split out of `types.ts` on 2026-08-21 (the file was a 780-line
// churn hotspot). This file is part of the one source of the daemon's wire contract.
// ── Request payloads ─────────────────────────────────────────────────────────

import type { GeoMode, ProxyKind, Rotation, RuntimeState } from "./types"

/** Column the DAEMON orders by. Sorting a fetched page would order a minority of
 *  a paged fleet while looking authoritative, so ordering is a server parameter. */
export type ProfileSort = 'created_at' | 'name' | 'runtime_state' | 'last_open_at';
export type SortOrder = 'asc' | 'desc';

/** `GET /v1/profiles/ids`: every id matching the same filters, unpaged. */
export interface ProfileIdsResult {
  count: number;
  ids: string[];
}

/**
 * `GET /v1/profiles/count`: how many profiles match, split by runtime state.
 *
 * `total` counts ROWS, so it is the sum of the four states for every state this
 * daemon can read; a row in a state a newer build introduced counts in `total`
 * alone rather than being folded into `stopped`.
 *
 * The `state` filter is the one this route ignores. A caller labelling all four
 * scopes is sitting in one of them, so narrowing by it would answer the other
 * three with zero. Every other filter binds exactly as it does for the listing.
 */
export interface ProfileCounts {
  total: number;
  stopped: number;
  starting: number;
  running: number;
  crashed: number;
}

/** `POST /v1/bulk/start`: per-id results plus what the batch as a whole did. */
export interface BulkStartResult {
  results: { id: string; ok: boolean; cdp_ws?: string; error?: string }[];
  started: number;
  remaining: string[];
  stopped_reason?: string;
}

export interface ListProfilesParams {
  group?: string;
  state?: RuntimeState;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: ProfileSort;
  order?: SortOrder;
}

export interface CreateProfileBody {
  name: string;
  seed?: string;
  geo_mode?: GeoMode;
  expected_country?: string | null;
  /**
   * Draw the identity for this region (ISO-3166 alpha-2, e.g. `"DE"`): language,
   * timezone and speech voices come out of one row of the model together. Omit to
   * draw unconstrained, weighted the way the population is.
   *
   * This is not `expected_country`, which only checks the exit and never touches
   * the identity. And it is a starting value, not a promise: under the default
   * `geo_mode` the launch rewrites the region to the country the profile really
   * exits in, which is its proxy's, or with no proxy the machine's own. The
   * daemon refuses the pairings where that collision is already known.
   *
   * Set only at create. A region the model cannot draw is a 400 listing the ones
   * it can.
   */
  persona_country?: string;
  group_id?: string | null;
  proxy_id?: string | null;
}

/**
 * PATCH, all mutable fields optional. `seed` and `persona_country` are fixed at
 * create time (C5): they draw the identity, and redrawing it under a profile that
 * has already been used would be a new identity in an old profile's clothes.
 */
export type UpdateProfileBody = Omit<
  Partial<CreateProfileBody>,
  "seed" | "persona_country"
> & {
  /**
   * Turn the exit-address rule off for this profile. Deliberately not
   * part of `CreateProfileBody`: a new profile always claims its address, and
   * switching that off is a later, deliberate act for a setup that needs it.
   */
  exit_exclusive?: boolean;
};

export interface StartProfileBody {
  headless?: boolean;
}

export interface StartProfileResult {
  profile_id: string;
  cdp_ws: string;
  /** DevTools TCP port, parsed from `cdp_ws` (`null` if the URL has none). */
  debug_port: number | null;
  /** Effective headless state of this launch. */
  headless: boolean;
  pid: number | null;
  started_at: number;
}

/** What a takeover request answered.
 *
 *  `free` means the profile is yours to start now; `pending` means the machine that
 *  held it has been told and is closing its browser, so ask again in a moment.
 *  Never start on `pending`: two machines on one identity is what a site reads as
 *  a cloned account. */
export interface TakeoverResult {
  state: 'free' | 'pending';
  /** The holder as a person reads it: its label, else a short machine id. */
  holder?: string | null;
}

export interface StopProfileResult {
  stopped: boolean;
}

/** `POST /v1/profiles/:id/release`: `released: false` is an honest no-op,
 *  there was nothing to let go. */
export interface ReleaseProfileResult {
  released: boolean;
  stopped: boolean;
}

export interface BulkCreateBody {
  preset_id: string;
  count: number;
  /** Base name for the batch; the daemon appends an index per profile. */
  name_prefix?: string;
  /** Drop the whole batch into this group at create time. */
  group_id?: string;
}


/** The body `/v1/bulk/start`, `/v1/bulk/stop` and `/v1/bulk/delete` share.
 *
 * It belongs here for the same reason its sibling above does: it describes what
 * the daemon reads off the wire.
 */
export interface BulkIdsBody {
  ids: string[];
}

export interface BulkAssignProxyBody {
  ids: string[];
  proxy_id: string;
}

export interface CreateProxyBody {
  kind: ProxyKind;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  rotation?: Rotation;
  /**
   * The operator's own name for the row. Trimmed by the daemon; a blank string is
   * stored as null. On an update the field carries three states: omit the key to
   * leave the name alone, send `null` to clear it, send a string to set it.
   */
  label?: string | null;
}

export type UpdateProxyBody = Partial<CreateProxyBody>;

/**
 * Result of `POST /v1/proxies/:id/check` (health + geo).
 *
 * CONTRACT ASSUMPTION: the daemon returns the freshly-checked exit identity plus
 * the JA4↔JA4T coherence verdict. Fields beyond the persisted `Proxy`
 * columns (`ja4`, `ja4t`, `ja4t_mismatch`, `warnings`) are optional; if the
 * daemon only echoes the updated `Proxy`, the JA4 verdict is simply absent.
 */
export interface ProxyCheckResult {
  healthy: boolean;
  exit_ip: string | null;
  country: string | null;
  /**
   * The operator string the geo probe answered with, e.g.
   * `"AS21928 T-Mobile USA, Inc."`; `null` when it reported none. Same value the
   * check persists as `Proxy.last_asn`.
   */
  asn?: string | null;
  /**
   * The IANA timezone of the exit, e.g. `"America/Chicago"`; `null` when the
   * probe reported none. Same value the check persists as `Proxy.last_timezone`,
   * and the one a `follow_exit` profile adopts at its next start.
   */
  timezone?: string | null;
  /**
   * What kind of network the exit sits on, derived from `asn` against the
   * daemon's own dataset. `"unknown"` means unproven, never safe: it is what you
   * get with no dataset installed and with an ASN the dataset does not know.
   * A datacenter exit is the single biggest real-world tell.
   */
  exit_class?: "datacenter" | "residential" | "mobile" | "unknown";
  /**
   * Whether the exit is a mobile/carrier network, the best case for anti-detect.
   *
   * SINCE 2026-09-18 this is derived from `exit_class` and answers three states:
   * `true`, `false`, and `null` for "could not be classified". Before that it
   * mirrored a flag of the geo lookup that the configured endpoint never sets, so
   * it was structurally `false` on every answer, including genuinely mobile
   * exits. Treat a `null` as unknown, not as "no".
   */
  is_mobile?: boolean | null;
  ja4?: string | null;
  ja4t?: string | null;
  ja4t_mismatch?: boolean;
  warnings?: string[];
  checked_at?: number;
  /** Round-trip RTT, `null` on an unreachable exit (a timeout is not a latency). */
  latency_ms?: number | null;
}

/**
 * Body of `POST /v1/proxies/check`: probe a proxy config that is NOT persisted
 * (health + geo before you commit it).
 *
 * Edit-mode: pass the `id` of an existing proxy and omit `username`/`password`
 * to probe with its stored (write-only) credentials. A proxy whose credentials
 * cannot be decrypted fails closed rather than probing unauthenticated.
 */
export interface CheckProxyConfigBody {
  kind: ProxyKind;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  rotation?: Rotation;
  /** Existing proxy id; enables the stored-credential fallback. */
  id?: string | null;
}

/**
 * One package in the daemon-wide extension library, keyed by id AND version: the
 * library stocks several versions of the same extension and each profile draws one.
 */
export interface Extension {
  /** Canonical Web-Store id, derived from the package's own key. Repeats across versions. */
  id: string;
  name: string;
  version: string;
  /** Base64 DER public key lifted from the CRX header. */
  public_key: string;
  /**
   * Unpacked library directory (the profile launches from its own copy).
   * Derived by the daemon from its data dir rather than stored, so a moved data
   * dir does not leave every row pointing at nothing.
   */
  dir: string;
  /** SHA-256 of the unpacked tree; it names the CONTENT of this version. */
  content_hash: string;
  added_at: number;
}

/**
 * How a profile's extension set reaches the browser. Returned with every
 * extensions response; `engine_switches` is what the launch actually emits.
 *
 * `id_model` is `"canonical"`: the id comes from the package's key and is the same
 * for every profile, deliberately, since it is the id millions of real users
 * report. Only the FILES are per-profile (`delivery: "per_profile_copy"`).
 */
export interface ExtensionPolicy {
  id_model: string;
  delivery: string;
  /** Exact, ordered engine switches emitted for this profile's set; empty when none. */
  engine_switches: string[];
}

/** Response of every `/v1/profiles/:id/extensions` call: the set + the policy. */
export interface ExtensionsResult {
  profile_id: string;
  /** Assigned library ids, as an idempotent set. */
  extensions: string[];
  /**
   * The set this profile actually loads: ONE version per extension, drawn from the
   * profile's seed over what the library stocks. Shorter than `extensions` when an id
   * no longer resolves.
   */
  packages: Extension[];
  policy: ExtensionPolicy;
  /**
   * What is worth knowing about THIS set, judged by the daemon with the same
   * function the launch gate uses. Empty for an unremarkable set, including an
   * empty one, since about half of real Chrome users carry no extension.
   *
   * Never recompute it client-side: a second opinion could contradict the gate.
   */
  advice: ExtensionAdvice[];
}

/** One finding about a profile's extension set. */
export interface ExtensionAdvice {
  /** `warn`: a launch is never blocked by an extension. */
  level: string;
  message: string;
}

