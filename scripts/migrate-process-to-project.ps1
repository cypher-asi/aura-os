# One-shot migration: link "Competitive Intel" process to "Competition" project.
# Reads the JWT from the local Aura store, then calls the REST API.
#
# Usage: .\scripts\migrate-process-to-project.ps1
#
# Requires the aura-os server to be running on localhost:3100.

$ErrorActionPreference = "Stop"
$base = "http://localhost:3100"

# --- Step 1: Get JWT from a settings dump endpoint or use provided token ---
if ($env:AURA_TOKEN) {
    $token = $env:AURA_TOKEN
} else {
    Write-Host "No AURA_TOKEN set. Attempting to read from server..." -ForegroundColor Yellow
    Write-Host "Please set AURA_TOKEN env var with a valid JWT." -ForegroundColor Red
    Write-Host ""
    Write-Host "You can get it from the browser:" -ForegroundColor Yellow
    Write-Host "  1. Open the Aura OS app in your browser"
    Write-Host "  2. Open DevTools (F12) -> Console"
    Write-Host '  3. Run: localStorage.getItem("zero_auth_session")'
    Write-Host "  4. Copy the access_token value"
    Write-Host '  5. Run: $env:AURA_TOKEN = "<paste token>"; .\scripts\migrate-process-to-project.ps1'
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

# --- Step 2: Find the Competition project ---
Write-Host "==> Fetching projects..."
try {
    $projects = Invoke-RestMethod -Uri "$base/api/projects" -Headers $headers
} catch {
    Write-Host "ERROR: Failed to fetch projects. Is the server running? Error: $_" -ForegroundColor Red
    exit 1
}

$competition = $projects | Where-Object { $_.name -eq "Competition" }
if (-not $competition) {
    Write-Host "ERROR: Project 'Competition' not found." -ForegroundColor Red
    Write-Host "Available projects:" -ForegroundColor Yellow
    $projects | ForEach-Object { Write-Host "  - $($_.name) ($($_.project_id))" }
    exit 1
}
$projectId = $competition.project_id
Write-Host "    Found project 'Competition' -> $projectId"

# --- Step 3: Find the Competitive Intel process ---
Write-Host "==> Fetching processes..."
$processes = Invoke-RestMethod -Uri "$base/api/processes" -Headers $headers

$target = $processes | Where-Object { $_.name -eq "Competitive Intel" }
if (-not $target) {
    Write-Host "ERROR: Process 'Competitive Intel' not found." -ForegroundColor Red
    Write-Host "Available processes:" -ForegroundColor Yellow
    $processes | ForEach-Object { Write-Host "  - $($_.name) ($($_.process_id)) [project: $($_.project_id)]" }
    exit 1
}
$processId = $target.process_id
Write-Host "    Found process 'Competitive Intel' -> $processId (current project: $($target.project_id))"

if ($target.project_id -eq $projectId) {
    Write-Host "==> Process is already linked to Competition. Nothing to do." -ForegroundColor Green
    exit 0
}

# --- Step 4: Link the process to the project ---
Write-Host "==> Linking process to project..."
$body = @{ project_id = $projectId } | ConvertTo-Json
$updated = Invoke-RestMethod -Uri "$base/api/processes/$processId" -Method Put -Headers $headers -Body $body

Write-Host "==> Done. Process '$($updated.name)' is now linked to project '$($competition.name)'." -ForegroundColor Green
Write-Host "    process_id: $($updated.process_id)"
Write-Host "    project_id: $($updated.project_id)"
