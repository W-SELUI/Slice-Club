@echo off
cd /d "%~dp0"
start "Slice Club" "http://localhost:4173/"
node server.mjs
