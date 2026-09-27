// Videos and recordings, split out like `client-runs.ts`: a resource mixin
// merged into `ScalebrowserClient` (interface-extends + applyMixins in
// `client.ts`), so every method here IS a public client method.
//
// Files never travel as paths: `videoAccess` mints a short-lived grant URL,
// `downloadVideoFile` fetches the bytes through it (Range-capable on the
// daemon side; this method reads them whole).
import { ClientCore, enc } from './client-core';
import type { ArtifactBytes } from './types-control';
import type {
  CodecsStatus,
  ListVideosParams,
  MediaAsset,
  MediaKind,
  ShareLinkLocal,
  ShareStatus,
  Recording,
  RenderRequestBody,
  Video,
  VideoAccessGrant,
  VideoAssetName,
  TtsProviderView,
  TtsVerifyResult,
  VideosPage,
  VideosStorage,
} from './types-videos';

export class VideosApi extends ClientCore {
  // ── Videos ────────────────────────────────────────────────────────────────

  /** One gallery page, newest first. Running renders are videos too. */
  listVideos(params: ListVideosParams = {}, signal?: AbortSignal): Promise<VideosPage> {
    return this.request<VideosPage>('GET', '/v1/videos', undefined, {
      query: {
        q: params.q,
        profile_id: params.profile_id,
        run_id: params.run_id,
        kind: params.kind,
        preset: params.preset,
        state: params.state,
        page: params.page,
      },
      signal,
    });
  }

  /** One video row, progress included while it renders. */
  getVideo(videoId: string, signal?: AbortSignal): Promise<Video> {
    return this.request<Video>('GET', `/v1/videos/${enc(videoId)}`, undefined, { signal });
  }

  /** Rename. The title also lands in the MP4's metadata on the NEXT render. */
  renameVideo(videoId: string, title: string, signal?: AbortSignal): Promise<Video> {
    return this.request<Video>('PATCH', `/v1/videos/${enc(videoId)}`, { title }, { signal });
  }

  /**
   * Delete a video (`raw: true` also purges its recording's raw material).
   * A live share link is revoked first; 409 `job_running` while it renders.
   */
  deleteVideo(videoId: string, opts: { raw?: boolean } = {}, signal?: AbortSignal): Promise<void> {
    return this.request<void>('DELETE', `/v1/videos/${enc(videoId)}`, undefined, {
      query: { raw: opts.raw },
      signal,
    });
  }

  /** Cancel a queued or rendering video. `done` stays done (409). */
  cancelVideo(videoId: string, signal?: AbortSignal): Promise<Video> {
    return this.request<Video>('POST', `/v1/videos/${enc(videoId)}/cancel`, undefined, {
      signal,
    });
  }

  /** Render a failed or cancelled video again: same id, new job. */
  rerenderVideo(
    videoId: string,
    body: RenderRequestBody = {},
    signal?: AbortSignal,
  ): Promise<Video> {
    return this.request<Video>('POST', `/v1/videos/${enc(videoId)}/renders`, body, { signal });
  }

  /** A short-lived fetchable address for one asset (default the video). */
  videoAccess(
    videoId: string,
    asset?: VideoAssetName,
    signal?: AbortSignal,
  ): Promise<VideoAccessGrant> {
    return this.request<VideoAccessGrant>(
      'POST',
      `/v1/videos/${enc(videoId)}/access`,
      asset ? { asset } : {},
      { signal },
    );
  }

  /** One asset's bytes, through a freshly minted grant. */
  async downloadVideoFile(
    videoId: string,
    asset: VideoAssetName = 'video',
    signal?: AbortSignal,
  ): Promise<ArtifactBytes> {
    const grant = await this.videoAccess(videoId, asset, signal);
    const grantParam = new URL(grant.url, 'http://x').searchParams.get('grant') ?? '';
    return this.requestBytes('GET', `/v1/videos/${enc(videoId)}/file`, {
      query: { asset, grant: grantParam },
      signal,
    });
  }

  /** What recordings and videos cost on disk, plus the caps. */
  videosStorage(signal?: AbortSignal): Promise<VideosStorage> {
    return this.request<VideosStorage>('GET', '/v1/videos/storage', undefined, { signal });
  }

  // ── Recordings ────────────────────────────────────────────────────────────

  /** Recordings, newest first. The row outlives its raw bytes. */
  listRecordings(params: { profile_id?: string } = {}, signal?: AbortSignal): Promise<Recording[]> {
    return this.request<Recording[]>('GET', '/v1/recordings', undefined, {
      query: { profile_id: params.profile_id },
      signal,
    });
  }

  getRecording(recordingId: string, signal?: AbortSignal): Promise<Recording> {
    return this.request<Recording>('GET', `/v1/recordings/${enc(recordingId)}`, undefined, {
      signal,
    });
  }

  /**
   * Purge a recording's RAW material; the row stays forever
   * (`raw_purged_at`). 409 `job_running` while a render of it is open.
   */
  deleteRecordingRaw(recordingId: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>('DELETE', `/v1/recordings/${enc(recordingId)}`, undefined, {
      signal,
    });
  }

