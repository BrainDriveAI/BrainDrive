@echo off
echo 🔧 Auto-Building BrainDrive Plugins...

:: Get absolute path to the root directory
setlocal enabledelayedexpansion
set ROOT=%~dp0
cd /d %ROOT%

:: Loop through each subdirectory inside plugins
for /D %%D in ("%ROOT%plugins\*") do (
    if exist "%%D\package.json" (
        echo 📁 Building plugin: %%~nxD
        pushd "%%D"
        call npm install
        call npm run build
        popd
    ) else (
        echo ⚠️ Skipping %%~nxD (no package.json found)
    )
)

echo ✅ All detectable plugins have been built.
pause

