@echo off
REM Restart WorkBuddy with the CDP debug port (9222) so smart-switch-model scripts can drive the UI.
REM WARNING: this closes the current WorkBuddy session (including any active chat) and reopens it.
echo Stopping WorkBuddy...
taskkill /IM WorkBuddy.exe /F
timeout /t 3 /nobreak >nul
echo Starting WorkBuddy with --remote-debugging-port=9222 ...
start "" "C:\Program Files\WorkBuddy\WorkBuddy.exe" --remote-debugging-port=9222
echo Done. Verify with: curl -s http://localhost:9222/json/version
