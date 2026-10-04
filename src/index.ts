/**
 * `@scalebrowser/sdk`: the official Node/TypeScript SDK for the Scalebrowser
 * daemon. A typed REST client plus a direct-CDP driver plane (nodriver-style,
 * NOT Playwright).
 *
 * ```ts
 * import { ScalebrowserClient } from '@scalebrowser/sdk';
 *
 * const sb = new ScalebrowserClient({ baseUrl: 'http://127.0.0.1:8787', token });
 * const profile = await sb.createProfile({ name: 'acct-01' });
 * await using session = await sb.launch(profile.id, { headless: true });
 * await session.cdp.navigate('https://example.com');
 * const title = await session.cdp.evaluate<string>('document.title');
 * await session.cdp.humanizeClick(120, 240);
 * ```
 */
export { ScalebrowserClient, DEFAULT_CAPACITY, deriveMetricsFromProfiles } from './client';
export type { ScalebrowserClientOptions, LaunchHandle } from './client';

export {
  CdpSession,
  openCdpSession,
} from './cdp';
export type {
  CdpEvent,
  CdpConnectOptions,
  AttachOptions,
  NavigateOptions,
  EvaluateOptions,
  ClickOptions,
  ScrollOptions,
  InputClient,
} from './cdp';

export { subscribeEvents, eventStream, parseSseFrame } from './events';
export type { FetchLike, StreamHandlers, StreamParams, StreamStatus } from './events';

export {
  ScalebrowserError,
  ApiError,
  NetworkError,
  CdpError,
  ErrorCode,
  errorMessage,
} from './errors';
export type { ApiErrorBody, ErrorCodeValue } from './errors';

export * from './types';
export * from './types-runs';
export * from './types-videos';
export * from './types-identity';
export * from './types-control';
export * from './types-tasks';

export const VERSION = '1.1.0';
