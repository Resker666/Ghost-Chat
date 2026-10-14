# Changelog

## Unreleased

Initial experimental MVP. No public release or production deployment is implied.

### Added

- Two-person, online-only text chat with no accounts or stored history.
- Browser Web Crypto HKDF-SHA-256 and directional AES-256-GCM encryption.
- Independent, single-use transport tokens and fragment-based invitations.
- In-memory Go WebSocket relay, room expiry, destruction and disconnect cleanup.
- Strict protocol validation, replay protection, resource limits and security headers.
- Responsive React client, automated tests, Linux CI and self-hosting examples.
- MIT license, threat model, privacy boundaries and archived project planning.

### Verified

On 2026-10-14: 78 unit tests, 14 real Chrome end-to-end tests, Go tests/race/vet,
module verification, formatting checks, npm audits and Go vulnerability scanning
passed. See [PROGRESS.md](docs/PROGRESS.md) for actual commands and coverage.

### Remaining Validation

- Docker/Compose, Nginx, production HTTPS/WSS and remote CI have not run.
- The Windows symlink test was skipped because the environment lacks permission.
- A dedicated private vulnerability reporting channel remains to be configured.
- No independent security audit, forward secrecy, anonymity or physical erasure
  guarantee is provided.
