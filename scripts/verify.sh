#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd web && npm ci && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm audit --audit-level=high)
(cd server && go test ./... && go vet ./... && go mod verify && go test -race ./...)
(cd e2e && npm ci && npx playwright install chromium && npm test && npm audit --audit-level=high)