  /** A NEW video from this recording (the same body the `video` tool takes). */
  renderRecording(
    recordingId: string,
    body: RenderRequestBody = {},
    signal?: AbortSignal,
  ): Promise<Video> {
    return this.request<Video>('POST', `/v1/recordings/${enc(recordingId)}/renders`, body, {
      signal,
    });
  }

  // ── Codecs ────────────────────────────────────────────────────────────────

  /** What this machine can encode with. The hardware list is PROBED, not read
   *  off the binary: `h264_nvenc` is always listed and fails without a driver. */
  getCodecs(signal?: AbortSignal): Promise<CodecsStatus> {
    return this.request<CodecsStatus>('GET', '/v1/codecs', undefined, { signal });
  }

  /** Turn Cisco's OpenH264 on or off. The hardware encoders are not switchable. */
  setCodecEnabled(codec: string, enabled: boolean, signal?: AbortSignal): Promise<CodecsStatus> {
    return this.request<CodecsStatus>('PUT', `/v1/codecs/${enc(codec)}`, { enabled }, { signal });
  }

  // -- Sharing ----------------------------------------------------------------

  /** Make a finished video public. Measures every file, asks the control plane
   *  for permission, uploads, and has the result confirmed. */
  share(
    videoId: string,
    body: { expires_days?: number | null; passcode?: string | null; download?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<ShareLinkLocal> {
    return this.request<ShareLinkLocal>('POST', `/v1/videos/${enc(videoId)}/share`, body, {
      signal,
    });
  }

  /** The share ORDER as this machine knows it. How many people watched and
   *  whether the link still lives is read from the control plane, not from
   *  here: a number carried along would be wrong the moment another machine
   *  revoked. */
  shareStatus(videoId: string, signal?: AbortSignal): Promise<ShareStatus> {
    return this.request<ShareStatus>(
      'GET',
      `/v1/videos/${enc(videoId)}/share`,
      undefined,
      { signal },
    );
  }

  /** Revoke the link. The files fall at once; the order stays until the control
   *  plane confirms. */
  revokeShare(videoId: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>('DELETE', `/v1/videos/${enc(videoId)}/share`, undefined, {
      signal,
    });
  }

  // -- Media ------------------------------------------------------------------

  /** Files a preset points at: background image, music bed, subtitle font. */
  listMedia(kind?: MediaKind, signal?: AbortSignal): Promise<MediaAsset[]> {
    return this.request<MediaAsset[]>('GET', '/v1/media', undefined, {
      query: { kind },
      signal,
    });
  }

  /** Upload one file. The body IS the file; `name` and `mime` ride in the query. */
  uploadMedia(
    kind: MediaKind,
    name: string,
    mime: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<MediaAsset> {
    return this.request<MediaAsset>('POST', '/v1/media', bytes, {
      query: { kind, name, mime },
      signal,
    });
  }

  /** Remove a file. Refuses with 409 while a preset still points at it. */
  deleteMedia(id: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>('DELETE', `/v1/media/${enc(id)}`, undefined, { signal });
  }

  /** The file itself. */
  mediaFile(id: string, signal?: AbortSignal): Promise<ArtifactBytes> {
    return this.requestBytes('GET', `/v1/media/${enc(id)}/file`, { signal });
  }

  // -- Voice providers --------------------------------------------------------

  /** Which speech providers have a key. The key itself never comes back: the
   *  answer carries a hint, and that is on purpose. */
  listTtsProviders(signal?: AbortSignal): Promise<TtsProviderView[]> {
    return this.request<TtsProviderView[]>('GET', '/v1/tts-providers', undefined, { signal });
  }

  /** Store a key, or rename one. Leaving `apiKey` out keeps the stored key.
   *
   *  `apiKey` may also be a secret reference (`{{sb:...}}`), which is what an
   *  agent gets back after fetching a key from the provider's own site: it is
   *  not allowed to read the value. A reference needs `profileId`, because the
   *  value belongs to one profile and there is nothing to open without it.
   */
  putTtsProvider(
    provider: string,
    body: { apiKey?: string; label?: string; profileId?: string },
    signal?: AbortSignal,
  ): Promise<TtsProviderView> {
    return this.request<TtsProviderView>(
      'PUT',
      `/v1/tts-providers/${enc(provider)}`,
      { api_key: body.apiKey, label: body.label, profile_id: body.profileId },
      { signal },
    );
  }

  /** Call the provider once for real, and record that the key works.
   *
   *  Costs one short sentence of the account's own quota. Until this runs, a
   *  provider row says `verified_at: null`, which means untested rather than
   *  broken.
   */
  verifyTtsProvider(provider: string, signal?: AbortSignal): Promise<TtsVerifyResult> {
    return this.request<TtsVerifyResult>(
      'POST',
      `/v1/tts-providers/${enc(provider)}/verify`,
      undefined,
      { signal },
    );
  }

  /** Forget a provider's key. */
  deleteTtsProvider(provider: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>('DELETE', `/v1/tts-providers/${enc(provider)}`, undefined, {
      signal,
    });
  }
}
