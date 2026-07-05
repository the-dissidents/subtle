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

    & cmd.exe /c "call `"$vcvars64Path`" && set" | ForEach-Object {
        if ($_ -match '=') {
            $pair = $_.Split('=', 2)
            if ($pair.Length -eq 2) {
                Set-Item -Force -Path ("ENV:{0}" -f $pair[0]) -Value $pair[1]
            }
        }
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

function Ensure-Msys2Packages {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Msys2Path
    )

    $pacman = Join-Path $Msys2Path 'usr\bin\pacman.exe'
    if (-not (Test-Path $pacman)) {
        Write-Warning "pacman not found at $pacman; skipping MSYS2 package check."
        return
    }

    $required = [ordered]@{
        'make'       = 'make'
        'nasm'       = 'nasm'
        'diff'       = 'diffutils'
        'pkg-config' = 'pkgconf'
    }

    $missing = @()
    foreach ($tool in $required.Keys) {
        if (-not (Test-Path (Join-Path $Msys2Path "usr\bin\$tool.exe"))) {
            $missing += $required[$tool]
        }
    }

    if ($missing.Count -gt 0) {
        $pkgs = @($missing | Select-Object -Unique)
        Write-Host "Installing missing MSYS2 packages: $($pkgs -join ', ')" -ForegroundColor Yellow
        Invoke-CheckedCommand -Command { & $pacman -S --needed --noconfirm @pkgs } `
            -ErrorMessage "Error: Failed to install required MSYS2 packages ($($pkgs -join ', ')). Run '$pacman -Syu' once, then retry."
    } else {
        Write-Host "All required MSYS2 build tools are present." -ForegroundColor Green
    }
}

function Set-LibClangPath {
    [CmdletBinding()]
    param()

    if ($env:LIBCLANG_PATH -and (Test-Path (Join-Path $env:LIBCLANG_PATH 'libclang.dll'))) {
        Write-Host "libclang found via LIBCLANG_PATH: $env:LIBCLANG_PATH" -ForegroundColor Green
        return
    }


    $candidates = @(
        (Join-Path $env:ProgramFiles 'LLVM\bin'),
        (Join-Path ${env:ProgramFiles(x86)} 'LLVM\bin')
    )

    if ($env:VSINSTALLDIR) {
        $candidates += (Join-Path $env:VSINSTALLDIR 'VC\Tools\Llvm\x64\bin')
        $candidates += (Join-Path $env:VSINSTALLDIR 'VC\Tools\Llvm\bin')
    }

    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'libclang.dll'))) {
            $env:LIBCLANG_PATH = $c
            if (($env:PATH -split ';') -notcontains $c) {
                $env:PATH = "$env:PATH;$c"
            }
            Write-Host "Using libclang at: $c" -ForegroundColor Green
            return
        }
    }

    throw "Error: libclang.dll not found. ffmpeg-sys-next uses bindgen, which requires LLVM. Install it via 'winget install LLVM.LLVM' (or https://releases.llvm.org), then restart your shell."
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

    $fnmCommand = Get-Command fnm -ErrorAction SilentlyContinue
    if ($fnmCommand) {
        try {
            fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
            $nodeVersionFile = Join-Path $scriptDir '.node-version'
            if (Test-Path $nodeVersionFile) {
                $wantedNode = (Get-Content $nodeVersionFile -Raw).Trim()
                if ($wantedNode) {
                    Write-Host "Activating Node $wantedNode via fnm (from .node-version)..." -ForegroundColor Yellow
                    & fnm install $wantedNode *>$null
                    & fnm use $wantedNode *>$null
                }
            }
        } catch {
            Write-Warning "fnm environment setup failed: $_"
        }
    }

    & node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: Node.js is not available. Install the version in .node-version, or install fnm (https://github.com/Schniz/fnm#installation) to manage it automatically."
    }

    $msys2Path = Find-Msys2Installation
    if ($msys2Path) {
        $msysUsrBin = Join-Path $msys2Path 'usr\bin'
        if (Test-Path $msysUsrBin) {
            $env:PATH = "$msysUsrBin;$env:PATH"
            Write-Host "Added MSYS2 environment from $msysUsrBin to PATH." -ForegroundColor Green
            Ensure-Msys2Packages -Msys2Path $msys2Path
        } else {
            Write-Warning "MSYS2 installation found but 'usr\bin' was not located at $msysUsrBin."
        }
    } else {
        throw "Error: MSYS2 installation not found. Please install MSYS2 via your favorite package manager."
    }

    $vcvars64 = Get-vcvars64Path
    Write-Host "Found Visual Studio at: $(Split-Path -Path $vcvars64 -Parent)" -ForegroundColor Green

    Import-VsDevEnvironment -vcvars64Path $vcvars64

    Set-LibClangPath

    if (-not ($env:RC -and (Test-Path $env:RC))) {
        $rcCmd = Get-Command rc.exe -ErrorAction SilentlyContinue
        if ($rcCmd) {
            $env:RC = $rcCmd.Source
        } elseif ($env:WindowsSdkVerBinPath -and (Test-Path (Join-Path $env:WindowsSdkVerBinPath 'x64\rc.exe'))) {
            $env:RC = Join-Path $env:WindowsSdkVerBinPath 'x64\rc.exe'
        } elseif ($env:WindowsSdkDir) {
            $sdkRc = Get-ChildItem (Join-Path $env:WindowsSdkDir 'bin\*\x64\rc.exe') -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending | Select-Object -First 1
            if ($sdkRc) { $env:RC = $sdkRc.FullName }
        }
    }
    if ($env:RC) {
        Write-Host "Using resource compiler (rc.exe): $env:RC" -ForegroundColor Green
    } else {
        Write-Warning "rc.exe (Windows SDK Resource Compiler) not found. Install the 'Windows 10/11 SDK' component in Visual Studio; tauri-winres will fail without it."
    }

    $cargoVersion = & cargo --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: Unable to execute cargo. Install Rust via 'winget install Rustlang.Rustup' (or https://rustup.rs, MSVC host), run 'rustup default stable', then restart your shell."
    }
    Write-Host "Detected $cargoVersion" -ForegroundColor Green

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & pnpm --version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "pnpm not found. Attempting to enable it via corepack..." -ForegroundColor Yellow
        & corepack enable pnpm 2>$null | Out-Null
        & pnpm --version 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "corepack unavailable; installing pnpm via npm..." -ForegroundColor Yellow
            & npm install -g pnpm 2>$null | Out-Null
        }
    }
    $ErrorActionPreference = $prevEap
    $pnpmVersion = & pnpm --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Error: pnpm is unavailable and could not be enabled via corepack or npm. Install pnpm (https://pnpm.io/installation) and restart your shell."
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

    Write-Host "Installing frontend dependencies (pnpm install)..." -ForegroundColor Cyan
    Invoke-CheckedCommand -Command { & pnpm install --frozen-lockfile --ignore-scripts } -ErrorMessage "Error: 'pnpm install' failed."

    $env:npm_config_verify_deps_before_run = 'false'

    $env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'

    Write-Host "Building Tauri application for Windows..." -ForegroundColor Cyan
    Invoke-CheckedCommand -Command { & pnpm exec tauri build --no-bundle } -ErrorMessage "Error: Tauri build failed."

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

