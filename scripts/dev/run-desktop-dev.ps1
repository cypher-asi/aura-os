$ErrorActionPreference = "Stop"

$AuraRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($PWD.Path -ne $AuraRoot) {
    Set-Location $AuraRoot
}

if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
        }
    }
}

$frontendBindHost = if ($env:AURA_FRONTEND_HOST) { $env:AURA_FRONTEND_HOST } else { "127.0.0.1" }
$frontendPort = if ($env:AURA_FRONTEND_PORT) { $env:AURA_FRONTEND_PORT } else { "5173" }
$frontendConnectHost = if ($env:AURA_DESKTOP_FRONTEND_CONNECT_HOST) {
    $env:AURA_DESKTOP_FRONTEND_CONNECT_HOST
} else {
    $frontendBindHost
}
$desktopServerPort = $env:AURA_DESKTOP_SERVER_PORT
$desktopTargetDir = if ($env:AURA_DESKTOP_TARGET_DIR) {
    $env:AURA_DESKTOP_TARGET_DIR
} elseif ($env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR
} else {
    Join-Path $AuraRoot "target/desktop-dev"
}
if ($frontendConnectHost -eq "0.0.0.0") {
    $frontendConnectHost = "127.0.0.1"
}
$frontendUrl = "http://$frontendConnectHost`:$frontendPort"

Write-Host "Starting Aura desktop dev stack"
Write-Host "  Frontend bind: http://$frontendBindHost`:$frontendPort"
Write-Host "  Desktop dev URL: $frontendUrl"
Write-Host "  Cargo target dir: $desktopTargetDir"
if ($desktopServerPort) {
    Write-Host "  Desktop host port: $desktopServerPort"
} else {
    Write-Host "  Desktop host port: auto"
}
Write-Host ""
Write-Host "Waiting for Vite before launching the desktop shell..."
Write-Host "Stop with Ctrl-C."
Write-Host ""

function Test-FrontendReady {
    try {
        $response = Invoke-WebRequest -Uri "$frontendUrl/@vite/client" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    } catch {
        return $false
    }
}

$frontendProcess = $null
$desktopProcess = $null
$managesFrontend = $false

try {
    if (Test-FrontendReady) {
        Write-Host "Reusing existing Vite dev server at $frontendUrl"
    } else {
        $frontendProcess = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList @("/c", "npm", "run", "dev", "--", "--host", $frontendBindHost, "--port", $frontendPort, "--strictPort") `
            -WorkingDirectory (Join-Path $AuraRoot "interface") `
            -PassThru `
            -NoNewWindow
        $managesFrontend = $true

        while ($true) {
            $frontendProcess.Refresh()
            if ($frontendProcess.HasExited) {
                throw "Vite dev server exited with code $($frontendProcess.ExitCode)."
            }

            if (Test-FrontendReady) {
                break
            }

            Start-Sleep -Seconds 1
        }
    }

    [System.Environment]::SetEnvironmentVariable("AURA_DESKTOP_FRONTEND_DEV_URL", $frontendUrl, 'Process')
    [System.Environment]::SetEnvironmentVariable("CARGO_TARGET_DIR", $desktopTargetDir, 'Process')
    if ($desktopServerPort) {
        [System.Environment]::SetEnvironmentVariable("AURA_SERVER_PORT", $desktopServerPort, 'Process')
    } else {
        [System.Environment]::SetEnvironmentVariable("AURA_SERVER_PORT", "0", 'Process')
    }

    $desktopProcess = Start-Process `
        -FilePath "cargo" `
        -ArgumentList @("run", "-p", "aura-os-desktop") `
        -WorkingDirectory $AuraRoot `
        -PassThru `
        -NoNewWindow

    while ($true) {
        if ($managesFrontend) {
            $frontendProcess.Refresh()
            if ($frontendProcess.HasExited) {
                exit $frontendProcess.ExitCode
            }
        }

        $desktopProcess.Refresh()
        if ($desktopProcess.HasExited) {
            exit $desktopProcess.ExitCode
        }

        Start-Sleep -Seconds 1
    }
} finally {
    if ($desktopProcess -and -not $desktopProcess.HasExited) {
        taskkill /PID $desktopProcess.Id /T /F | Out-Null
    }
    if ($managesFrontend -and $frontendProcess -and -not $frontendProcess.HasExited) {
        taskkill /PID $frontendProcess.Id /T /F | Out-Null
    }
}
