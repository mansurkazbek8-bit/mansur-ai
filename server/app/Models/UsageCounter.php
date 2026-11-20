<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Модель «Счётчик использования» (таблица usage_counters): сколько запросов
 * пользователь сделал к модели за дату. Уникальный ключ (user_id, ai_model_id, date) — одна строка в день.
 */
class UsageCounter extends Model
{
    protected $fillable = ['user_id', 'ai_model_id', 'date', 'requests_count'];

    protected function casts(): array
    {
        return ['date' => 'date', 'requests_count' => 'integer'];
    }

    /** Связь BelongsTo: пользователь. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Связь BelongsTo: нейросеть. */
    public function aiModel(): BelongsTo
    {
        return $this->belongsTo(AiModel::class);
    }
}
