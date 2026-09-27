// Platform credentials, mailboxes, passkeys and the cookie reveal, split out of `client.ts` on 2026-08-21. A resource mixin:
// `ScalebrowserClient` merges this class (interface-extends + applyMixins in
// `client.ts`), so every method here IS a public client method. Excluded from
// the wire-type mirror (client*.ts) and listed in sdk_coverage.rs.
import { ClientCore, enc } from './client-core';
import type { CredentialBundle, CredentialImportResult, CredentialMeta, PutCredentialBody, RevealedCredential, VaultStatus } from './types-credentials';
import type { BindInboxBody, CreateInboxBody, Inbox, InboxBindings, PasskeyRow, RevealCookiesBody, RevealCookiesResult, SecretDeleteResult, SecretListResult, SecretPatchBody, SecretRow, SecretRunBody, SecretRunResult, SecretScrubResult, UpdateInboxBody } from './types-identity';

export class IdentityApi extends ClientCore {
  // ── Platform credentials ────────────────────────────────────────────────────
  //
  // Stored logins, so an agent can sign a profile into a platform WITHOUT ever
  // holding the password: the daemon decrypts and types it. Only `revealCredential`
  // and the bundle calls return plaintext, and every one of them needs the vault
  // password: the bearer token alone is not enough, because the MCP agent layer
  // authenticates with exactly the same one.
  //
  // `platform` is whatever you have: the service's domain ("discord.com"), its
  // name ("Discord") or a host under it ("www.discord.com"). The daemon resolves
  // all of them to ONE key (the registrable domain), and every response echoes
  // that key, so `listCredentials` and a later `deleteCredential` agree. Pass a
  // whole sign-in URL only to the MCP tools: here the platform is a path segment,
  // and a `/` in it is refused rather than read as a path.

  /** Which platforms this profile can log into. Never carries a secret. */
  listCredentials(profileId: string, signal?: AbortSignal): Promise<CredentialMeta[]> {
    return this.request<CredentialMeta[]>(
      'GET',
      `/v1/profiles/${enc(profileId)}/credentials`,
      undefined,
      { signal },
    );
  }

  /**
   * Store or update one login.
   *
   * An omitted secret keeps its stored value rather than clearing it, because an edit form
   * never saw the password in the clear, so it cannot resend one; delete the row to
   * remove a credential. `totp_secret` may be pasted exactly as a site presents it
   * (grouped, lower case): it is normalised and test-decoded by the daemon, so a
   * broken key is refused here rather than half-way through a login.
   */
  putCredential(
    profileId: string,
    platform: string,
    body: PutCredentialBody,
  ): Promise<CredentialMeta> {
    return this.request<CredentialMeta>(
      'PUT',
      `/v1/profiles/${enc(profileId)}/credentials/${enc(platform)}`,
      body,
    );
  }

