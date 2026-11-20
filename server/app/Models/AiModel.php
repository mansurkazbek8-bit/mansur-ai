<?php

namespace App\Models;

use App\Services\Providers;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Модель «Нейросеть» (таблица ai_models): одна строка — одна модель у одного провайдера.
 * provider — кто отвечает (pollinations, openrouter…), model — id модели у провайдера,
 * daily_limit — сколько запросов в день доступно одному пользователю, sort — порядок в списке.
 */
class AiModel extends Model
{
    public const TYPE_TEXT = 'text';   // текстовый чат

    public const TYPE_IMAGE = 'image'; // генерация картинок

    public const TYPE_AGENT = 'agent'; // «мозг» ИИ-агента Windows-приложения (в чате не показывается)

    protected $fillable = [
        'slug', 'name', 'provider', 'model', 'type', 'description',
        'system_prompt', 'daily_limit', 'is_active', 'sort',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'daily_limit' => 'integer',
            'sort' => 'integer',
        ];
    }

    /**
     * Scope available(): включённые модели, у провайдера которых есть ключ (или ключ не нужен).
     * Пример: AiModel::available()->get() — то, что видит пользователь в списке нейросетей.
     */
    public function scopeAvailable(Builder $query): Builder
    {
        return $query->where('is_active', true)
            ->whereIn('provider', Providers::enabledNames())
            ->orderBy('sort');
    }

    /** Настроен ли провайдер этой модели (есть ли API-ключ). */
    public function isProviderConfigured(): bool
    {
        return Providers::enabled($this->provider);
    }

    /** Человеческое название провайдера, например «OpenRouter». */
    public function providerTitle(): string
    {
        return Providers::get($this->provider)['title'] ?? $this->provider;
    }

    /** Связь HasMany: чаты, в которых выбрана эта модель. */
    public function chats(): HasMany
    {
        return $this->hasMany(Chat::class);
    }

    /** Связь HasMany: счётчики дневного использования. */
    public function usageCounters(): HasMany
    {
        return $this->hasMany(UsageCounter::class);
    }
}
