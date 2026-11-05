@echo off
cd /d %~dp0
echo Starting the office print server...
echo Open the address it prints from any PC or phone on the same network.
echo Press Ctrl+C to stop.
python server.py
if errorlevel 1 (
  echo.
  echo The server stopped with an error. If it says python was not found,
  echo install Python 3.9 or newer and tick Add python.exe to PATH.
)
pause
