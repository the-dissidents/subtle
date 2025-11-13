<#
.SYNOPSIS
    Builds the Tauri application for Windows.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Get-vcvars64Path {
    [CmdletBinding()]
    param()

    $candidatePaths = New-Object System.Collections.Generic.List[string]

    $vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vsWhere) {
        try {
            $installations = & $vsWhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath -format value 2>$null
            if ($LASTEXITCODE -eq 0 -and $installations) {
                foreach ($installation in $installations) {
                    if ($installation) {
                        $candidatePaths.Add((Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'))
                    }
                }
            }
        } catch {
            Write-Verbose "vswhere lookup failed: $_"
        }
    }

    $candidatePaths.AddRange([string[]]@(
        'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat',
        'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
    ))

    foreach ($candidate in $candidatePaths | Select-Object -Unique) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Error: Could not find Visual Studio installation. Please ensure Visual Studio 2019 or later (with C++ tools) is installed."
}

function Import-VsDevEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$vcvars64Path
    )

    $vsDir = Split-Path -Path $vcvars64Path -Parent
    Push-Location $vsDir
    try {
        & cmd.exe /c "call vcvars64.bat & set" | ForEach-Object {
            if ($_ -match '=') {
                $pair = $_.Split('=', 2)
                if ($pair.Length -eq 2) {
                    Set-Item -Force -Path ("ENV:{0}" -f $pair[0]) -Value $pair[1]
                }
            }
        }
    } finally {
        Pop-Location
    }

    Write-Host "`nVisual Studio developer environment variables set." -ForegroundColor Yellow
}

function Find-Msys2Installation {
    [CmdletBinding()]
    param()

    $registryPaths = @(
        'HKCU:\Software\msys2',
        'HKLM:\Software\msys2'
    )

    foreach ($registryPath in $registryPaths) {
        try {
            $installDir = (Get-ItemProperty -Path $registryPath -Name 'InstallDir' -ErrorAction Stop).InstallDir
            if ($installDir -and (Test-Path (Join-Path $installDir 'msys2.exe'))) {
                Write-Verbose "Found MSYS2 via registry path $registryPath"
                return $installDir
            }
        } catch {
            # ignore and continue searching
        }
    }

    $scoopDir = $env:SCOOP
    if (-not $scoopDir -and (Test-Path (Join-Path $env:USERPROFILE 'scoop'))) {
        $scoopDir = Join-Path $env:USERPROFILE 'scoop'
    }

    if ($scoopDir) {
        $scoopInstall = Join-Path $scoopDir 'apps\msys2\current'
        if (Test-Path (Join-Path $scoopInstall 'msys2.exe')) {
            Write-Verbose "Found MSYS2 via Scoop at $scoopInstall"
            return $scoopInstall
        }
    }

    Write-Verbose "MSYS2 installation not found."
    return $null
}

function Invoke-CheckedCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,

        [Parameter(Mandatory = $true)]
        [string]$ErrorMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $ErrorMessage
    }
}

try {
    $scriptDir = Split-Path -Path $PSCommandPath -Parent
    Push-Location $scriptDir

    & node --version 2>$null
    $nodeAvailable = $LASTEXITCODE -eq 0

    if (-not $nodeAvailable) {
        $fnmCommand = Get-Command fnm -ErrorAction SilentlyContinue
        if (-not $fnmCommand) {
            throw "Error: Node.js is not available in the current environment, and fnm was not found. Install Node.js or fnm (https://github.com/Schniz/fnm#installation)."
        }

        try {
            fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
        } catch {
            throw "Error: Failed to evaluate fnm environment. $_"
        }

        & node --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Error: Node.js still unavailable after initializing fnm environment."
        }
    }

    $msys2Path = Find-Msys2Installation
    if ($msys2Path) {
        $msysUsrBin = Join-Path $msys2Path 'usr\bin'
        if (Test-Path $msysUsrBin) {
            $env:PATH = "$msysUsrBin;$env:PATH"
            Write-Host "Added MSYS2 environment from $msysUsrBin to PATH." -ForegroundColor Green
        } else {
            Write-Warning "MSYS2 installation found but 'usr\bin' was not located at $msysUsrBin."
        }
    } else {
        throw "Error: MSYS2 installation not found. Please install MSYS2 via your favorite package manager."
    }

    $vcvars64 = Get-vcvars64Path
    Write-Host "Found Visual Studio at: $(Split-Path -Path $vcvars64 -Parent)" -ForegroundColor Green

    Import-VsDevEnvironment -vcvars64Path $vcvars64

    $cargoVersion = & cargo --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: Unable to execute cargo. Ensure Rust is installed correctly and restart your shell."
    }
    Write-Host "Detected $cargoVersion" -ForegroundColor Green

    & cargo tauri --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "cargo-tauri not found. Installing tauri-cli..." -ForegroundColor Yellow
        try {
            Invoke-CheckedCommand -Command { & cargo install tauri-cli --version '^2.0.0' --locked } -ErrorMessage "Error: Failed to install tauri-cli. Ensure the C++ Build Tools workload is installed in Visual Studio."
        } catch {
            throw $_
        }

        & cargo tauri --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Error: cargo-tauri still unavailable after installation. Confirm Visual C++ build tools are installed and accessible."
        }
    }

    $cargoTauriVersion = & cargo tauri --version 2>$null
    Write-Host "Using $cargoTauriVersion" -ForegroundColor Green

    $pnpmVersion = & pnpm --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: Unable to execute pnpm. Ensure pnpm is installed correctly and restart your shell."
    }
    Write-Host "Using pnpm $pnpmVersion" -ForegroundColor Green

    $nodeVersion = & node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: Unable to execute node. Ensure Node.js is installed correctly and restart your shell."
    }
    Write-Host "Using Node.js $nodeVersion" -ForegroundColor Green

    $tauriDir = Join-Path $scriptDir 'src-tauri'
    if (-not (Test-Path $tauriDir)) {
        throw "Error: Could not find `src-tauri` directory at $tauriDir"
    }

    Push-Location $tauriDir
    try {
        Write-Host "Building Tauri application for Windows..." -ForegroundColor Cyan
        Invoke-CheckedCommand -Command { & cargo tauri build --no-bundle } -ErrorMessage "Error: Tauri build failed."
    } finally {
        Pop-Location
    }

    Write-Host "Build completed successfully!" -ForegroundColor Green

    $repackScript = Join-Path $scriptDir 'windows-repack-test.ps1'
    if (Test-Path $repackScript) {
        Write-Host "Running repack script..." -ForegroundColor Cyan
        try {
            Invoke-CheckedCommand -Command { & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $repackScript } -ErrorMessage "Warning: Repack script failed."
        } catch {
            Write-Warning $_.Exception.Message
        }
    } else {
        Write-Warning "Repack script not found at $repackScript. Skipping."
    }

    if ($Host.Name -eq 'ConsoleHost') {
        Write-Host
        Read-Host "Press Enter to exit"
    }

    exit 0
} catch {
    Write-Error $_.Exception.Message
    Write-Error "Note: also try restarting in a fresh PowerShell session"
    if ($Host.Name -eq 'ConsoleHost') {
        Write-Host
        Read-Host "Press Enter to exit"
    }
    exit 1
}

