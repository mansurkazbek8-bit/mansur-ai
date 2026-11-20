<?php

namespace App\Services;

use App\Models\AppSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

/**
 * Реестр провайдеров нейросетей: настройки из config/ai.php + API-ключи
 * из админ-панели (зашифрованы в app_settings) или из .env. Ключ из админ-панели важнее .env.
 * Провайдер «включён», если ключ не нужен (Pollinations) или он задан.
 */
class Providers
{
    private static ?array $cache = null; // кеш на время запроса, чтобы не читать БД много раз

    /**
     * Все провайдеры с ключами и признаком enabled.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $stored = Schema::hasTable('app_settings')
            ? AppSetting::where('key', 'like', 'provider_key:%')->get()->mapWithKeys(fn ($s) => [substr($s->key, 13) => $s->value])->all()
            : [];

        $result = [];
        foreach (config('ai.providers') as $name => $p) {
            $key = ($stored[$name] ?? null) ?: env($p['env_key']);
            $p['key'] = $key ?: null;
            $p['key_source'] = isset($stored[$name]) && $stored[$name] ? 'admin' : ($key ? 'env' : null);
            $p['enabled'] = ! $p['key_required'] || filled($key);
            $result[$name] = $p;
        }

        return self::$cache = $result;
    }

    /** Один провайдер по имени. */
    public static function get(string $name): ?array
    {
        return self::all()[$name] ?? null;
    }

    /** Можно ли пользоваться провайдером. */
    public static function enabled(string $name): bool
    {
        return (bool) (self::get($name)['enabled'] ?? false);
    }

    /**
     * Имена включённых провайдеров (для scope AiModel::available()).
     *
     * @return array<int, string>
     */
    public static function enabledNames(): array
    {
        return array_keys(array_filter(self::all(), fn ($p) => $p['enabled']));
    }

    /** Сохранить ключ из админ-панели (пустой — удалить). */
    public static function setKey(string $name, ?string $key): void
    {
        $id = "provider_key:{$name}";
        blank($key)
            ? AppSetting::whereKey($id)->delete()
            : AppSetting::updateOrCreate(['key' => $id], ['value' => trim($key)]);
        self::$cache = null;
    }

    /**
     * Провайдер, у которого кончилась дневная квота (OpenRouter: 50 бесплатных запросов в день),
     * пропускается до её сброса, а не опрашивается снова и снова. Запоминается в кеше.
     */
    public static function markExhausted(string $name, ?int $resetAt = null): void
    {
        $until = $resetAt && $resetAt > time() ? now()->setTimestamp(min($resetAt, time() + 86400)) : now()->addHour();
        Cache::put("ai:exhausted:{$name}", $until->timestamp, $until);
    }

    /** Когда (Unix-время) сбросится квота провайдера, или null, если квота не исчерпана. */
    public static function exhaustedUntil(string $name): ?int
    {
        return Cache::get("ai:exhausted:{$name}");
    }

    /** Сбросить кеш (нужно в тестах после смены ключей). */
    public static function flush(): void
    {
        self::$cache = null;
    }
}
