<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/** Провайдер сервисов приложения: здесь настраиваются ограничения частоты запросов (rate limiting). */
class AppServiceProvider extends ServiceProvider
{
    /** Регистрация сервисов в контейнере (не нужна: Laravel создаёт классы сам). */
    public function register(): void
    {
        //
    }

    /** Запуск при старте приложения. */
    public function boot(): void
    {
        // Общий лимит API: 60 запросов в минуту на пользователя (или на IP для гостя), иначе 429.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(60)
            ->by($request->user()?->id ?: $request->ip())
            ->response(fn () => response()->json(['message' => 'Слишком много запросов. Подождите минуту.'], 429)));

        // Формы входа: 10 попыток в минуту с IP — защита от подбора пароля и спама письмами.
        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute(10)
            ->by($request->ip())
            ->response(fn () => response()->json(['message' => 'Слишком много попыток. Подождите минуту и попробуйте снова.'], 429)));

        // Ссылки строятся по адресу, который открыл посетитель: https через туннель/хостинг
        // (заголовок X-Forwarded-Proto от доверенного прокси) и http на localhost.
    }
}
