import type { SecretBindingMode } from './types-identity';

// Platform credentials, split out of `types.ts` on 2026-08-21 (the file was a 780-line
// churn hotspot). This file is part of the one source of the daemon's wire contract.
// ── Platform credentials ──────────────────────────────────────────────────────

/**
 * One stored platform login: everything about it EXCEPT the secrets.
 *
 * The username IS returned: it is the account's display identity, not a secret on
 * any platform, and without it two stored accounts are indistinguishable. The
 * password and two-factor key travel only through `revealCredential`, which needs
 * the vault password.
 */
export interface CredentialMeta {
  platform: string;
  username: string | null;
  login_url: string | null;
  has_password: boolean;
  has_totp: boolean;
  /** Typed into a sign-up form but never confirmed, so the account may not exist. */
  pending?: boolean;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  /** No longer opens with the current master key: listable, deletable, unusable. */
  secrets_unreadable?: boolean;
  /** Where this login may be typed (Secret Layer). */
  binding_mode: SecretBindingMode;
  binding_value?: string | null;
  /** Is the field-kind check on for this login? */
  field_bound: boolean;
}

/** An omitted secret means "leave it unchanged", not "delete it". */
export interface PutCredentialBody {
  username?: string | null;
  password?: string | null;
  /** Base32 setup key. Grouped, lower-case input is normalised by the daemon. */
  totp_secret?: string | null;
  login_url?: string | null;
  /**
   * Where this login may be typed. Absent leaves it as it is, so changing a
   * password never silently widens a binding.
   */
  binding_mode?: SecretBindingMode;
  binding_value?: string;
  field_bound?: boolean;
}

/** The only shape in this SDK that carries a password. */
export interface RevealedCredential {
  platform: string;
  username: string | null;
  password: string | null;
  totp_secret: string | null;
}

/** A passphrase-sealed backup of one profile's logins. */
export interface CredentialBundle {
  bundle: string;
  count: number;
}

export interface CredentialImportResult {
  /** Boolean, like the session import; the number is in `count`. */
  imported: boolean;
  count: number;
  platforms: string[];
}

export interface VaultStatus {
  configured: boolean;
}

