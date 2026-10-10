@echo off
setlocal
cd /d "%~dp0"
call npm ci
if errorlevel 1 exit /b 1
call npm run verify
if errorlevel 1 exit /b 1
call npm test
if errorlevel 1 exit /b 1
cargo check --locked --manifest-path src-tauri\Cargo.toml
if errorlevel 1 exit /b 1
cargo test --locked --manifest-path src-tauri\Cargo.toml --lib
if errorlevel 1 exit /b 1
call npx playwright install chromium
if errorlevel 1 exit /b 1
call npm run test:ui
if errorlevel 1 exit /b 1
echo All automated checks passed. Complete the Windows desktop checklist in UPDATE-0.8.0.md.
