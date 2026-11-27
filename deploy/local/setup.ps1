# Creates .env.docker with fresh random secrets (Windows PowerShell 5+ or pwsh).
# Run from deploy\local:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
if (Test-Path .env.docker) { Write-Host ".env.docker already exists; leaving it unchanged."; exit 0 }
function New-Secret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return [Convert]::ToBase64String($b)
}
function New-Password { return ((New-Secret 24) -replace '[^A-Za-z0-9]', '') }
$db = New-Password; $root = New-Password
$text = Get-Content .env.docker.example -Raw
$text = $text -replace 'MARIADB_PASSWORD=CHANGE_ME', "MARIADB_PASSWORD=$db"
$text = $text -replace 'MARIADB_ROOT_PASSWORD=CHANGE_ME', "MARIADB_ROOT_PASSWORD=$root"
$text = $text -replace 'portal:CHANGE_ME@', "portal:$db@"
$text = $text -replace 'SESSION_SECRET=.*', ("SESSION_SECRET=" + (New-Secret 48))
$text = $text -replace 'TOTP_ENCRYPTION_KEY=.*', ("TOTP_ENCRYPTION_KEY=" + (New-Secret 32))
$text = $text -replace 'SETTINGS_ENCRYPTION_KEY=.*', ("SETTINGS_ENCRYPTION_KEY=" + (New-Secret 32))
[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env.docker"), $text)
Write-Host "Created .env.docker with new secrets."
