// Persona axes (read-only; derived from `seed`), split out of `types.ts` on 2026-08-21 (the file was a 780-line
// churn hotspot). This file is part of the one source of the daemon's wire contract.
// ── Persona (read-only; derived deterministically from `seed`) ───────────────

import type { OsFamily } from "./types"

export interface Screen {
  width: number;
  height: number;
  avail_width: number;
  avail_height: number;
  color_depth: number;
  pixel_depth: number;
  device_pixel_ratio: number;
  orientation: string;
}

export interface Locale {
  language: string;
  languages: string[];
  accept_language: string;
}

export interface WebGl {
  vendor: string;
  renderer: string;
  unmasked_vendor: string;
  unmasked_renderer: string;
  version: string;
  shading_language_version: string;
}

export interface WebGpu {
  present: boolean;
  adapter: string;
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

export interface AudioProps {
  sample_rate: number;
  base_latency: number;
  max_channel_count: number;
  output_channel_count: number;
}

export interface SpeechVoice {
  name: string;
  lang: string;
  local_service: boolean;
  default: boolean;
}

export interface GpuPersona {
  backend: string;
  vendor: string;
  model: string;
}

export interface Brand {
  brand: string;
  version: string;
}

export interface ClientHints {
  brands: Brand[];
  full_version_list: Brand[];
  platform: string;
  platform_version: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  ua_full_version: string;
  wow64: boolean;
}

export interface PermissionDefaults {
  notifications: string;
  geolocation: string;
  camera: string;
  microphone: string;
}

export interface MediaDevice {
  kind: string;
  label: string;
  device_id: string;
  group_id: string;
}

export interface PersonaMisc {
  webdriver: boolean;
  get_installed_related_apps: boolean;
  max_touch_points: number;
  pdf_viewer_enabled: boolean;
}

export interface Persona {
  os: OsFamily;
  user_agent: string;
  platform: string;
  browser_version: string;
  screen: Screen;
  hardware_concurrency: number;
  device_memory: number;
  timezone: string;
  locale: Locale;
  webgl: WebGl;
  webgpu: WebGpu;
  fonts: string[];
  noise_seed: number;
  audio: AudioProps;
  speech_voices: SpeechVoice[];
  gpu_persona: GpuPersona;
  client_hints: ClientHints;
  permissions: PermissionDefaults;
  media_devices: MediaDevice[];
  misc: PersonaMisc;
}

