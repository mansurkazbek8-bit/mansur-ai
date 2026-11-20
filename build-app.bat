@echo off
chcp 65001 >nul
set ROOT=%~dp0
rem Design engine is shared with the website
copy /y "%ROOT%server\public\js\theme.js" "%ROOT%desktop\renderer\theme.js" >nul
copy /y "%ROOT%server\public\css\theme.css" "%ROOT%desktop\renderer\theme.css" >nul
rem Agent characters (pictures and 3D models) are shared with the website
xcopy /y /q "%ROOT%server\public\img\agents\*" "%ROOT%desktop\renderer\img\agents\" >nul
copy /y "%ROOT%server\public\js\agents3d.js" "%ROOT%desktop\renderer\js\agents3d.js" >nul
xcopy /y /q "%ROOT%server\public\vendor\three\*" "%ROOT%desktop\renderer\vendor\three\" >nul
cd /d "%ROOT%desktop"
rem Optional: build-app.bat https://mansur.kz  — the app will connect to this site by default
if not "%~1"=="" (
  node -e "const f='package.json',p=require('./'+f);p.mansurServer=process.argv[1].replace(/\/+$/,'');require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')" "%~1"
  echo Адрес сервера в приложении: %~1
)
echo Сборка установщика Windows-приложения...
call npm install
call npm run dist
if not exist "%ROOT%server\public\downloads" mkdir "%ROOT%server\public\downloads"
copy /y "%ROOT%desktop\dist\MansurAI-Setup.exe" "%ROOT%server\public\downloads\MansurAI-Setup.exe"
echo Готово: установщик доступен на сайте по кнопке "Скачать для Windows".
pause
