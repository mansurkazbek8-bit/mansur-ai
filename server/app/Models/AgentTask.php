<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Модель «Задача ИИ-агента» (таблица agent_tasks) — КЛЮЧЕВОЙ СЦЕНАРИЙ 2.
 * Задачу создают на сайте, а выполняет Windows-приложение на компьютере пользователя.
 * Статус меняется только по правилам конечного автомата TRANSITIONS (иначе ответ 409).
 */
class AgentTask extends Model
{
    public const QUEUED = 'queued';       // в очереди, ждёт приложение

    public const RUNNING = 'running';     // выполняется

    public const COMPLETED = 'completed'; // готово

    public const FAILED = 'failed';       // ошибка

    public const CANCELLED = 'cancelled'; // отменена пользователем

    /** Разрешённые переходы статусов: «из какого» => [«в какие»]. completed, failed и cancelled — конечные. */
    public const TRANSITIONS = [
        self::QUEUED => [self::RUNNING, self::CANCELLED],
        self::RUNNING => [self::COMPLETED, self::FAILED, self::CANCELLED],
    ];

    public const UNFINISHED = [self::QUEUED, self::RUNNING]; // незавершённые (их не больше 3 на пользователя)

    public const SOLO = 'solo'; // задачу делает один агент

    /** Режим «Вместе»: главный агент делит задачу между агентами команды. */
    public const TEAM = 'team';

    protected $fillable = ['parent_id', 'title', 'prompt', 'workspace', 'mode', 'status', 'agent_slot', 'log', 'result', 'started_at', 'finished_at'];

    // Значения по умолчанию для новой задачи.
    protected $attributes = ['log' => '[]', 'status' => self::QUEUED, 'mode' => self::SOLO];

    protected function casts(): array
    {
        return [
            'log' => 'array', // журнал хранится в PostgreSQL как jsonb, в PHP — обычный массив
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /** Можно ли перевести задачу в новый статус (проверка по таблице TRANSITIONS). */
    public function canMoveTo(string $status): bool
    {
        return in_array($status, self::TRANSITIONS[$this->status] ?? [], true);
    }

    /** Связь BelongsTo: родительская задача (для подзадач режима «Вместе»). */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /** Связь «один ко многим» (HasMany): подзадачи командной задачи. */
    public function subtasks(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('id');
    }

    /** Связь BelongsTo: владелец задачи. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
