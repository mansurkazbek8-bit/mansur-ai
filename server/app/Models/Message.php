<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Модель «Сообщение» (таблица messages). role: user — пользователь, assistant — нейросеть.
 * status failed — сообщение, на которое нейросеть не ответила (лимит за него не списан).
 */
class Message extends Model
{
    public const STATUS_OK = 'ok';         // нормальное сообщение

    public const STATUS_FAILED = 'failed'; // нейросеть не ответила

    protected $fillable = ['ai_model_id', 'role', 'content', 'image_path', 'status', 'tokens'];

    protected $attributes = ['status' => self::STATUS_OK];

    /** Связь BelongsTo: чат сообщения. */
    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    /** Связь BelongsTo: нейросеть, которая ответила (может быть запасная). */
    public function aiModel(): BelongsTo
    {
        return $this->belongsTo(AiModel::class);
    }
}
