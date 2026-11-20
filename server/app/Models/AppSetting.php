<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Модель «Настройка» (таблица app_settings): пары ключ → значение.
 * Здесь хранятся API-ключи провайдеров, ключи входа через Google/GitHub и пароль почты.
 * Значение ЗАШИФРОВАНО: cast 'encrypted' шифрует при записи и расшифровывает при чтении (ключ APP_KEY).
 */
class AppSetting extends Model
{
    protected $primaryKey = 'key'; // первичный ключ — строка, а не число

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['key', 'value'];

    protected function casts(): array
    {
        return ['value' => 'encrypted']; // в БД лежит шифротекст, украденная база ключей не раскроет
    }
}
