import type { Persona } from "./types-persona"
import type { ExportPresetName } from "./types-videos"

/**
 * Wire types: a 1:1 mirror of the daemon's serialized domain model and of the
 * endpoint contract, and the one source of both on the TypeScript side.
 *
 * These files import nothing but each other, which keeps them usable inside a
 * browser bundle.
 *
 * All Rust enums serialize `snake_case` (serde `rename_all`). Timestamps are
 * unix seconds (`number`, Rust `i64`). The truth for any disagreement is the
 * UNION of the Rust route shapes, never one serde struct (create/delete answer
 * the bare `Profile`, list/get the flattened `ProfileView`).
 */

// ── Enums ────────────────────────────────────────────────────────────────────

/** `RuntimeState`. */
export type RuntimeState = 'stopped' | 'starting' | 'running' | 'crashed';
export const RUNTIME_STATES: readonly RuntimeState[] = ['stopped', 'starting', 'running', 'crashed'];

/** `GeoMode`. Default `follow_exit`. */
export type GeoMode = 'strict_expected' | 'follow_exit' | 'off';
export const GEO_MODES: readonly GeoMode[] = ['strict_expected', 'follow_exit', 'off'];

/** `ProxyKind`. */
export type ProxyKind = 'http' | 'socks5' | 'gateway';
export const PROXY_KINDS: readonly ProxyKind[] = ['http', 'socks5', 'gateway'];

/** `Rotation`. */
export type Rotation = 'sticky' | 'rotating';
export const ROTATIONS: readonly Rotation[] = ['sticky', 'rotating'];

/** `SessionKind`. */
export type SessionKind = 'cookies' | 'local_storage' | 'indexed_db' | 'service_worker';

export type OsFamily = 'windows' | 'macos' | 'linux';

// ── Resources ────────────────────────────────────────────────────────────────

/** How protected a profile is right now, decided by the daemon WITHOUT starting a
 *  browser: it runs the same gates the launch runs. `blocked` means the launch
 *  will refuse this profile; `warn` means it starts but something measurably
 *  weakens it (most often a missing proxy). */
export type ProtectionLevel = 'ok' | 'warn' | 'blocked';

export interface ProtectionStatus {
  level: ProtectionLevel;
  /** Plain-language findings, worst first. Empty exactly when `level` is `ok`. */
  reasons: string[];
}

/** A browser identity profile (`profiles`). */
export interface Profile {
  id: string;
  name: string;
  runtime_state: RuntimeState;
  enabled: boolean;
  crash_reason: string | null;
  pid: number | null;
  run_lock: string | null;
  seed: string;
  engine_version: string;
  persona: Persona;
  gpu_persona: string | null;
  group_id: string | null;
  proxy_id: string | null;
  geo_mode: GeoMode;
  expected_country: string | null;
  /**
   * Whether this profile claims its exit address for itself, so no other profile of
   * the account starts on it. On for a new profile. Turn it off for a
   * provider that hands out ONE address on purpose, a residential line you pay for
   * or a whitelisted office address, where the rule would refuse every start after
   * the first.
   *
   * Additive: a daemon predating it omits the field.
   */
  exit_exclusive?: boolean;
  data_dir: string;
  created_at: number;
  last_open_at: number | null;
  /** Additive (a daemon predating it simply omits the field). Present on list/get
   *  (`ProfileView`), absent on create/delete/bulk, which answer the bare profile. */
  protection?: ProtectionStatus;
  /**
   * Platform slugs this profile has a stored login for, sorted by the daemon.
   * Additive; a daemon predating the credential vault simply omits it.
   */
  platforms?: string[];
  /**
   * The country the persona's clock places it in (`persona.timezone`), `null` for
   * a zone outside the daemon's cohort table. Never read the country out of the
   * language: Chrome sends the list of its UI language, so a profile in Vienna
   * speaks `de-DE` and one in Stockholm `en-US`. Additive; present on list/get
   * (`ProfileView`), absent where `protection` is.
   */
  timezone_country?: string | null;
}

