// Videos and recordings (`/v1/videos`, `/v1/recordings`): the wire shapes of
// the agent-video feature. A video row never carries a directory or a file name (the daemon may be on another
// machine); files are fetched through the grant route (`videoAccess` →
// `downloadVideoFile`).

import type { VideoPresetConfig } from './types';

export type RecordingKind = 'showcase' | 'proof';
export type RecordingState = 'recording' | 'finishing' | 'finished' | 'failed';
export type VideoState = 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';
export type ExportPresetName = 'web' | 'social' | '4k' | 'editing' | 'gif';
export type AudioStatus = 'ok' | 'silent' | 'off' | 'failed';
export type RenderStage =
  | 'planning'
  | 'narration'
  | 'compositing'
  | 'encoding'
  | 'finishing'
  | 'extras';

/** Which files a finished video has. Booleans on purpose, never paths. */
export interface VideoAssets {
  video: boolean;
  poster: boolean;
  preview_gif: boolean;
  srt: boolean;
  vtt: boolean;
  proof: boolean;
  timestamp: boolean;
  extras: ExportPresetName[];
}

export interface RenderProgress {
  stage: RenderStage;
  frames_done: number;
  frames_total: number | null;
  eta_ms: number | null;
  /** Which attempt this is; three is the last one. */
  attempts: number;
  heartbeat_at: number;
}

/** A chapter in OUTPUT time: it survives cuts and time-lapse. */
export interface Chapter {
  out_ms: number;
  src_ms: number;
  label: string;
  mark_id?: string | null;
  step_seq?: number | null;
}

export interface VideoFlags {
  page_audio: AudioStatus;
  tightened: boolean;
  masked_regions: number;
  gaps: number;
  ai_label: boolean;
  gpu: string;
  h264_profile: string;
}

export type TimestampState =
  | { state: 'pending' }
  | { state: 'stamped'; at: number; tsa: string }
  | { state: 'failed'; reason: string };

/** One spoken word and when it is heard in the finished video, in milliseconds from its start. */
export interface TranscriptWord {
  text: string;
  start_ms: number;
  end_ms: number;
}

