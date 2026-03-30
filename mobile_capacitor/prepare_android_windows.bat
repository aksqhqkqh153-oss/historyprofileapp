@echo off
cd /d %~dp0
call npm install
call npm run init:android
call npm run sync:android
call npm run open:android
