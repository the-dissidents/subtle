@echo off
:: check-in-env.bat
:: Adjust the path to vcvars64.bat if needed
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" > nul

:: Execute cargo with all arguments passed to this script
cargo %*