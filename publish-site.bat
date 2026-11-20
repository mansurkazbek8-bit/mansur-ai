@echo off
chcp 65001 >nul
title Mansur AI - в интернете
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\publish.ps1"