  /** Forget one login. The account itself is untouched. */
  deleteCredential(profileId: string, platform: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/v1/profiles/${enc(profileId)}/credentials/${enc(platform)}`,
    );
  }

  /** Read one login back in the clear. Needs the vault password. */
  revealCredential(
    profileId: string,
    platform: string,
    vaultPassword: string,
  ): Promise<RevealedCredential> {
    return this.request<RevealedCredential>(
      'POST',
      `/v1/profiles/${enc(profileId)}/credentials/${enc(platform)}/reveal`,
      { vault_password: vaultPassword },
    );
  }

  /**
   * Pack this profile's logins into a bundle sealed with `password`.
   *
   * `password` is deliberately separate from the vault password: a backup gets
   * handed to another machine, and that must not also hand over daemon access. This
   * is the answer to a lost master key: a daemon-generated password exists nowhere
   * else.
   */
  exportCredentials(
    profileId: string,
    vaultPassword: string,
    password: string,
  ): Promise<CredentialBundle> {
    return this.request<CredentialBundle>(
      'POST',
      `/v1/profiles/${enc(profileId)}/credential-bundle/export`,
      { vault_password: vaultPassword, password },
    );
  }

  /** Restore a bundle into this profile. */
  importCredentials(
    profileId: string,
    vaultPassword: string,
    password: string,
    bundle: string,
  ): Promise<CredentialImportResult> {
    return this.request<CredentialImportResult>(
      'POST',
      `/v1/profiles/${enc(profileId)}/credential-bundle/import`,
      { vault_password: vaultPassword, password, bundle },
    );
  }

  /** Has a vault password been set on this daemon? */
  vaultStatus(signal?: AbortSignal): Promise<VaultStatus> {
    return this.request<VaultStatus>('GET', '/v1/vault', undefined, { signal });
  }

  /** Set the vault password, or change it (then `currentPassword` is required). */
  setVaultPassword(newPassword: string, currentPassword?: string): Promise<void> {
    return this.request<void>('PUT', '/v1/vault', {
      new_password: newPassword,
      current_password: currentPassword,
    });
  }

  // ── Mailboxes ──────────────────────────────────────────────────────────────

  /** Mailboxes, passwords never returned. */
  listInboxes(signal?: AbortSignal): Promise<Inbox[]> {
    return this.request<Inbox[]>('GET', '/v1/inboxes', undefined, { signal });
  }

  createInbox(body: CreateInboxBody): Promise<Inbox> {
    return this.request<Inbox>('POST', '/v1/inboxes', body);
  }

  /** An omitted `password` leaves the stored one unchanged. */
  updateInbox(inboxId: string, body: UpdateInboxBody): Promise<Inbox> {
    return this.request<Inbox>('PUT', `/v1/inboxes/${enc(inboxId)}`, body);
  }

  deleteInbox(inboxId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/inboxes/${enc(inboxId)}`);
  }

  /** Which mailbox a profile's confirmation codes arrive in, per channel. */
  getInboxBindings(profileId: string, signal?: AbortSignal): Promise<InboxBindings> {
    return this.request<InboxBindings>('GET', `/v1/profiles/${enc(profileId)}/inbox`, undefined, {
      signal,
    });
  }

  bindInbox(profileId: string, body: BindInboxBody): Promise<InboxBindings> {
    return this.request<InboxBindings>('PUT', `/v1/profiles/${enc(profileId)}/inbox`, body);
  }

  unbindInbox(profileId: string, channel: string): Promise<unknown> {
    return this.request('DELETE', `/v1/profiles/${enc(profileId)}/inbox/${enc(channel)}`);
  }

  // ── Passkeys ───────────────────────────────────────────────────────────────

  /** What this profile can sign in to without a password. Metadata only. */
  listPasskeys(profileId: string, signal?: AbortSignal): Promise<PasskeyRow[]> {
    return this.request<PasskeyRow[]>('GET', `/v1/profiles/${enc(profileId)}/passkeys`, undefined, {
      signal,
    });
  }

  /**
   * Retire a passkey.
   *
   * Calling it twice is meaningful: the first call retires a live key and leaves
   * a headstone, the second clears the headstone for good.
   */
  deletePasskey(profileId: string, credentialId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/profiles/${enc(profileId)}/passkeys/${enc(credentialId)}`);
  }

  // ── Secret Layer ───────────────────────────────────────────────────────────
  //
  // Values a profile holds that no agent ever reads. Nothing here returns a
  // value, and that is not an oversight: the wrapper below starts the command
  // INSIDE the daemon precisely so that no route has to hand plaintext out.

  /** The entries this profile keeps, with the placeholder that stands for each. */
  listSecrets(profileId: string, signal?: AbortSignal): Promise<SecretListResult> {
    return this.request<SecretListResult>(
      'GET',
      `/v1/profiles/${enc(profileId)}/secrets`,
      undefined,
      { signal },
    );
  }

  /** Change a title, a binding, or the state. Never the label. */
  updateSecret(profileId: string, secretId: string, body: SecretPatchBody): Promise<SecretRow> {
    return this.request<SecretRow>(
      'PATCH',
      `/v1/profiles/${enc(profileId)}/secrets/${enc(secretId)}`,
      body,
    );
  }

  /** Delete an entry. The reply names the runs it appeared in. */
  deleteSecret(profileId: string, secretId: string): Promise<SecretDeleteResult> {
    return this.request<SecretDeleteResult>(
      'DELETE',
      `/v1/profiles/${enc(profileId)}/secrets/${enc(secretId)}`,
    );
  }

  /**
   * Filter a text you hold against this profile's values.
   *
   * The SDK path exists because censoring only makes sense where a MODEL is
   * reading: your own code is not, and a placeholder in the middle of it would
   * break parsing. So the daemon offers the filter as a call rather than
   * applying it to a channel it does not own.
   */
  scrubText(profileId: string, text: string): Promise<SecretScrubResult> {
    return this.request<SecretScrubResult>(
      'POST',
      `/v1/profiles/${enc(profileId)}/secrets/scrub`,
      { text },
    );
  }

  /**
   * Run a command with named values in its environment.
   *
   * The daemon starts the child, so no value crosses a socket. At least one
   * `env` entry is required: without the rule an `npm publish` would carry every
   * value of the profile.
   */
  runWithSecrets(profileId: string, body: SecretRunBody): Promise<SecretRunResult> {
    return this.request<SecretRunResult>(
      'POST',
      `/v1/profiles/${enc(profileId)}/secrets/run`,
      body,
    );
  }

  /** Is the secret layer on? It is by default. */
  getSecretLayer(signal?: AbortSignal): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>('GET', '/v1/secret-layer', undefined, { signal });
  }

  /** Turn the secret layer on or off for the whole daemon. */
  setSecretLayer(enabled: boolean): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>('POST', '/v1/secret-layer', { enabled });
  }

  // ── Cookies ────────────────────────────────────────────────────────────────

  /**
   * The one door a cookie VALUE leaves through, and it needs the vault password.
   *
   * A session cookie skips both the password and the second factor, which is why
   * every other cookie surface answers with metadata only.
   */
  revealCookies(profileId: string, body: RevealCookiesBody): Promise<RevealCookiesResult> {
    return this.request<RevealCookiesResult>('POST', `/v1/profiles/${enc(profileId)}/cookies/reveal`, body);
  }

}