export interface Group {
  id: string;
  name: string;
  created_at: number;
}

/**
 * Operating config: what the created profiles DO. Every key mirrors a
 * `POST /v1/profiles` body field. The daemon refuses an unknown key with a 400
 * rather than dropping it, because a preset makes up to 1000 profiles, so a swallowed
 * key is a thousand wrong ones.
 */
export interface PresetConfig {
  /** Pin the batch to one engine build. Omit for per-profile version diversity. */
  engine_version?: string | null;
  geo_mode?: GeoMode | null;
  /** The geo GATE's expectation, not the persona's drawn region. */
  expected_country?: string | null;
  group_id?: string | null;
  proxy_id?: string | null;
  /**
   * Library ids every profile of the batch is created with. Empty is normal, since
   * about half of real Chrome users carry no extension.
   *
   * An id the library no longer holds refuses the whole batch: a thousand profiles
   * that silently differ from the preset look exactly like correct ones.
   */
  extensions?: string[];
}

/**
 * Generator constraints: what the created profiles ARE. Exactly one axis,
 * because an axis is only honest here if the daemon does not overwrite it at
 * launch; the GPU, screen, DPR and Chrome version all are.
 */
export interface PresetConstraints {
  /**
   * ISO-3166 alpha-2 from `GET /v1/persona/constraints`. Masks the persona's
   * locale draw, pinning language, timezone and speech voices together.
   */
  country?: string | null;
}

export interface Preset {
  id: string;
  name: string;
  constraints: PresetConstraints;
  config: PresetConfig;
  created_at: number;
}

/** What lies behind the page: a gradient, a colour, an image, or nothing. */
export type VideoBackground =
  | { kind: 'gradient'; colors: string[] }
  | { kind: 'solid'; color: string }
  | { kind: 'image'; media_id: string }
  | { kind: 'none' };

/** Intro and outro. `hold_result` holds the last frame instead of a card. */
export type VideoCard =
  | { style: 'title_card'; seconds: number }
  | { style: 'hold_result'; seconds: number };

/** Where the finished video goes. */
export type VideoDestination =
  | { kind: 'local' }
  | { kind: 'link'; expires_days: number | null; download: boolean; passcode: boolean };

/** An additional output with its own dimensions. Objects, never bare strings. */
export interface ExtraOutput {
  preset: ExportPresetName;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  colors?: number | null;
  max_bytes?: number | null;
}

/** Background music, by media id, with its level. */
export interface MusicBed {
  media_id: string;
  gain_db: number;
}

/**
 * The recipe of a video: everything about the FORM, nothing about the content.
 *
 * Steps, length, title and narration come from the request, never from here;
 * the only free text field is `ai_label.text`.
 */
export interface VideoPresetConfig {
  output: {
    aspect: '16:9' | '9:16' | '1:1';
    resolution: '720p' | '1080p' | '4k';
    fps: number;
  };
  frame: {
    background: VideoBackground;
    padding_pct: number;
    corner_radius_px: number;
    shadow: 'none' | 'soft' | 'hard';
    inset_px: number;
    window_chrome: 'none' | 'plain' | 'address_bar';
  };
  cursor: {
    scale: number;
    style: 'arrow_dark' | 'arrow_light' | 'dot' | 'touch';
    click: 'ripple' | 'ring' | 'none';
    /** `null` keeps the pointer visible forever. */
    hide_after_ms: number | null;
    loop: boolean;
  };
  camera: {
    zoom: 'off' | 'gentle' | 'medium' | 'strong';
    motion_blur: boolean;
    tightening: 'none' | 'normal' | 'strong';
    ride: 'calm' | 'standard' | 'brisk';
    zoom_scope: 'canvas' | 'card';
  };
  audio: {
    /** `"<provider>:<voice>"`, or `null` for a silent video. */
    voice: string | null;
    language: string;
    subtitles: 'burned' | 'file' | 'off';
    /** `custom:<media_id>` names an uploaded font (media kind `subtitle_style`). */
    subtitle_style: 'classic' | 'word' | `custom:${string}`;
    page_audio: boolean;
    music: MusicBed | null;
  };
  cards: { intro: VideoCard | null; outro: VideoCard | null };
  masking: {
    level: 'off' | 'secrets' | 'secrets_and_ids';
    style: 'bar' | 'pixelate' | 'blur' | 'placeholder';
  };
  export: {
    preset: ExportPresetName;
    also: ExtraOutput[];
    destination: VideoDestination;
  };
  ai_label: {
    enabled: boolean;
    text: string;
    position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  };
}

