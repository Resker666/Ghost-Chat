# ADR 0006: Local invitation QR display

Date: 2026-10-15
Status: Accepted for implementation.

## Context

The selected mobile workflow includes transferring an invitation from a computer
to a phone. The full invitation contains both the E2EE secret and a one-use token,
so a remote QR service would expose the session's credentials.

## Decision

- Encode with the locally bundled MIT-licensed qrcode library. Load it only after
  the participant explicitly opens the QR tool. Do not implement a QR encoder or
  send the invitation to a server, analytics service or external asset endpoint.
- Draw directly to a fixed-size canvas with a standard quiet zone and adequate
  contrast. Do not create persistent data URLs, downloads or saved QR images.
- Keep the QR hidden by default. Hide and clear it on user dismissal, peer ready,
  termination, expiry and navigation. Clear the canvas buffer on unmount and guard
  asynchronous rendering so a retired view cannot retain a late-rendered QR.
- Display that the QR contains an invitation secret. A loopback-origin invitation
  still cannot reach a different physical device; real phone use requires the
  separately validated reachable HTTPS deployment.
- Keep the existing one-use admission, disconnect and key-lifecycle protocol.

## Verification

Use the independent jsQR decoder only in E2E tooling to decode actual canvas
pixels and compare the complete invitation in memory. Never print decoded values
or include visible QR codes in test screenshots. Verify same-origin-only network
requests, explicit display, buffer clearing and admission/destruction behavior.
Physical-camera scanning remains a separate real-device acceptance item.
