<?php

namespace App\Services;

use App\Models\AppSetting;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

/**
 * Настройки исходящей почты SMTP (письма «Забыли пароль?»). Администратор вводит их в админ-панели,
 * они хранятся ЗАШИФРОВАННЫМИ в app_settings. Если не заданы — используются MAIL_* из .env.
 */
class MailSettings
{
    public const KEY = 'mail:smtp';

    public const FIELDS = ['host', 'port', 'username', 'password', 'from_address', 'from_name'];

    /**
     * Сохранённые настройки (расшифрованные).
     *
     * @return array<string, mixed>
     */
    public static function stored(): array
    {
        if (! Schema::hasTable('app_settings')) {
            return [];
        }

        return json_decode((string) AppSetting::find(self::KEY)?->value, true) ?: [];
    }

    /** Сохранить настройки (null — удалить). */
    public static function save(?array $values): void
    {
        $values === null
            ? AppSetting::whereKey(self::KEY)->delete()
            : AppSetting::updateOrCreate(['key' => self::KEY], ['value' => json_encode($values)]);
        self::apply();
    }

    /** Хватает ли данных из админ-панели, чтобы отправлять письма. */
    public static function adminConfigured(): bool
    {
        $s = self::stored();

        return filled($s['host'] ?? null) && filled($s['port'] ?? null) && filled($s['from_address'] ?? null);
    }

    /** Письма действительно уйдут с сервера (а не просто запишутся в лог). */
    public static function ready(): bool
    {
        return self::adminConfigured() || ! in_array(config('mail.default'), ['log', 'array', null], true);
    }

    /** Подставить настройки из админ-панели в конфигурацию почты Laravel на время текущего запроса. */
    public static function apply(): void
    {
        if (! self::adminConfigured()) {
            return;
        }
        $s = self::stored();
        $port = (int) $s['port'];
        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.host' => $s['host'],
            'mail.mailers.smtp.port' => $port,
            // Порт 465 — шифрование TLS с первого байта; 587/25 — STARTTLS включается автоматически.
            'mail.mailers.smtp.scheme' => $port === 465 ? 'smtps' : 'smtp',
            'mail.mailers.smtp.username' => $s['username'] ?? null,
            'mail.mailers.smtp.password' => $s['password'] ?? null,
            'mail.mailers.smtp.timeout' => 20,
            'mail.from.address' => $s['from_address'],
            'mail.from.name' => ($s['from_name'] ?? null) ?: config('app.name'),
        ]);
        Mail::purge('smtp'); // сбросить уже созданный почтовый клиент, чтобы он взял новые настройки
    }
}