/**
 * A video RECIPE: how a recording becomes a video (`/v1/video-presets`).
 *
 * `config` was an open object for a long time, on the argument that a second
 * TypeScript copy of a two-dozen-enum schema is a second place for it to rot.
 * The copy exists now because a form over an open object is a pile of casts and
 * a typo in it only surfaces as a 400 after somebody pressed save; what took
 * the argument's teeth is that the copy is held against the Rust source field
 * by field (`preset-schema-mirror`), so it cannot rot quietly.
 */
export interface VideoPreset {
  id: string;
  name: string;
  /** Shipped with the product; can be duplicated but not edited or deleted. */
  builtin: boolean;
  config: VideoPresetConfig;
  created_at: number;
  updated_at: number;
}

/** One named frame of the sample film the preview can jump to, with the clip window around it. */
export interface PreviewMoment {
  key: string;
  label: string;
  frame: number;
  from: number;
  to: number;
}

/** A preset field the sample film cannot show, and why. */
export interface PreviewHidden {
  field: string;
  why: string;
}

/** `POST /v1/video-presets/preview`: one still of the sample film under an unsaved config. */
export interface VideoPresetPreviewBody {
  config: VideoPresetConfig;
  frame?: number;
  moment?: string;
  name?: string;
  /** Draw at this short side instead of the recipe's own, 360 to 2160. */
  proxy_short_side?: number;
}

/** The reply: the picture as a data URL plus what the film looks like under this config. */
export interface VideoPresetPreview {
  width: number;
  height: number;
  fps: number;
  frames: number;
  frame: number;
  moments: PreviewMoment[];
  hidden: PreviewHidden[];
  notes: string[];
  image: string;
}

/** `POST /v1/video-presets/preview/clip`: frames `from_frame..to_frame` of the sample film as an MP4. */
export interface VideoPresetClipBody {
  config: VideoPresetConfig;
  /** Absent means the start of the film. */
  from_frame?: number;
  /** Exclusive; absent means the end of the film. */
  to_frame?: number;
  name?: string;
  /** Draw at this short side instead of the recipe's own, 360 to 2160. */
  proxy_short_side?: number;
}

/** One progress frame of the clip's SSE stream (`event: progress`). */
export interface VideoPresetClipProgress {
  done: number;
  total: number;
}

/**
 * `event: started`, the FIRST frame of the SSE answer: the id under which the
 * bytes can already be followed (`?follow=1`), and the shape of the film.
 *
 * It exists so a player can begin while the render still runs. Without it the
 * id arrives with `done`, and by then there is nothing left to follow.
 */
export interface VideoPresetClipStarted {
  id: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
}

/** The finished clip (`event: done`, or the blocking JSON reply); the bytes come from `GET /v1/video-presets/preview/clip/:id`. */
export interface VideoPresetClip {
  id: string;
  from_frame: number;
  to_frame: number;
  fps: number;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  bytes: number;
  encoder: string;
  cached: boolean;
  audio: boolean;
}

/** `GET /v1/persona/constraints`: the values a preset may constrain to. */
export interface PersonaConstraintOptions {
  countries: string[];
}

