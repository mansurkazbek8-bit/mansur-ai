# Mansur AI — publish the site from this PC through a free Cloudflare tunnel.
# The site gets an https://….trycloudflare.com address and works while this window is open.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root 'runtime'
$Server = Join-Path $Root 'server'
$Php = 'C:\OSPanel\modules\PHP-8.4\php.exe'
$PgBin = 'C:\OSPanel\modules\PostgreSQL-17\bin'
$Env = Join-Path $Server '.env'
$env:PHPRC = Join-Path $Runtime 'php'
$Workers = 8001..8004
$ProxyPort = 8080
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Set-EnvValue($key, $value) {
    $text = [IO.File]::ReadAllText($Env)
    if ($text -match "(?m)^$key=.*$") { $text = [regex]::Replace($text, "(?m)^$key=.*$", "$key=$value") }
    else { $text = $text.TrimEnd() + "`r`n$key=$value`r`n" }
    [IO.File]::WriteAllText($Env, $text, (New-Object Text.UTF8Encoding $false))
}

Write-Host ''
Write-Host '  Mansur AI — публикация в интернет' -ForegroundColor Cyan
Write-Host ''

# 1. Tunnel program (official Cloudflare build, downloaded once)
$Cf = Join-Path $Runtime 'cloudflared.exe'
if (-not (Test-Path $Cf)) {
    Write-Host '[1/6] Скачиваю cloudflared (один раз)...'
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $Cf -UseBasicParsing
} else { Write-Host '[1/6] cloudflared уже есть' }

# 2. Database
Write-Host '[2/6] База данных PostgreSQL...'
& "$PgBin\pg_ctl.exe" -D "$Runtime\pgdata" status *> $null
if ($LASTEXITCODE -ne 0) {
    # Started outside this console (WMI), so closing this window or Ctrl+C cannot stop the database.
    $pgCmd = "`"$PgBin\pg_ctl.exe`" -D `"$Runtime\pgdata`" -o `"-p 5433`" -l `"$Runtime\pg.log`" start"
    Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $pgCmd } | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep 1
        & "$PgBin\pg_ctl.exe" -D "$Runtime\pgdata" status *> $null
        if ($LASTEXITCODE -eq 0) { break }
    }
}
& "$PgBin\pg_ctl.exe" -D "$Runtime\pgdata" status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'База данных не запустилась. Смотрите runtime\pg.log' -ForegroundColor Red
    Read-Host 'Нажмите Enter, чтобы закрыть'
    exit 1
}
Push-Location $Server
& $Php artisan migrate --force | Out-Null

# 3. Public mode: no debug pages with secrets
Write-Host '[3/6] Режим для интернета (APP_DEBUG=false)...'
Set-EnvValue 'APP_ENV' 'production'
Set-EnvValue 'APP_DEBUG' 'false'
& $Php artisan config:clear | Out-Null
& $Php artisan mansur:check-public
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host ''
    Write-Host 'Публикация остановлена: исправьте пункты выше и запустите снова.' -ForegroundColor Red
    Read-Host 'Нажмите Enter, чтобы закрыть'
    exit 1
}

# 4. Site workers + load balancer
Write-Host '[4/6] Запускаю сайт (4 обработчика)...'
$procs = @()
foreach ($p in $Workers) {
    $procs += Start-Process $Php -ArgumentList "artisan serve --host=127.0.0.1 --port=$p" -WorkingDirectory $Server -WindowStyle Hidden -PassThru
}
$procs += Start-Process 'node' -ArgumentList "`"$Runtime\proxy.js`" $ProxyPort $($Workers -join ' ')" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$Runtime\proxy.log" -RedirectStandardError "$Runtime\proxy-err.log"
Pop-Location
Start-Sleep 3

# 5. Tunnel
Write-Host '[5/6] Открываю туннель Cloudflare...'
$CfLog = Join-Path $Runtime 'cloudflared.log'
Remove-Item $CfLog -ErrorAction SilentlyContinue
$procs += Start-Process $Cf -ArgumentList "tunnel --no-autoupdate --url http://127.0.0.1:$ProxyPort --logfile `"$CfLog`"" -WindowStyle Hidden -PassThru
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep 1
    if (Test-Path $CfLog) {
        $m = Select-String -Path $CfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
}
if (-not $url) {
    Write-Host 'Не удалось получить адрес туннеля. Проверьте интернет и запустите снова.' -ForegroundColor Red
    $procs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Read-Host 'Нажмите Enter, чтобы закрыть'
    exit 1
}

# 6. Links in letters, downloads and sign-in now point to the public address
Write-Host '[6/6] Настраиваю адрес сайта...'
Set-EnvValue 'APP_URL' $url
Push-Location $Server; & $Php artisan config:clear | Out-Null; Pop-Location
Set-Clipboard $url

Write-Host ''
Write-Host '  ===============================================' -ForegroundColor Green
Write-Host "   Сайт в интернете:  $url" -ForegroundColor Green
Write-Host '  ===============================================' -ForegroundColor Green
Write-Host '   Адрес скопирован — отправьте его друзьям.'
Write-Host '   В Windows-приложении: «Адрес сервера» -> вставьте этот адрес.'
Write-Host '   Сайт работает, пока открыто это окно и включён компьютер.'
Write-Host '   При следующем запуске адрес будет другим.'
Write-Host ''
Write-Host '   Чтобы работал вход через Google и GitHub, вставьте адреса в их настройки:' -ForegroundColor Yellow
Write-Host "   Google  (console.cloud.google.com -> Учётные данные -> URI перенаправления):"
Write-Host "      $url/auth/google/callback" -ForegroundColor Yellow
Write-Host "   GitHub  (github.com/settings/developers -> OAuth Apps -> Authorization callback URL):"
Write-Host "      $url/auth/github/callback" -ForegroundColor Yellow
Write-Host ''
Start-Process $url
Read-Host '  Нажмите Enter, чтобы снять сайт с публикации'

$procs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Set-EnvValue 'APP_URL' 'http://localhost:8000'
Push-Location $Server; & $Php artisan config:clear | Out-Null; Pop-Location
Write-Host 'Сайт снят с публикации. Локально он по-прежнему открывается через «Запустить сайт».'
