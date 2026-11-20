<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * API Resource — нейросеть из каталога.
 * Превращает модель из БД в JSON-ответ: решает, какие поля и в каком виде увидит клиент
 * (лишнее и секретное, например хеш пароля или ключи, наружу не попадает).
 */
class AiModelResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Технические поля (id модели у провайдера, системный промпт) видит только админ в админ-панели.
        $admin = (bool) $request->user()?->isAdmin() && $request->is('api/admin/*');

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $this->name,
            'provider' => $this->provider,
            'provider_title' => $this->providerTitle(),
            'type' => $this->type,
            'description' => $this->description,
            'daily_limit' => $this->daily_limit,
            'is_active' => $this->is_active,
            $this->mergeWhen($admin, fn () => [
                'model' => $this->model,
                'system_prompt' => $this->system_prompt,
                'sort' => $this->sort,
                'provider_configured' => $this->isProviderConfigured(),
            ]),
        ];
    }
}
