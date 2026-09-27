/**
 * The account layer: mailboxes, passkeys and the one door a cookie value leaves
 * through.
 *
 * One of the files that are the daemon's wire contract. The cookie
 * reveal has no UI counterpart: it is a REST-only route deliberately kept off
 * every screen.
 */

// ── Mailboxes (`/v1/inboxes`) ─────────────────────────────────────────────────

/** One configured mailbox. The password is never sent back. */
export interface Inbox {
  id: string;
  name: string;
  host: string;
  port: number;
  /** The mailbox login. Not a secret, and it is how two rows are told apart. */
  user: string;
  /** TLS from the first byte. `false` is only accepted towards this machine. */
  tls: boolean;
  folder: string;
  /**
   * The domain new addresses are minted under, e.g. `my-domain.tld`. Absent for
   * a mailbox with exactly one address.
   */
  address_domain: string | null;
  created_at: number;
  /**
   * The stored password could not be decrypted: a restored database without
   * its key. The row stays visible and deletable; every use of it fails closed.
   */
  credentials_unreadable?: boolean;
}

export interface CreateInboxBody {
  name: string;
  host: string;
  port: number;
  user: string;
  /** Required when creating; leave it out on an edit to keep the stored one. */
  password?: string;
  tls?: boolean;
  folder?: string;
  address_domain?: string | null;
}

export type UpdateInboxBody = CreateInboxBody;

/** Which channel a code arrives on. */
export type InboxChannel = 'email' | 'sms';

/** What one profile is bound to, per channel. */
export interface InboxBinding {
  profile_id: string;
  channel: InboxChannel;
  /** The address or number this profile is known by. */
  address: string;
  /**
   * The mailbox that answers. `null` means the operator's configured command
   * does, which is the only shape an SMS binding can have.
   */
  inbox_id: string | null;
  created_at: number;
}

export interface BindInboxBody {
  channel: InboxChannel;
  inbox_id?: string | null;
  /** Absent mints one under the mailbox's catch-all domain. */
  address?: string;
}

export interface InboxBindings {
  bindings: InboxBinding[];
}

// ── Passkeys (`/v1/profiles/:id/passkeys`) ────────────────────────────────────

/**
 * One passkey of a profile: a login that needs no password.
 *
 * `credential_id` names the row for deletion and nothing else. The private key
 * has no field here and no endpoint: it IS the account, and it could not be
 * typed anywhere useful, so returning it would be risk without a purpose.
 */
export interface PasskeyRow {
  credential_id: string;
  /** The site it belongs to, e.g. `github.com`. */
  rp_id: string;
  user_name: string | null;
  user_display: string | null;
  created_at: number;
  last_used_at: number | null;
  /** True when a stored secret cannot be decrypted; the sign-in WILL fail. */
  secrets_unreadable: boolean;
  /**
   * When the key stopped being usable, if it has. A retired key is never loaded
   * into the browser and never offered to an agent, but it stays visible until
   * it is cleared: an account that quietly stops working is the first thing
   * anyone asks about.
   */
  retired_at: number | null;
  /**
   * `unknown` is a reason this build cannot name, and it deliberately claims
   * nothing, because reading it as `operator` would tell you that you had deleted
   * something you never touched.
   */
  retired_reason: 'operator' | 'agent' | 'site_revoked' | 'unknown' | null;
}

// ── Cookies (`/v1/profiles/:id/cookies/reveal`) ───────────────────────────────

/** A cookie VALUE skips both the password and the second factor beside it. */
export interface RevealedCookie {
  name: string;
  domain: string;
  path: string;
  value: string;
}

export interface RevealCookiesBody {
  /** The same gate a far weaker password sits behind. */
  vault_password: string;
  domain: string;
  /** One cookie by name; omit for every cookie on the domain. */
  name?: string | null;
}

export interface RevealCookiesResult {
  domain: string;
  cookies: RevealedCookie[];
}

// ── Secret Layer (`/v1/profiles/:id/secrets`) ─────────────────────────────────

/** What a stored value is. */
export type SecretKind =
  | 'api_token'
  | 'password'
  | 'recovery_code'
  | 'totp_seed'
  | 'private_key'
  | 'unknown';

/** How the layer came to know it. The first three are the honest origins. */
export type SecretOrigin = 'generated' | 'stored' | 'typed' | 'captured';

/** How narrowly it is bound to where it may be used. */
export type SecretBindingMode = 'domain' | 'host' | 'prefix' | 'exact' | 'off';

/** Where it stands between "just seen" and "known good". */
export type SecretState = 'quarantined' | 'confirmed' | 'doubtful' | 'released';

export interface SecretRow {
  id: string;
  /** The immutable name inside the placeholder. Renaming changes the title. */
  label: string;
  display_title?: string | null;
  /** The placeholder for THIS daemon run. A new run draws a new session part. */
  secret_ref?: string;
  kind: SecretKind;
  origin: SecretOrigin;
  detected_by?: string | null;
  binding_mode: SecretBindingMode;
  binding_value?: string | null;
  field_bound: boolean;
  state: SecretState;
  sole_copy: boolean;
  /** Only present where the length is the FORMAT's rather than the value's. */
  length?: number | null;
  expires_at?: number | null;
  created_at: number;
  updated_at: number;
  last_used_at?: number | null;
  value_unreadable?: boolean;
}

export interface SecretListResult {
  secrets: SecretRow[];
  /** Values still being censored that have no entry, because the list is full. */
  withheld_without_an_entry: number;
  layer_enabled: boolean;
}

/** What may be changed about one entry. The label is deliberately absent. */
export interface SecretPatchBody {
  display_title?: string;
  binding_mode?: SecretBindingMode;
  binding_value?: string;
  clear_binding_value?: boolean;
  field_bound?: boolean;
  state?: SecretState;
  expires_at?: number;
  clear_expires_at?: boolean;
}

export interface SecretRunMention {
  run_id: string;
  goal: string;
  started_at: number;
  steps: number;
}

export interface SecretDeleteResult {
  deleted: string;
  label: string;
  /** The runs this entry appeared in, so nothing is removed blind. */
  appeared_in_runs: SecretRunMention[];
}

export interface SecretScrubResult {
  text: string;
  /** Which entries were replaced, by label. Never a value. */
  replaced: string[];
}

export interface SecretRunBody {
  /** `NAME=<label>` pairs. At least one is required. */
  env: string[];
  /** The command and its arguments, already split. Never a shell line. */
  command: string[];
  cwd?: string;
  timeout_secs?: number;
}

export interface SecretRunResult {
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  values_supplied: string[];
}
