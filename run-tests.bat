@echo off
chcp 65001 >nul
title Mansur AI - автотесты
rem Запуск всех автотестов PHPUnit (61 тест). Нужна база PostgreSQL на порту 5433 (её запускает и start-site.bat).
set ROOT=%~dp0
set PHPRC=%ROOT%runtime\php
set PATH=C:\OSPanel\modules\PHP-8.4;C:\OSPanel\modules\PostgreSQL-17\bin;%PATH%

pg_ctl -D "%ROOT%runtime\pgdata" status >nul 2>&1
if errorlevel 1 (
  echo Запуск базы данных PostgreSQL...
  start "" /b pg_ctl -D "%ROOT%runtime\pgdata" -o "-p 5433" -l "%ROOT%runtime\pg.log" start >nul
  timeout /t 4 >nul
)

cd /d "%ROOT%server"
php vendor\bin\phpunit --testdox
echo.
pause
