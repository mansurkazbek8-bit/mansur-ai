<?php

/*
| Точка сборки приложения Laravel 13: какие файлы маршрутов подключить,
| какие middleware (посредники) зарегистрировать и как превращать ошибки в JSON-ответы.
*/

use App\Http\Middleware\EnsureNotBlocked;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',          // страницы для браузера
        api: __DIR__.'/../routes/api.php',          // REST API, префикс /api
        commands: __DIR__.'/../routes/console.php', // команды php artisan
        health: '/up',                              // адрес проверки «сервер жив»
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Короткие имена, которые используются в routes/api.php.
        $middleware->alias([
            'role' => EnsureRole::class,                // role:admin
            'not.blocked' => EnsureNotBlocked::class,   // заблокированным — 403
            'abilities' => CheckAbilities::class,       // у токена должны быть ВСЕ перечисленные права
            'ability' => CheckForAnyAbility::class,     // у токена должно быть ХОТЯ БЫ ОДНО право
        ]);
        $middleware->throttleApi();                     // лимит 60 запросов в минуту (настроен в AppServiceProvider)
        $middleware->append(SecurityHeaders::class);    // защитные заголовки на каждый ответ
        // В интернете сайт стоит за прокси/туннелем, который принимает HTTPS: доверяем его заголовкам X-Forwarded-*.
        $middleware->trustProxies(at: '*');
        // Apple присылает ответ входа формой POST с чужого сайта — для этого адреса CSRF-проверка отключена.
        $middleware->validateCsrfTokens(except: ['auth/*/callback']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Для API ошибки всегда отдаются в JSON, а не HTML-страницей.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        // 401 — нет токена или он недействителен.
        $exceptions->render(fn (AuthenticationException $e, Request $request) => response()
            ->json(['message' => 'Требуется вход в систему'], 401));
        // 403 — нет прав; стандартные английские тексты Laravel/Sanctum переводим на русский.
        $exceptions->render(fn (AccessDeniedHttpException $e, Request $request) => response()
            ->json(['message' => match ($e->getMessage()) {
                'This action is unauthorized.' => 'Нет доступа к этому ресурсу',
                'Invalid ability provided.' => 'Это действие доступно только в Windows-приложении Mansur AI',
                default => $e->getMessage(),
            }], 403));
        // 404 — для API короткий JSON, для страниц — обычная страница Laravel.
        $exceptions->render(fn (NotFoundHttpException $e, Request $request) => $request->is('api/*')
            ? response()->json(['message' => 'Не найдено'], 404) : null);
    })->create();
