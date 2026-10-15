# ADR 0005: External deployment tests and mobile browser behavior

Date: 2026-10-15
Status: Accepted for implementation; environment-specific acceptance remains pending.

## Context

The initial Linux CI passes source E2E and production-container smoke checks, but
does not exercise a complete conversation through a TLS reverse proxy. Chrome
viewport checks also do not establish Firefox, WebKit or physical-phone support.
New Chromium regressions reproduce an inaccessible dialog action, a composer
outside a 390x320 viewport, and accidental sending on a synthetic IME-confirmation
Enter event with keyCode 229 after compositionend.

## Decisions

- Keep local source E2E as the default. Allow an explicit HTTP loopback or HTTPS
  external origin without credentials, query, fragment or application subpath.
  External tests create disposable test rooms and never restart an unknown service.
- Full short-TTL assertions require an explicitly configured dedicated test instance.
  Container restart tests are restricted to the isolated Compose project created by
  the test runner. Keep all test traces and automatic failure screenshots disabled.
- Exercise Chromium, Firefox and WebKit separately. Pixel/iPhone configurations are
  browser emulation, not evidence from Android/iOS hardware.
- Test TLS with a temporary CA and certificate inside the isolated test environment.
  Validate chain and hostname; do not disable certificate checking or alter global
  trust. This does not establish public-certificate or physical-device acceptance.
- Cycle focus among the safety dialog's controls and restore the actual opener.
  Adapt layout to the visible viewport with a dynamic-viewport fallback, without
  changing zoom behavior or imposing a mobile minimum height above that viewport.
- Preserve Enter-to-send and Shift+Enter. Treat composing events and IME keyCode 229
  as candidate confirmation rather than send commands.
- Preserve single-use tokens, in-memory keys, no history and disconnect termination.
  Do not add automatic reconnect or end a healthy session merely because it is hidden.
- Register stateless hashchange cleanup during module bootstrap, before React
  effects. A WebKit regression confirmed that an early same-document fragment can
  otherwise outlive the event that should remove it. Parse the initial invitation
  before removing its secret; the listener must never retain invitation material.

## Validation

Run the original protocol and lifecycle suite plus focus, small-height, composition,
clipboard-failure and history-navigation regressions across available engines.
Record source/container/TLS mode, engine and emulated versus real device explicitly.
Production-host, public HTTPS and phone acceptance require the user's named target
and actual observations; prepared configuration is not a passing test result.
