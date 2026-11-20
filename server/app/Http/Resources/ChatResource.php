<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * API Resource — чат (сообщения — только при открытии одного чата).
 * Превращает модель из БД в JSON-ответ: решает, какие поля и в каком виде увидит клиент
 * (лишнее и секретное, например хеш пароля или ключи, наружу не попадает).
 */
class ChatResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'ai_model_id' => $this->ai_model_id,
            'model' => new AiModelResource($this->whenLoaded('aiModel')),
            'messages' => MessageResource::collection($this->whenLoaded('messages')),
            'messages_count' => $this->whenCounted('messages'),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
