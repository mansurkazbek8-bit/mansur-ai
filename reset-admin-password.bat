@echo off
chcp 65001 >nul
title Mansur AI - новый пароль администратора
rem Задать новый пароль администратору, если старый забыт. Пароль вводится скрыто.
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
php artisan mansur:admin-password
echo.
pause
