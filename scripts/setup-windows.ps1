#Requires -RunAsAdministrator
<#
  qa-agent machine setup — run once in PowerShell as Administrator:
    Set-ExecutionPolicy -Scope Process Bypass
    .\scripts\setup-windows.ps1
#>
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- 1. Node.js 20+ ---
Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $major = [int](node -v).TrimStart('v').Split('.')[0]
  if ($major -ge 20) { Write-Host "  [OK] Node $(node -v)" }
  else { winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements; Write-Host "  [OK] Node upgraded — REOPEN PowerShell after script finishes" }
} else {
  winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
  Write-Host "  [OK] Node installed — REOPEN PowerShell after script finishes"
}

# --- 2. Ollama ---
Step "Checking Ollama"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
  winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements
  Write-Host "  [OK] Ollama installed"
} else { Write-Host "  [OK] Ollama present" }

# Start Ollama service
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

# --- 3. Models (qwen2.5 ~4.7GB, nomic-embed ~270MB) ---
Step "Pulling local models (first run downloads a few GB)"
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
Write-Host "  [OK] Models ready"

# --- 4. VS Code extensions ---
Step "Installing VS Code extensions"
$exts = @(
  "ms-playwright.playwright",     # Playwright test runner + codegen
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "ms-vscode.powershell",
  "github.copilot"                # optional — remove if not wanted
)
foreach ($e in $exts) { code --install-extension $e --force | Out-Null }
Write-Host "  [OK] Extensions installed"

# --- 5. Project deps + Playwright browser + verify ---
Step "Installing project dependencies"
npm install

Step "Installing Playwright Chromium (about 150 MB, used by qa-agent run)"
npx playwright install chromium

npm run doctor

Write-Host "`nDone. If doctor shows all [OK], run: npm run qa-agent -- new my-first-project" -ForegroundColor Green
