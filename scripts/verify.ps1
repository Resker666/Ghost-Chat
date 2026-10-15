param([switch]$SkipRace, [switch]$SkipE2E)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$localTools = Join-Path (Split-Path $projectRoot -Parent) '.tools'
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    $localGo = Join-Path $localTools 'go/bin'
    if (-not (Test-Path (Join-Path $localGo 'go.exe'))) { throw 'Install Go 1.27.2 or newer first.' }
    $env:PATH = "$localGo;$env:PATH"
}
if (-not $env:GOCACHE) { $env:GOCACHE = Join-Path $projectRoot '.tools/go-build' }
if (-not $env:GOMODCACHE) { $env:GOMODCACHE = Join-Path $projectRoot '.tools/go-mod' }
if (-not $env:GOPATH) { $env:GOPATH = Join-Path $projectRoot '.tools/go-work' }
if (-not $env:npm_config_cache) { $env:npm_config_cache = Join-Path $projectRoot '.tools/npm-cache' }
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Verification failed (exit $LASTEXITCODE)." } }
Push-Location (Join-Path $projectRoot 'web')
try {
    npm ci; Check-Exit
    npm run lint; Check-Exit
    npm run format:check; Check-Exit
    npm run typecheck; Check-Exit
    npm test; Check-Exit
    npm run build; Check-Exit
    npm audit --audit-level=high; Check-Exit
} finally { Pop-Location }
Push-Location (Join-Path $projectRoot 'server')
try {
    go test ./...; Check-Exit
    go vet ./...; Check-Exit
    go mod verify; Check-Exit
    if (-not $SkipRace) { go test -race ./...; Check-Exit }
} finally { Pop-Location }
if (-not $SkipE2E) {
    Push-Location (Join-Path $projectRoot 'e2e')
    try {
        npm ci; Check-Exit
        npm run typecheck; Check-Exit
        if (-not $env:CHROME_PATH) {
            $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.tools/browsers'
            npx playwright install chromium; Check-Exit
        }
        npm test; Check-Exit
        npm audit --audit-level=high; Check-Exit
    } finally { Pop-Location }
}
Write-Output 'Verification passed for all selected checks.'
