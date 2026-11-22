# Register machterm:// URL scheme on Windows (HKCU).
# Must point at a native Windows mach-terminal.exe — NOT a WSL path.
#
# Usage:
#   .\register-scheme.ps1 -Show
#   .\register-scheme.ps1 -ExePath "C:\path\to\mach-terminal.exe"

param(
    [string]$ExePath = "",
    [switch]$Show
)

$scheme = "machterm"
$commandKey = "HKCU:\Software\Classes\$scheme\shell\open\command"

function Get-RegisteredCommand {
    if (-not (Test-Path $commandKey)) { return $null }
    return (Get-ItemProperty -Path $commandKey -Name "(Default)" -ErrorAction SilentlyContinue)."(Default)"
}

function Test-WslLookingPath([string]$path) {
    return $path -match '(?i)(\\\\wsl\$|\\\\wsl\.localhost\\|wsl\.exe|/home/|/mnt/|/usr/)'
}

if ($Show) {
    $current = Get-RegisteredCommand
    if ($current) {
        Write-Host "Current machterm:// handler:"
        Write-Host "  $current"
        if (Test-WslLookingPath $current) {
            Write-Host "WARNING: handler looks like WSL. Sibling Mach apps on Windows will launch the wrong Terminal." -ForegroundColor Yellow
        }
    } else {
        Write-Host "No machterm:// handler registered in HKCU."
    }
    exit 0
}

if (-not $ExePath) {
    Write-Error "ExePath is required (or use -Show)."
    exit 1
}

if (-not (Test-Path -LiteralPath $ExePath)) {
    Write-Error "ExePath does not exist: $ExePath"
    exit 1
}

$resolvedExePath = (Resolve-Path -LiteralPath $ExePath).ProviderPath

if (Test-WslLookingPath $resolvedExePath) {
    Write-Error @"
ExePath looks like a WSL path ($resolvedExePath).
Sibling Mach apps running on Windows will ShellExecute machterm:// into that handler and open WSL Terminal.
Build/run a Windows mach-terminal.exe and pass that path instead.
"@
    exit 1
}

$command = "`"$resolvedExePath`" `"%1`""

New-Item -Path "HKCU:\Software\Classes\$scheme" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$scheme" -Name "(Default)" -Value "URL:Mach Terminal Protocol"
Set-ItemProperty -Path "HKCU:\Software\Classes\$scheme" -Name "URL Protocol" -Value ""

New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value $command

Write-Host "Registered ${scheme}:// -> $resolvedExePath"
Write-Host "Test: start `"machterm://composer?text=echo%20hello`""
Write-Host "Verify: .\config\register-scheme.ps1 -Show"
