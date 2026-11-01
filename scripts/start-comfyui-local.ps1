$ErrorActionPreference = "Stop"

$comfyRoot = "C:\iTis\ComfyUI"
$python = Join-Path $comfyRoot ".venv\Scripts\python.exe"
$stdout = Join-Path $comfyRoot "comfyui.stdout.log"
$stderr = Join-Path $comfyRoot "comfyui.stderr.log"

if (-not (Test-Path -LiteralPath $python)) {
  throw "Không tìm thấy ComfyUI tại $comfyRoot"
}

$listening = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Output "ComfyUI đã chạy tại http://127.0.0.1:8188"
  exit 0
}

$process = Start-Process -FilePath $python `
  -ArgumentList @("main.py", "--cpu", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch") `
  -WorkingDirectory $comfyRoot `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden `
  -PassThru

Write-Output "Đã khởi động ComfyUI (PID $($process.Id))."
