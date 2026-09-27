/**
 * End-to-end smoke test against a REAL daemon (+ mock engine). Skipped unless
 * `SCALEBROWSER_E2E=1`. Run it against a daemon:
 *
 *   SCALEBROWSER_E2E=1 \
 *   SCALEBROWSER_BASE_URL=http://127.0.0.1:8787 \
 *   SCALEBROWSER_TOKEN=… \
 *   npm test -- e2e
 *
 * Exercises the full contract path: create → start → direct-CDP connect →
 * navigate → humanized click → stop → delete.
 */
import { describe, expect, it } from 'vitest';
import { ScalebrowserClient } from '../src/index';

const E2E = process.env['SCALEBROWSER_E2E'] === '1';
const BASE_URL = process.env['SCALEBROWSER_BASE_URL'] ?? 'http://127.0.0.1:8787';
const TOKEN = process.env['SCALEBROWSER_TOKEN'] ?? null;

describe('e2e (real daemon)', () => {
  it.skipIf(!E2E)('drives a profile over direct-CDP', async () => {
    const client = new ScalebrowserClient({ baseUrl: BASE_URL, token: TOKEN });

    const profile = await client.createProfile({ name: `sdk-e2e-${Date.now()}` });
    try {
      await using session = await client.launch(profile.id, { headless: true });
      expect(session.result.cdp_ws).toMatch(/^ws:\/\//);

      await session.cdp.navigate('https://example.com');
      const title = await session.cdp.evaluate<string>('document.title');
      expect(typeof title).toBe('string');

      await session.cdp.humanizeMove(100, 120);
      await session.cdp.humanizeClick(100, 120);
    } finally {
      await client.deleteProfile(profile.id).catch(() => {});
    }
  });
});
