// Metrics (dashboard), split out of `types.ts` on 2026-08-21 (the file was a 780-line
// churn hotspot). This file is part of the one source of the daemon's wire contract.
// ── Metrics (Dashboard) ──────────────────────────────────────────────────────

/**
 * Dashboard/SDK metrics. The daemon serves `GET /v1/metrics`
 * from a background sampler; each null-able figure is disambiguated by
 * {@link Metrics.availability} (`measured` vs `unsupported` vs `unavailable`).
 * Against an old daemon without the endpoint (404) the client falls back to
 * deriving running counts from profile states and stamps `source: "derived"`
 * (see {@link deriveMetricsFromProfiles}).
 */
export type ProbeState = 'measured' | 'unsupported' | 'unavailable';
export type MetricsSource = 'live' | 'derived';

export interface MetricsAvailability {
  ram: ProbeState;
  cpu: ProbeState;
  gpu: ProbeState;
  vram: ProbeState;
  per_profile: ProbeState;
}

export interface ProfileResource {
  profile_id: string;
  name: string;
  pid: number | null;
  ram_mb: number | null;
  cpu_pct: number | null;
  vram_mb: number | null;
}

export interface Metrics {
  running: number;
  capacity_max_concurrent: number;
  ram_used_mb: number | null;
  // Never null on the wire: Rust serializes a bare `u64` (`metrics/mod.rs`).
  // The `| null` both mirrors used to carry was recalled, not read.
  ram_budget_mb: number;
  vram_used_mb: number | null;
  vram_budget_mb: number | null;
  cpu_pct: number | null;
  gpu_pct: number | null;
  // Additive (optional for tolerance toward an old daemon's 8-field response).
  source?: MetricsSource;
  sampled_at?: number | null;
  availability?: MetricsAvailability;
  profiles?: ProfileResource[];
  /**
   * Launchable host memory (MiB), the capacity gate's own reading. "How many
   * more browsers fit" derives from THIS; `ram_budget_mb − ram_used_mb` does
   * not subtract (used is host-wide, the budget is the daemon's own ceiling).
   */
  ram_available_mb?: number | null;
}

