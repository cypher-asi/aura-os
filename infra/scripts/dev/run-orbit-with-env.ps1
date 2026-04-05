# Run Orbit with TRUSTED_JWT_* set from Aura's ZERO_JWT_* in .env.
# Usage: from aura-app root, .\scripts\run-orbit-with-env.ps1
# Requires: Orbit repo at ..\orbit (or set $env:ORBIT_DIR); ZERO_JWT_ISSUER and ZERO_JWT_JWKS_URL in .env.

$AuraRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($PWD.Path -ne $AuraRoot) { Set-Location $AuraRoot }
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
        }
    }
}
$env:TRUSTED_JWT_ISSUER = if ($env:ZERO_JWT_ISSUER) { $env:ZERO_JWT_ISSUER } else { $env:TRUSTED_JWT_ISSUER }
$env:TRUSTED_JWT_JWKS_URL = if ($env:ZERO_JWT_JWKS_URL) { $env:ZERO_JWT_JWKS_URL } else { $env:TRUSTED_JWT_JWKS_URL }
$OrbitDir = if ($env:ORBIT_DIR) { $env:ORBIT_DIR } else { Join-Path (Split-Path -Parent $AuraRoot) 'orbit' }
if (-not (Test-Path $OrbitDir)) {
    Write-Error "Orbit repo not found at $OrbitDir. Set env ORBIT_DIR to the orbit repo path."
    exit 1
}
Set-Location $OrbitDir
cargo run
