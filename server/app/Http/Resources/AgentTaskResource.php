<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * API Resource — задача агента.
 * Превращает модель из БД в JSON-ответ: решает, какие поля и в каком виде увидит клиент
 * (лишнее и секретное, например хеш пароля или ключи, наружу не попадает).
 */
class AgentTaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'prompt' => $this->prompt,
            'workspace' => $this->workspace,
            'status' => $this->status,
            'agent_slot' => $this->agent_slot,
            'mode' => $this->mode,
            'parent_id' => $this->parent_id,
            // whenLoaded: подзадачи попадают в ответ, только если их загрузили заранее (with('subtasks')) — без лишних запросов.
            'subtasks' => $this->whenLoaded('subtasks', fn () => $this->subtasks->map(fn ($s) => [
                'id' => $s->id, 'title' => $s->title, 'status' => $s->status, 'agent_slot' => $s->agent_slot, 'result' => $s->result,
            ])),
            'result' => $this->result,
            // Полный журнал (может быть большим) отдаётся только при просмотре одной задачи.
            'log' => $this->when($request->routeIs('*.show') || $request->boolean('with_log'), $this->log),
            'log_count' => count($this->log ?? []),
            'started_at' => $this->started_at,
            'finished_at' => $this->finished_at,
            'created_at' => $this->created_at,
        ];
    }
}