/** Proxy; credentials are write-only (`#[serde(skip_serializing)]`) and never returned. */
export interface Proxy {
  id: string;
  kind: ProxyKind;
  host: string;
  port: number;
  rotation: Rotation;
  /**
   * The operator's own name for this row, or `null` if they never gave one.
   *
   * The only field that tells two rows of one provider pool apart: kind, host,
   * port and rotation are identical across a bought gateway, and the session tag
   * that actually differs sits in the write-only username. Do not fall back to
   * `last_exit_ip` for identity; the health check wrote it hours or days ago and
   * a rotating exit no longer has that address.
   */
  label: string | null;
  last_exit_ip: string | null;
  last_country: string | null;
  /**
   * The operator string the geo probe answered with, for example
   * `"AS21928 T-Mobile USA, Inc."`. Part of the same measurement as the fields
   * around it: one check writes them, an endpoint change clears them together.
   * The daemon derives the address kind from it, which decides how long an
   * address stays reserved for a profile.
   */
  last_asn: string | null;
  /**
   * The IANA timezone the geo probe reported for the exit, for example
   * `"America/Chicago"`, or `null` when it reported none.
   *
   * Written by the same check that writes `last_asn`, and cleared with it when
   * the endpoint changes. It is not decoration: a profile on
   * `geo_mode: "follow_exit"` adopts THIS zone at every start when the country's
   * cohort knows it, instead of the country's canonical one, so a US proxy
   * exiting in Tulsa leaves the profile on `America/Chicago` rather than
   * `America/New_York`.
   */
  last_timezone: string | null;
  last_check_at: number | null;
  healthy: boolean | null;
  /** Round-trip latency of the last health check, in ms. */
  last_latency_ms: number | null;
  /**
   * The row holds credentials that could not be decrypted (a database restored
   * without its master key). Every launch through it fails closed, so a screen
   * that shows only `healthy` paints such a row green while nothing can use it.
   * Omitted by the daemon when false.
   */
  credentials_unreadable?: boolean;
  created_at: number;
}

/**
 * Who depends on one proxy, as `GET /v1/proxies` reports it per row.
 *
 * `count` is exact, `names` holds at most three. A proxy shared by a fleet must
 * not drag every profile name into the listing, so showing the names without the
 * count would turn "three of forty" into "these three".
 */
export interface ProxyUsage {
  count: number;
  names: string[];
}

/** A row of the proxy LIST: the proxy plus who uses it. The single GET has no `used_by`. */
export interface ProxyRow extends Proxy {
  used_by: ProxyUsage;
}

// ── Live detector audit (`/v1/profiles/:id/audit`) ───────────────────────────

/** Per-detector outcome; `skip` means the page could not be evaluated, NOT a pass. */
export type AuditVerdict = 'pass' | 'warn' | 'fail' | 'skip' | 'error';

export interface AuditDetectorReport {
  id: string;
  verdict: AuditVerdict;
  detail: string;
}

export interface AuditReport {
  schema_version: number;
  timestamp: string;
  overall: AuditVerdict;
  detectors: AuditDetectorReport[];
}

export interface AuditStatus {
  profile_id: string;
  /** `idle` (never run since the daemon started), `running`, or `finished`. */
  state: 'idle' | 'running' | 'finished';
  started_at?: number;
  finished_at?: number;
  /** Why the RUN failed, distinct from a detector's own `skip`. */
  error?: string;
  report?: AuditReport;
}

export interface CreateGroupBody {
  name: string;
}
export type UpdateGroupBody = Partial<CreateGroupBody>;

export interface CreatePresetBody {
  name: string;
  constraints?: PresetConstraints;
  config?: PresetConfig;
}
export type UpdatePresetBody = Partial<CreatePresetBody>;

export interface SessionExportBody {
  password: string;
  kinds?: SessionKind[];
}

export interface SessionExportResult {
  bundle: string;
  /**
   * Whether the cookies came out of the RUNNING browser for this export.
   *
   * `false` means the bundle carries only what was stored earlier, which for a
   * stopped profile is all there can be: a browser holds its jar in its own
   * process. Export while the profile runs for a current session.
   */
  harvested?: boolean;
  /** Why the bundle is thinner than it could be, when it is. */
  note?: string;
}

