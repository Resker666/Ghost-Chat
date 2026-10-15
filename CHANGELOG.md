# Changelog

## Unreleased

Initial experimental MVP. No stable release or audited production-security
guarantee is implied; experimental service deployment is recorded separately.

### Added

- Two-person, online-only text chat with no accounts or stored history.
- Browser Web Crypto HKDF-SHA-256 and directional AES-256-GCM encryption.
- Independent, single-use transport tokens and fragment-based invitations.
- In-memory Go WebSocket relay, room expiry, destruction and disconnect cleanup.
- Strict protocol validation, replay protection, resource limits and security headers.
- Responsive React client, automated tests, Linux CI and self-hosting examples.
- MIT license, threat model, privacy boundaries and archived project planning.
- Privacy-conscious bug/feature forms, device evidence matrix, maintenance notes
  and an experimental release checklist.
- Explicit external-origin E2E mode, isolated test-CA container/TLS runner and
  five browser/emulated-device projects.
- Explicit local canvas invitation QR display and lifecycle cleanup using
  locally bundled qrcode, with independent jsQR pixel-decoding regression tests.
- Controlled container verification reporting with required conversation/restart
  pass checks, strict CLI/schema limits and separated infrastructure diagnostics.
- A native CGO-disabled Linux runtime deployment using systemd and Nginx, with
  a manifest-verified allowlisted package and bundled runtime license notices.

### Fixed

- Safety-dialog focus cycling/restoration and visibility in short windows.
- Composer visibility in short mobile and simulated-keyboard viewports.
- Accidental send on synthetic IME-confirmation Enter with keyCode 229.
- Early WebKit same-document fragment cleanup by registering stateless cleanup
  during bootstrap before React effects.
- Obsolete manual-copy error after a session ends.
- Automatic Playwright page snapshots and sensitive assertion/navigation output
  in failure paths, checked using controlled negative probes.

### Verified

On 2026-10-14: 78 unit tests, 14 real Chrome end-to-end tests, Go tests/race/vet,
module verification, formatting checks, npm audits and Go vulnerability scanning
passed. See [PROGRESS.md](docs/PROGRESS.md) for actual commands and coverage.

On 2026-10-15, GitHub Actions run
[38558565586](https://github.com/Resker666/Ghost-Chat/actions/runs/38558565586)
was confirmed successful for commit `5a63896`: web, Go, E2E and container-build
jobs passed. The container job built the image, validated Compose configuration
and checked health/static responses from a read-only non-root container.

Also on 2026-10-15, before local QR was added, the uncommitted working tree
based on `5a63896` passed
82 unit tests across 3 files, web lint/type/build/format checks, E2E typecheck
and the five-project source matrix: 115 passed in 5.7 minutes and 5 expected
skips, one isolated-container restart case per project. Tested engines were
Chrome 155.0.8059.41, Firefox 157 and Playwright WebKit 27.2, plus Pixel 5 and
iPhone 13 emulation. These results do not apply the historical CI success to
the new working-tree changes. Full details and earlier failures are recorded
in PROGRESS.md.

A selected basic-chat case against the already running loopback origin passed
in external mode (1 test, 2.3 seconds), without starting the native test server
or restarting the target. This was HTTP loopback, not deployment/TLS acceptance.

After QR was added, five projects each passed four QR cases and one basic-chat
case: 25 passed in 47.8 seconds. Final web unit results were 86 tests across
4 files; final web lint/format checks passed, and web and E2E npm audits reported
zero vulnerabilities. These were
targeted working-tree tests, separate from the pre-QR full matrix; overlapping
basic-chat cases are not added together as a new full-matrix result.

After diagnostic-privacy changes, a separate five-project targeted run passed
25 tests in 42.8 seconds, covering basic chat, clipboard-failure behavior/cleanup,
QR decoding and native process restart. It overlaps the earlier runs and is not
added to their totals. Real Playwright controlled-failure probes reached a visible
random marker before intentionally exiting 1, then verified no marker, automatic
page snapshot or media in stdout/stderr/results. Fixed error-context files remain
allowed. Reporter integration, 11 invalid CLI cases, 3 help cases, synthetic event
and malformed-summary/oversize-output checks passed as infrastructure validation,
not as a real TLS-container run.

The native Ubuntu/systemd/Nginx service at
[chat.resker666.cloud](https://chat.resker666.cloud) subsequently passed 15 selected
tests in 1.9 minutes: chat, production headers and QR decoding across five
browser/emulated-device projects, with normal certificate verification and real
WSS. HTTP redirects, the ACME exception, HTTPS health and the least-privilege
runtime were checked separately. The archive contained 17 total files including
its manifest and Vite license, and its remote hashes were verified.

On 2026-10-15, the user reported real Android and iPhone core-flow PASS for
computer/phone invitation transfer by scan or copy, joining, chatting and
destruction. This is user feedback, not independently observed automation;
device/OS/browser versions and network type were not supplied, and the scan
versus copy branch was not specified.

### Remaining Validation

- Physical-phone core flows have user-reported PASS, while camera scanning, specific browser
  versions, background/lock, network switching, IME and orientation cases remain
  unconfirmed; native HTTPS automation does not cover those modes.
- Direct-network certificate renewal dry-run failed with a staging ACME read
  timeout. The production certificate is valid, but long-term renewal egress
  remains unresolved; an active timer is not evidence of successful renewal.
  A temporary allowlisted tunnel validated simulated renewal and the reload
  hook, then was fully closed. Direct no-proxy renewal still timed out; an
  isolated official dehydrated client test also timed out and was removed.
- The Windows symlink test was skipped locally; Linux CI results are recorded
  separately in PROGRESS.md.
- The dedicated private vulnerability reporting feature remains disabled;
  SECURITY.md tracks the verified status.
- No independent security audit, forward secrecy, anonymity or physical erasure
  guarantee is provided.

### Final Code CI

Commit `fa3e721` passed all 8 jobs in
[Verify run 38706441313](https://github.com/Resker666/Ghost-Chat/actions/runs/38706441313):
Go, web, five source E2E projects and container-build. The Linux production image
and Nginx passed the full verified test-CA HTTPS/WSS step, including chain and
hostname validation, certificate rejection checks, an actual encrypted conversation
and isolated container restart enforced by the runner. Two earlier container
failures remain documented in PROGRESS.md.

This code validation does not make production ACME renewal reliable, expand
physical-phone feedback or enable private vulnerability reporting.
