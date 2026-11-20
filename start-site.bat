@echo off
chcp 65001 >nul
title Mansur AI - server
set ROOT=%~dp0
set PHPRC=%ROOT%runtime\php
set PATH=C:\OSPanel\modules\PHP-8.4;C:\OSPanel\modules\PostgreSQL-17\bin;%PATH%

echo [1/3] Запуск базы данных PostgreSQL (порт 5433)...
pg_ctl -D "%ROOT%runtime\pgdata" status >nul 2>&1
if errorlevel 1 (
  start "" /b pg_ctl -D "%ROOT%runtime\pgdata" -o "-p 5433" -l "%ROOT%runtime\pg.log" start >nul
  timeout /t 3 >nul
)

echo [2/3] Подготовка базы...
cd /d "%ROOT%server"
php artisan migrate --force

echo [3/3] Сайт запущен: http://localhost:8000  (закройте это окно, чтобы остановить)
start "" http://localhost:8000
php artisan serve --host=127.0.0.1 --port=8000
