<?php

namespace App\Http\Resources;

use App\Services\AgentTeam;
use App\Services\Presence;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * API Resource — пользователь. Пароль и токены никогда не отдаются.
 * Превращает модель из БД в JSON-ответ: решает, какие поля и в каком виде увидит клиент
 * (лишнее и секретное, например хеш пароля или ключи, наружу не попадает).
 */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // $own — пользователь смотрит СВОЙ профиль: тогда добавляем личные настройки оформления.
        $own = $request->user()?->id === $this->id || ! $request->user();

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->role,
            'is_blocked' => $this->is_blocked,
            // Агентов в команде: 1 бесплатный + купленные, но не больше максимума.
            'agents' => min(AgentTeam::max(), 1 + ($this->paid_agents_count ?? $this->agentPurchases()->paid()->count())),
            'created_at' => $this->created_at,
            'chats_count' => $this->whenCounted('chats'),
            // Только для таблицы пользователей в админ-панели (поля заполняет Admin\UserController::withAdminData).
            $this->mergeWhen(array_key_exists('tokens_max_last_used_at', $this->resource->getAttributes()), fn () => [
                'last_seen_at' => $this->tokens_max_last_used_at,
                // Онлайн = токен использовался за последние Presence::MINUTES минут.
                'online' => $this->tokens_max_last_used_at !== null
                    && Carbon::parse($this->tokens_max_last_used_at)->gte(now()->subMinutes(Presence::MINUTES)),
                'uses_app' => (bool) $this->uses_app,
                'signup_via' => $this->socialAccounts->pluck('provider')->values(),
                'has_password' => $this->password !== null,
                'agent_tasks_count' => $this->agent_tasks_count,
                'requests_total' => (int) $this->requests_total,
                'spent' => (int) $this->spent,
            ]),
            $this->mergeWhen($own, fn () => [
                'has_password' => $this->password !== null,
                'social' => $this->socialAccounts()->pluck('provider'),
                'appearance' => $this->appearance,
                'background_url' => $this->background_path ? Storage::disk('public')->url($this->background_path) : null,
                'background_type' => $this->background_path
                    ? (preg_match('/\.(mp4|webm)$/i', $this->background_path) ? 'video' : 'image')
                    : null,
            ]),
        ];
    }
}
