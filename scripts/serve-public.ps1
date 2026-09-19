# WeCover public demo stack - one-shot startup (recovery after PC reboot)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\serve-public.ps1
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force artifacts | Out-Null

Write-Host "[1/4] Supabase local stack..."
npx supabase start 2>&1 | Tee-Object artifacts\supabase-start.log | Select-Object -Last 3

Write-Host "[2/4] API (:8787)..."
Start-Process -FilePath "npx.cmd" -ArgumentList "tsx","server/index.ts" -WindowStyle Hidden -RedirectStandardOutput artifacts\api.log -RedirectStandardError artifacts\api.err.log

Write-Host "[3/4] Build + preview (:5199)..."
pnpm build | Select-Object -Last 3
Start-Process -FilePath "pnpm.cmd" -ArgumentList "preview","--host","127.0.0.1","--port","5199","--strictPort" -WindowStyle Hidden -RedirectStandardOutput artifacts\preview.log -RedirectStandardError artifacts\preview.err.log

Write-Host "[4/4] Cloudflare tunnel..."
Start-Process -FilePath "C:\Program Files (x86)\cloudflared\cloudflared.exe" -ArgumentList "tunnel","--url","http://localhost:5199","--logfile","D:\missedlead-os\artifacts\tunnel.log" -WindowStyle Hidden

Start-Sleep 12
$url = Select-String -Path artifacts\tunnel.log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1
Write-Host ""
Write-Host "PUBLIC URL: $url"
Write-Host "(If the URL changed, check artifacts\tunnel.log)"
