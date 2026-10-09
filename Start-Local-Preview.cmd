@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\dist\cli.js" (
  echo Dependencies are missing. Run npm ci in this directory first.
  pause
  exit /b 1
)

node --input-type=module -e "try { const r=await fetch('http://localhost:4175/api/health',{signal:AbortSignal.timeout(3000)}); const j=await r.json(); process.exit(r.ok && j.checks?.questionBank ? 0 : 1); } catch { process.exit(1); }"
if not errorlevel 1 (
  echo StatInterview is already running at http://localhost:4175/
  exit /b 0
)

call npm run db:local
if errorlevel 1 (
  echo Local database setup failed. Review the error above.
  pause
  exit /b 1
)

echo Open http://localhost:4175/ in your browser.
echo Keep this window open while using StatInterview. Press Ctrl+C to stop.
node scripts\run-vinext.mjs dev --port 4175 --host localhost --strictPort
if errorlevel 1 pause
