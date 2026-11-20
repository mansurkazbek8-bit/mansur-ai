<?php

/*
| Веб-маршруты: страницы, которые открываются в браузере (не JSON).
| Весь сайт — одна страница (SPA): resources/views/app.blade.php подключает public/js/app.js,
| а дальше JavaScript сам рисует страницы и обращается к REST API (routes/api.php).
*/

use App\Http\Controllers\SocialAuthController;
use Illuminate\Support\Facades\Route;

// Главная страница сайта — единственная HTML-страница SPA.
Route::view('/', 'app');

// Политика конфиденциальности (Google требует публичную ссылку, чтобы вход через Google работал для всех).
Route::view('/privacy', 'privacy');

// Документация API: Swagger UI поверх файла public/docs/openapi.yaml.
Route::redirect('/docs', '/docs/index.html');

// Вход через Google / GitHub / Apple (протокол OAuth 2.0):
// 1) /auth/google — перенаправляем пользователя на страницу входа Google;
// 2) Google возвращает его на /auth/google/callback с кодом; Apple присылает ответ формой POST.
Route::get('/auth/{provider}', [SocialAuthController::class, 'redirect'])->whereIn('provider', ['google', 'github', 'apple']);
Route::match(['get', 'post'], '/auth/{provider}/callback', [SocialAuthController::class, 'callback'])->whereIn('provider', ['google', 'github', 'apple']);
