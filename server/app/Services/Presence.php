<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Collection;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Кто сейчас онлайн. Sanctum при каждом запросе записывает в токен время last_used_at;
 * открытая вкладка сайта делает /ping раз в минуту, а приложение регулярно спрашивает задачи.
 * Значит, токены, использованные за последние 3 минуты, = люди онлайн.
 * Токены приложения имеют право «agent», токены сайта — нет: так отличаем «на сайте» от «в приложении».
 */
class Presence
{
    public const MINUTES = 3; // окно «онлайн» в минутах

    /** Запрос: токены пользователей, использованные за последние MINUTES минут. */
    private static function recent()
    {
        return PersonalAccessToken::query()
            ->where('tokenable_type', User::class)
            ->where('last_used_at', '>=', now()->subMinutes(self::MINUTES));
    }

    /**
     * Сколько людей онлайн: всего, на сайте, в приложении (distinct — человек с двумя вкладками считается один раз).
     *
     * @return array{total: int, site: int, app: int}
     */
    public static function counts(): array
    {
        return [
            'total' => (int) self::recent()->distinct()->count('tokenable_id'),
            'site' => (int) self::recent()->where('abilities', 'not like', '%"agent"%')->distinct()->count('tokenable_id'),
            'app' => (int) self::recent()->where('abilities', 'like', '%"agent"%')->distinct()->count('tokenable_id'),
        ];
    }

    /** Список онлайн-пользователей и где они: [{id, name, email, site, app, last_seen_at}]. */
    public static function users(int $limit = 50): Collection
    {
        $rows = self::recent()
            ->selectRaw("tokenable_id, max(last_used_at) as seen, bool_or(abilities like '%\"agent\"%') as app, bool_or(abilities not like '%\"agent\"%') as site")
            ->groupBy('tokenable_id')
            ->orderByDesc('seen')
            ->limit($limit)
            ->get();
        $users = User::whereIn('id', $rows->pluck('tokenable_id'))->get(['id', 'name', 'email'])->keyBy('id');

        return $rows->filter(fn ($r) => $users->has($r->tokenable_id))->map(fn ($r) => [
            'id' => $r->tokenable_id,
            'name' => $users[$r->tokenable_id]->name,
            'email' => $users[$r->tokenable_id]->email,
            'site' => (bool) $r->site,
            'app' => (bool) $r->app,
            'last_seen_at' => $r->seen,
        ])->values();
    }
}
