<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

/**
 * API Resource — сообщение чата.
 * Превращает модель из БД в JSON-ответ: решает, какие поля и в каком виде увидит клиент
 * (лишнее и секретное, например хеш пароля или ключи, наружу не попадает).
 */
class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'content' => $this->content,
            // В БД хранится путь к файлу картинки, клиенту отдаём полный URL.
            'image_url' => $this->image_path ? Storage::disk('public')->url($this->image_path) : null,
            'status' => $this->status,
            'ai_model_id' => $this->ai_model_id,
            // Подпись «какая нейросеть ответила» (если ответила запасная модель — будет её имя).
            'model_name' => $this->whenLoaded('aiModel', fn () => $this->aiModel?->name),
            'created_at' => $this->created_at,
        ];
    }
}
