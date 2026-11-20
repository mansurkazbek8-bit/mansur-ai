@echo off
chcp 65001 >nul
set ROOT=%~dp0
set PATH=C:\OSPanel\modules\PostgreSQL-17\bin;%PATH%
echo Остановка базы данных...
pg_ctl -D "%ROOT%runtime\pgdata" stop -m fast
echo Готово.
timeout /t 2 >nul
