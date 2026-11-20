<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Модель «Чат» (таблица chats): разговор пользователя с выбранной нейросетью. */
class Chat extends Model
{
    protected $fillable = ['title', 'ai_model_id'];

    /** Связь BelongsTo: владелец чата. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Связь BelongsTo: текущая нейросеть чата. */
    public function aiModel(): BelongsTo
    {
        return $this->belongsTo(AiModel::class);
    }

    /** Связь HasMany: сообщения чата по порядку. */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->orderBy('id');
    }
}
