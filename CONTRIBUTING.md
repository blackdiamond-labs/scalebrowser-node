# Contributing

This repository holds the source of `@scalebrowser/sdk`, the Node/TypeScript
client for the Scalebrowser daemon. It is published from the Scalebrowser
source tree at every release, so each release arrives here as one commit and
one tag, and npm builds the package from exactly that commit (see the
provenance badge on npmjs.com).

A change made directly in this repository would be overwritten by the next
release. If you found a bug or miss something, write to
support@scalebrowser.net; a pull request is welcome as a way to show the
change, and an accepted change comes back here with the next release.

## Develop

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node ci/package-smoke.mjs
```

The end-to-end test runs only against a real daemon:

```bash
SCALEBROWSER_E2E=1 SCALEBROWSER_BASE_URL=http://127.0.0.1:8787 SCALEBROWSER_TOKEN=... npm test -- e2e
```
