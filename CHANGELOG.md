# Changelog

The Node/TypeScript SDK for the Scalebrowser daemon.

This file starts at 0.5.0, the oldest release still on npm when it was written
(2026-09-09). What came before was never published as release notes, and
reconstructing it here would look like a record that had been kept all along.

The daemon and the SDK version independently. An SDK release names the daemon
version it was tested against wherever that matters.

## 1.0.0 (2026-09-27)

The library works as in 0.9.0. What changes is the promise: from this release
on, a breaking change to the client or its types arrives only as a new major
version, with the reason written in this file.

- The source is public at https://github.com/blackdiamond-labs/scalebrowser-node.
  npm builds every release from a tagged commit there and publishes it with a
  provenance attestation, so anyone can check which commit and which workflow
  run produced the package.
- The documentation comments you see in your editor no longer carry internal
  planning references, and the video preset types are documented in English.

## 0.9.0 (2026-09-20)

- `checkProxy` answers the exit's operator (`asn`), its timezone (`timezone`)
  and the kind of network it sits on (`exit_class`: `datacenter`,
  `residential`, `mobile` or `unknown`).
- `is_mobile` is derived from `exit_class` and has three states: `true`,
  `false`, and `null` for "could not be classified". Before, it was `false` on
  every answer, genuinely mobile exits included.
- A proxy row carries `last_timezone`, the zone a profile on
  `geo_mode: "follow_exit"` adopts at its next start.
- The exit-address view names the IPv6 `/64` in use as `current_v6` when the
  daemon measures IPv6; `current` holds the IPv4 address with its `v4:` prefix.

## 0.8.1 (2026-09-16)

The published `package.json` no longer lists a `smoke` script. It pointed at a
file outside the package, so it could not run from an installed copy, and
nothing called it. The library itself is unchanged.

## 0.8.0 (2026-09-11)

Breaking: `host_mode` is gone, and with it the `HostMode` type and the
`HOST_MODES` list. It named one of two tiers, and there is only one left: a
daemon runs the engine built for its own operating system, so the tier is the
host. The field disappears from `Profile`, from `CreateProfileBody` and from a
preset's `config`. A client that keeps sending it is not refused; the daemon
ignores the key.

## 0.7.0 (2026-09-09)

- `checkProxy` and the exit-address views report the address KIND (mobile, fixed
  line, datacenter, unknown) from an ASN dataset instead of the provider's own
  description. The ownership term for an exit address follows that kind, so a
  wrong classification used to be off by a factor of 30.
- A proxy row carries a name and lists the profiles bound to it.
- The exit-exclusivity rule has a switch, globally and per profile.

## 0.6.0 (2026-09-01)

- Remote access (the MCP tunnel) has a switch. It ships off, and it can only be
  turned on at the machine itself.

## 0.5.0 (2026-08-31)

- Every profile carries a memory (`PROFILE.md`) and a task list. Both are
  reachable through the client.
- `proxy_short_side` in both SDKs.
- The agent layer says "lease" throughout, matching the names of its tools.

## What this file does not promise

Nothing here promises a stable wire format. The daemon's REST surface is
versioned under `/v1` and this client tracks it. A breaking change there arrives
as a major version of the SDK, with the reason written in this file.