/** One video row: queued and rendering renders included. */
export interface Video {
  id: string;
  recording_id: string;
  run_id: string | null;
  profile_id: string;
  job_id: string | null;
  state: VideoState;
  progress: RenderProgress | null;
  title: string;
  kind: RecordingKind;
  preset_name: string;
  /** The resolved recipe this video renders (or rendered) under. */
  preset: VideoPresetConfig;
  export: ExportPresetName;
  assets: VideoAssets;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number | null;
  sha256: string | null;
  timestamp: TimestampState | null;
  chapters: Chapter[];
  transcript: TranscriptWord[] | null;
  flags: VideoFlags | null;
  /** The share link of this video ON THIS MACHINE, or nothing shared yet. */
  share: ShareLinkLocal | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** One recording row. The row outlives its raw bytes (`raw_purged_at`). */
export interface Recording {
  id: string;
  profile_id: string;
  run_id: string | null;
  fence: number;
  kind: RecordingKind;
  state: RecordingState;
  title: string | null;
  /** The id of the stored preset the recording was made under, `null` when it named none. */
  preset_id: string | null;
  /** That preset's name as it read when the recording started. */
  preset_name: string | null;
  preset: VideoPresetConfig;
  manifest_version: number;
  css_width: number;
  css_height: number;
  dpr: number;
  capture_width: number;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  frames: number;
  frames_dropped: number;
  gaps: number;
  anchors: number;
  bytes: number;
  audio: AudioStatus;
  audio_reason: string | null;
  end_reason: string | null;
  raw_purged_at: number | null;
  purge_after: number | null;
  error: string | null;
}

export interface NarrationLine {
  mark_id?: string;
  step_seq?: number;
  text: string;
}

/**
 * Where a directing intent looks. `region` coordinates are page fractions
 * in 0..1; the other kinds need no coordinates.
 */
export interface ShotFocus {
  kind: 'overview' | 'target' | 'container' | 'region';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * One directing intent: you decide WHAT is on screen at a moment, the
 * camera executes it smoothly and keeps its guarantees. Anchor it to one
 * action (`at_anchor`, the ids listed in `plan.actions`) or to a source
 * moment (`at_ms`). Malformed intents are refused as `shot_invalid`;
 * anchors the recording does not know are skipped with a note.
 */
export interface ShotIntent {
  at_anchor?: string;
  at_ms?: number;
  focus: ShotFocus;
  zoom?: 'off' | 'gentle' | 'medium' | 'strong';
  /** Minimum dwell in ms before the next camera move (max 20000). */
  hold_ms?: number;
  note?: string;
}

/** The shared render-order schema (SPEC §5.2: one producer, every surface). */
export interface RenderRequestBody {
  preset?: string;
  export?: ExportPresetName;
  title?: string;
  subtitle?: string;
  /** `auto`, or a BCP-47 tag such as `de` or `en-US`. */
  language?: string;
  narration?: NarrationLine[];
  /** Directing intents; empty means the built-in direction decides. */
  shots?: ShotIntent[];
}

export interface ListVideosParams {
  q?: string;
  profile_id?: string;
  run_id?: string;
  kind?: RecordingKind;
  preset?: string;
  state?: VideoState;
  page?: number;
}

export interface VideosPage {
  videos: Video[];
  next: number | null;
}

/**
 * Which file an access grant is minted for.
 *
 * The extras carry the same prefix the daemon's own key register uses
 * (`extra:<preset>`), so a second export is reachable under the name it was
 * stored with rather than a name a caller invents.
 */
export type VideoAssetName =
  | 'video'
  | 'poster'
  | 'preview'
  | 'srt'
  | 'vtt'
  | 'proof'
  | 'timestamp'
  | `extra:${ExportPresetName}`;

export interface VideoAccessGrant {
  /** Relative URL carrying the grant; fetch it against the daemon base. */
  url: string;
  expires_at: number;
}

export interface VideosStorage {
  recordings_bytes: number;
  videos_bytes: number;
  /** The main files of the videos this machine still shares. */
  link_bytes: number;
  /** Known only to the control plane; `null` here. */
  link_limit: number | null;
  /** Known only to the control plane; `null` here. */
  uploads_today: number | null;
  /** Known only to the control plane; `null` here. */
  uploads_limit: number | null;
  capacity: { recordings_active: number; recordings_max: number };
}

/** What the machine can encode with, and the one switch an operator has. */
export interface CodecsStatus {
  openh264: {
    /** The operator's decision. */
    enabled: boolean;
    /** Measured now: the library is on disk and its hash is the pinned one. */
    installed: boolean;
    version: string | null;
    /** `downloaded` | `manual` | `absent`. */
    source: string;
    notice: string;
  };
  /** Hardware encoders that passed a real test encode, in preference order. */
  hardware: string[];
  /** Whether the hardware probe has run. Before it, an empty `hardware` means
   *  "not asked yet", not "none". */
  probed: boolean;
  /** Exports this daemon refuses whatever the order says, with the reason. An
   *  editor hides them rather than letting a render fail on them. */
  exports_blocked: BlockedExport[];
}

/** One export the daemon refuses, e.g. `4k` while a 3840-wide capture is not
 *  offered. `reason` starts with its snake code. */
export interface BlockedExport {
  export: ExportPresetName;
  reason: string;
}

/** What kind of file a media asset is. */
export type MediaKind = 'image' | 'music' | 'subtitle_style';

/** One uploaded file a preset refers to by id. */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  bytes: number;
  /** The content's checksum. It is also the file name on disk, so the same
   *  bytes are stored once however often they are uploaded. */
  sha256: string;
  created_at: number;
}

/** A speech provider that has a key stored.
 *
 *  There is deliberately no `api_key` here: the daemon answers with a hint and
 *  never with the value. A client that could read it back would be the one
 *  place it lands in a log again. */
export interface TtsProviderView {
  provider: 'elevenlabs' | 'fish_audio' | 'openai';
  /** The last few characters, never more. */
  key_hint: string;
  label: string | null;
  verified_at: number | null;
  updated_at: number;
}

/** What one real call to the provider proved.
 *
 *  A stored key and a working key are two things, so this speaks a short word
 *  and reports what came back. Only an answer that carried both audio and word
 *  timings counts: a 200 with an empty body proves nothing.
 */
export interface TtsVerifyResult {
  provider: 'elevenlabs' | 'fish_audio' | 'openai';
  /** Unix seconds. The same value the provider row now carries. */
  verified_at: number;
  wav_bytes: number;
  words: number;
}

/** Where a share link stands ON THIS MACHINE: an order, not a copy.
 *
 *  `outbox` is what is still owed: `pending` while the files are going up,
 *  `live` once the control plane confirmed, `revoke_pending` after a revoke that
 *  has not been acknowledged yet. A revoke-pending link STILL BLOCKS: between
 *  the order and the confirmation the page may still answer. */
export interface ShareLinkLocal {
  link_id: string;
  url: string;
  version: number;
  outbox: 'pending' | 'live' | 'revoke_pending';
  /** Whether the link asks for an access code. Never the code itself. */
  passcode: boolean;
  download: boolean;
  updated_at: number;
  error: string | null;
}

/** `GET /v1/videos/:id/share`: the order, and the link's access code when this
 *  machine keeps one (sealed at rest). A link the daemon makes for a preset with
 *  `export.destination.passcode` gets a generated code of ten characters, and
 *  this is where its owner reads it. `Video.share`, `video_changed` and the
 *  `video` tool never carry the code. */
export interface ShareStatus extends ShareLinkLocal {
  /** Absent when this machine keeps no code: the link has none, or its
   *  revocation is ordered. */
  code?: string;
}