export interface SessionImportBody {
  password: string;
  bundle: string;
}

/**
 * Trusted-input payload (`POST /v1/profiles/:id/input`). Only
 * `action` and `humanize` are fixed by the API contract; the per-action
 * coordinate fields below are the SDK's assumption about the daemon's input
 * layer.
 */
export type TrustedInputBody =
  | { action: 'move'; x: number; y: number; width?: number; humanize?: boolean }
  | { action: 'click'; x: number; y: number; button?: string; click_count?: number; width?: number; humanize?: boolean }
  | { action: 'type'; text: string; humanize?: boolean }
  | { action: 'scroll'; x: number; y: number; delta_x?: number; delta_y?: number; humanize?: boolean };

// ── Agent runs + activity (payloads the live events carry) ───────────────────

/** Who is driving: an agent holding a lease, or a person at a window. */
export type RunActor = 'agent' | 'human';

/** How a run ended. `reached`/`partial` appear only when a source claimed it. */
export type RunOutcome = 'running' | 'reached' | 'partial' | 'blocked' | 'interrupted' | 'unknown';

/** What kind of thing a trail entry is. */
export type StepKind = 'page' | 'action' | 'interruption';

/** The element a step acted on, as it can still be recognised later. */
export interface StepTarget {
  role: string;
  name: string;
}

/** One tool call, as the operator gets to read it back. */
export interface RunStep {
  /** Position within the run, starting at 1. */
  seq: number;
  at: number;
  duration_ms: number | null;
  kind: StepKind;
  /** The tool name; `null` for a synthetic `page` step. */
  tool: string | null;
  target: StepTarget | null;
  /** A short human line. Carries typed text unless `redacted`. */
  summary: string | null;
  redacted: boolean;
  /** Set on `page` steps. */
  url: string | null;
  /** Path of the still under the runs API; the image is fetched separately. */
  shot_path: string | null;
  /**
   * What the call produced, in one line: "3 blocks, 122 characters",
   * "no visible change · 14 elements".
   *
   * `summary` says what the agent asked for, this says what came back. A step
   * recorded before this field existed has `null`.
   */
  result: string | null;
  error: string | null;
}

/** What one running profile is showing. */
export interface ProfileActivity {
  profile_id: string;
  profile_name: string;
  url: string;
  title: string;
  actor: RunActor;
  /** Unix seconds this address was first seen. */
  since: number;
  /** The browser did not answer the last sweep; this is the last known value. */
  stale: boolean;
}



// ── Exit-address exclusivity (`/v1/profiles/:id/exit`) ───────────────────────

/** How far a claim reaches. `machine` means this computer has no account key yet. */
export type ExitScope = 'machine' | 'account';

/** One exit address a profile owns. */
export interface ExitClaim {
  /** The comparison unit: the whole address for IPv4, the `/64` block for IPv6. */
  addr: string;
  /** `mobile` | `residential` | `datacenter` | `unknown`. Sets how long it is held. */
  class: string;
  scope: ExitScope;
  first_seen: number;
  last_seen: number;
  expires_at: number;
}

/** A profile's exit-address situation. */
export interface ExitStatus {
  /** Whether the rule applies to this installation at all. */
  enabled: boolean;
  /** Derived from the newest claim, not from configuration. */
  scope: ExitScope;
  /** The IPv4 address in use, when one is claimed. Carries its `v4:` prefix. */
  current: string | null;
  /**
   * The IPv6 `/64` in use, when the daemon measures v6 (`[exit] probe_url_v6`)
   * and the exit answered over it. `null` is the ordinary case and says nothing
   * about the exit: without that setting the guard never asks.
   */
  current_v6: string | null;
  /** How many addresses this profile owns. Both families count. */
  owned: number;
  claims: ExitClaim[];
  /** Set when the profile has no proxy and is therefore exempt. */
  note: string | null;
}
