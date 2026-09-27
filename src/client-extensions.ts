// The extension library and per-profile attachments, split out of `client.ts` on 2026-08-21. A resource mixin:
// `ScalebrowserClient` merges this class (interface-extends + applyMixins in
// `client.ts`), so every method here IS a public client method. Excluded from
// the wire-type mirror (client*.ts) and listed in sdk_coverage.rs.
import { ClientCore, enc } from './client-core';
import type { Extension, ExtensionsResult } from './types-requests';

export class ExtensionsApi extends ClientCore {
  // ── Extension library (daemon-wide) ─────────────────────────────────────────
  //
  // Upload a `.crx`; the daemon lifts its public key out of the CRX header and
  // writes it into the unpacked `manifest.json`, so every profile loads the
  // package under its CANONICAL Web-Store id. A key-less package is refused, since it
  // would take a path-derived id, identical across the fleet.

  /** The library, newest first. */
  listLibraryExtensions(signal?: AbortSignal): Promise<Extension[]> {
    return this.request<Extension[]>('GET', '/v1/extensions', undefined, { signal });
  }
  /**
   * Add a package. `crx` is the raw `.crx` file. A new VERSION is stocked alongside the
   * existing ones (profiles draw their own); re-uploading the same version replaces it.
   */
  uploadExtension(crx: Uint8Array | ArrayBuffer): Promise<Extension> {
    return this.request<Extension>('POST', '/v1/extensions', crx);
  }
  /** One library entry: the most recently added version. */
  getLibraryExtension(id: string, signal?: AbortSignal): Promise<Extension> {
    return this.request<Extension>('GET', `/v1/extensions/${enc(id)}`, undefined, { signal });
  }
  /** Remove EVERY version of a package, its files and every profile's assignment of it. */
  deleteLibraryExtension(id: string): Promise<unknown> {
    return this.request('DELETE', `/v1/extensions/${enc(id)}`);
  }
  /**
   * Remove ONE stocked version.
   *
   * Assignments survive, because they name the extension and not the version, unless this
   * was the last version, in which case they go with it.
   */
  deleteLibraryExtensionVersion(id: string, version: string): Promise<unknown> {
    return this.request('DELETE', `/v1/extensions/${enc(id)}/${enc(version)}`);
  }

  // ── Extensions per profile ──────────────────────────────────────────────────
  //
  // `extRef` is a LIBRARY ID, not a path. The launch copies each assigned package
  // into the profile's own tree and loads that, so files and state stay per-profile
  // while the id stays shared (which is the camouflage, not the leak).

  /** The profile's assigned set, resolved, + the launch policy. */
  listExtensions(profileId: string, signal?: AbortSignal): Promise<ExtensionsResult> {
    return this.request<ExtensionsResult>(
      'GET',
      `/v1/profiles/${enc(profileId)}/extensions`,
      undefined,
      { signal },
    );
  }
  /** Assign a library id (idempotent) → the updated set + policy. 404 if unknown. */
  attachExtension(profileId: string, extRef: string): Promise<ExtensionsResult> {
    return this.request<ExtensionsResult>('POST', `/v1/profiles/${enc(profileId)}/extensions`, {
      ext_ref: extRef,
    });
  }
  /** Unassign a library id (idempotent) → the updated set + policy. */
  detachExtension(profileId: string, extRef: string): Promise<ExtensionsResult> {
    return this.request<ExtensionsResult>('DELETE', `/v1/profiles/${enc(profileId)}/extensions`, {
      ext_ref: extRef,
    });
  }

}
