# ============================================================
# Arkam database backup script (Windows / PowerShell)
# Backs up the Neon PostgreSQL database to a local folder.
#
# SETUP — run once before first use:
# -------------------------------------------------------
# 1. Install PostgreSQL client tools (includes pg_dump):
#    winget install PostgreSQL.PostgreSQL
#    (or download from https://www.postgresql.org/download/windows/)
#    After installing, add to PATH:
#    C:\Program Files\PostgreSQL\<version>\bin
#
# 2. (Optional) Install rclone for Google Drive upload:
#    winget install Rclone.Rclone
#    Then configure: rclone config
#    Name the remote "gdrive" and choose Google Drive.
#
# 3. Schedule this script daily:
#    Open Task Scheduler → Create Basic Task
#    Trigger: Daily at 2:00 AM
#    Action: Start a program
#      Program: powershell.exe
#      Arguments: -ExecutionPolicy Bypass -File "D:\Software\arkam\scripts\backup-arkam.ps1"
# ============================================================

$ErrorActionPreference = "Stop"

# ── Config ──────────────────────────────────────────────────
$AppDir       = "D:\Software\arkam"
$BackupDir    = "D:\Software\arkam-backups"
$EnvFile      = "$AppDir\.env.local"
$KeepDays     = 30
$RcloneRemote = "gdrive:arkam-backups"   # change if you named your rclone remote differently
# ────────────────────────────────────────────────────────────

$Date       = Get-Date -Format "yyyyMMdd-HHmm"
$BackupFile = "$BackupDir\arkam-$Date.sql"
$GzipFile   = "$BackupFile.gz"

Write-Host "===== Arkam backup started at $(Get-Date) ====="

# Read DATABASE_URL from .env.local
$DatabaseUrl = $null
if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
    if ($line) {
        $DatabaseUrl = $line -replace "^DATABASE_URL=", "" -replace '^"', '' -replace '"$', ''
    }
}

if (-not $DatabaseUrl) {
    Write-Error "ERROR: DATABASE_URL not found in $EnvFile"
    exit 1
}

# Create backup directory if needed
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

# Dump database
$PgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
Write-Host "Dumping database..."
& $PgDump $DatabaseUrl -f $BackupFile
if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    exit 1
}

# Compress with gzip (built into PowerShell 5+)
Write-Host "Compressing..."
$sourceStream      = [System.IO.File]::OpenRead($BackupFile)
$destStream        = [System.IO.File]::Create($GzipFile)
$gzipStream        = [System.IO.Compression.GZipStream]::new($destStream, [System.IO.Compression.CompressionMode]::Compress)
$sourceStream.CopyTo($gzipStream)
$gzipStream.Dispose()
$destStream.Dispose()
$sourceStream.Dispose()
Remove-Item $BackupFile  # remove uncompressed

$Size = (Get-Item $GzipFile).Length / 1KB
Write-Host ("Backup created: {0} ({1:F1} KB)" -f $GzipFile, $Size)

# Prune old backups
Write-Host "Pruning backups older than $KeepDays days..."
Get-ChildItem "$BackupDir\arkam-*.sql.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    Remove-Item

# Upload to Google Drive (requires rclone)
if (Get-Command rclone -ErrorAction SilentlyContinue) {
    Write-Host "Uploading to $RcloneRemote..."
    rclone copy $GzipFile $RcloneRemote
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Upload complete."
    } else {
        Write-Warning "rclone upload failed - backup is saved locally."
    }
} else {
    Write-Warning "rclone not found - skipping Google Drive upload. See setup instructions at top of this file."
}

Write-Host "===== Arkam backup finished at $(Get-Date) ====="
