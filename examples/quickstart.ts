/**
 * Quickstart: start a profile, drive it over direct-CDP (nodriver-style, NOT
 * Playwright), navigate, run a humanized click, and stop.
 *
 *   SCALEBROWSER_BASE_URL=http://127.0.0.1:8787 \
 *   SCALEBROWSER_TOKEN=… \
 *   npx tsx examples/quickstart.ts
 */
import { ScalebrowserClient } from '../src/index';

async function main(): Promise<void> {
  const client = new ScalebrowserClient({
    baseUrl: process.env['SCALEBROWSER_BASE_URL'] ?? 'http://127.0.0.1:8787',
    token: process.env['SCALEBROWSER_TOKEN'] ?? null,
  });

  // 1. Create a coherent, unlinkable profile (persona derived from a seed).
  const profile = await client.createProfile({ name: `quickstart-${Date.now()}` });
  console.log(`created profile ${profile.id} (${profile.persona?.os ?? 'persona pending'})`);

  // 2. Start it and open a direct-CDP session in one step. `await using` stops
  //    the profile and closes CDP when the block exits.
  await using session = await client.launch(profile.id, { headless: true });
  console.log(`cdp_ws: ${session.result.cdp_ws}`);

  // 3. Drive the page directly over CDP.
  await session.cdp.navigate('https://example.com');
  const title = await session.cdp.evaluate<string>('document.title');
  console.log(`page title: ${title}`);

  // 4. Humanized, trusted input routed through the daemon (G8).
  await session.cdp.humanizeMove(120, 220);
  await session.cdp.humanizeClick(120, 220);
  console.log('humanized click sent');

  // session stops on scope exit; clean up the profile.
  await client.deleteProfile(profile.id);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
