# qa-agent machine setup — run once, in PowerShell as Administrator:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# --- 1. Node.js 20+ ---
Write-Step "Checking Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $major = [int](node -v).TrimStart("v").Split(".")[0]
    if ($major -ge 20) {
        Write-Host "  [OK] Node $(node -v)"
    } else {
        winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
        Write-Host "  [OK] Node upgraded - REOPEN PowerShell, then rerun this script"
        exit 0
    }
} else {
    winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
    Write-Host "  [OK] Node installed - REOPEN PowerShell, then rerun this script"
    exit 0
}

# --- 2. Ollama ---
Write-Step "Checking Ollama"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements
    Write-Host "  [OK] Ollama installed"
} else {
    Write-Host "  [OK] Ollama present"
}

# Start Ollama in the background (no-op if already running)
Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6

# --- 3. Models (qwen2.5 ~4.7GB, nomic-embed ~270MB) ---
Write-Step "Pulling local models (first run downloads a few GB)"
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
Write-Host "  [OK] Models ready"

# --- 4. VS Code extensions ---
Write-Step "Installing VS Code extensions"
$exts = @(
    "ms-playwright.playwright",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.powershell"
)
foreach ($e in $exts) { code --install-extension $e --force | Out-Null }
Write-Host "  [OK] Extensions installed"

# --- 5. Project deps + verify ---
Write-Step "Installing project dependencies"
npm install
npm run doctor

Write-Host ""
Write-Host "Done. If doctor shows all [OK], run: npm run qa-agent -- new my-first-project" -ForegroundColor Green
