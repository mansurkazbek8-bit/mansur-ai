<?php

namespace App\Services;

use App\Models\AgentTask;
use App\Models\AiModel;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * КЛЮЧЕВОЙ СЦЕНАРИЙ 2 — задачи для ИИ-агента Windows и их конечный автомат статусов:
 *   queued → running → completed | failed;  queued/running → cancelled.
 * Недопустимый переход — 409 Conflict; больше 3 незавершённых задач — 422.
 */
class AgentTaskService
{
    public function __construct(
        private readonly AiGateway $gateway,
        private readonly UsageService $usage,
        private readonly ContentFilter $filter,
        private readonly AgentTeam $team,
    ) {}

    /** Сколько часов приложение может молчать по задаче «в работе», прежде чем она считается сорвавшейся. */
    public const STALE_HOURS = 3;

    /**
     * Постмортем: задачи оставались «в работе» месяцами, если компьютер выключили посреди задачи,
     * и занимали лимит незавершённых задач. Теперь такие задачи сами переходят в «Ошибка».
     */
    public function expireStale(User $user): void
    {
        $user->agentTasks()
            ->where('status', AgentTask::RUNNING)
            ->where('updated_at', '<', now()->subHours(self::STALE_HOURS))
            ->update([
                'status' => AgentTask::FAILED,
                'result' => 'Приложение перестало отвечать (компьютер выключен или пропал интернет). Создайте задачу заново.',
                'agent_slot' => null,
                'finished_at' => now(),
            ]);
    }

    /** Создать задачу (проверки: фильтр, режим «Вместе» требует ≥ 2 агентов, лимит незавершённых). */
    public function create(User $user, array $data): AgentTask
    {
        $this->expireStale($user);

        if ($reason = $this->filter->violation(($data['title'] ?? '').' '.$data['prompt'])) {
            abort(422, $reason);
        }

        if (! empty($data['parent_id'])) {
            return $this->createSubtask($user, $data);
        }
        if (($data['mode'] ?? AgentTask::SOLO) === AgentTask::TEAM && $this->team->size($user) < 2) {
            abort(422, 'Для режима «Вместе» нужно минимум 2 агента. Добавьте агента в разделе «Команда».');
        }

        $unfinished = $user->agentTasks()->whereNull('parent_id')->whereIn('status', AgentTask::UNFINISHED)->count();
        // Чем больше команда, тем больше задач можно держать в очереди (минимум 3).
        $max = max(config('ai.max_unfinished_tasks'), $this->team->size($user) + 2);

        if ($unfinished >= $max) {
            abort(422, "Нельзя иметь больше {$max} незавершённых задач. Дождитесь выполнения или отмените одну из них.");
        }

        return $user->agentTasks()->create([
            'title' => $data['title'] ?? mb_strimwidth($data['prompt'], 0, 80, '…'),
            'prompt' => $data['prompt'],
            'workspace' => $data['workspace'] ?? null,
            'mode' => $data['mode'] ?? AgentTask::SOLO,
        ]);
    }

    /** Подзадача режима «Вместе»: её создаёт главный агент, работает в папке родительской задачи. */
    private function createSubtask(User $user, array $data): AgentTask
    {
        $parent = $user->agentTasks()->findOrFail($data['parent_id']);
        abort_unless($parent->mode === AgentTask::TEAM && $parent->status === AgentTask::RUNNING, 409, 'Подзадачи можно добавлять только к выполняемой задаче в режиме «Вместе»');
        abort_if($parent->subtasks()->count() >= AgentTeam::max(), 422, 'Слишком много подзадач');

        return $user->agentTasks()->create([
            'parent_id' => $parent->id,
            'title' => $data['title'] ?? mb_strimwidth($data['prompt'], 0, 80, '…'),
            'prompt' => $data['prompt'],
            'workspace' => $parent->workspace ?? $data['workspace'] ?? null,
        ]);
    }

    /** Главный агент отдаёт своего агента команде, пока делаются части, или снова берёт агента для финальной проверки. */
    public function reassign(AgentTask $task, ?int $slot): AgentTask
    {
        return DB::transaction(function () use ($task, $slot) {
            $task = AgentTask::whereKey($task->id)->lockForUpdate()->first();
            abort_unless($task->status === AgentTask::RUNNING, 409, 'Задача не выполняется');
            $task->agent_slot = null;
            $task->save();
            if ($slot !== null) {
                $task->agent_slot = $this->team->assignSlot($task->user, $slot);
                $task->save();
            }

            return $task;
        });
    }

    /**
     * Перевести задачу в новый статус. Запрещённый переход (например, completed → cancelled) — 409.
     * lockForUpdate: два одновременных запроса не смогут оба перевести одну задачу.
     */
    public function transition(AgentTask $task, string $status, ?string $result = null, ?int $slot = null): AgentTask
    {
        return DB::transaction(function () use ($task, $status, $result, $slot) {
            $task = AgentTask::whereKey($task->id)->lockForUpdate()->first();

            if (! $task->canMoveTo($status)) {
                abort(409, "Нельзя перевести задачу из статуса «{$task->status}» в «{$status}»");
            }

            $task->status = $status;
            if ($status === AgentTask::RUNNING) {
                // Одновременно выполняется не больше задач, чем агентов у пользователя (занимаем слот агента).
                $task->agent_slot = $this->team->assignSlot($task->user, $slot);
                $task->started_at = now();
            } else {
                $task->finished_at = now();
            }
            if ($result !== null) {
                $task->result = $result;
            }
            $task->save();

            // Отмена командной задачи отменяет и все её части.
            if ($status === AgentTask::CANCELLED) {
                $task->subtasks()->whereIn('status', AgentTask::UNFINISHED)
                    ->update(['status' => AgentTask::CANCELLED, 'result' => 'Отменена вместе с основной задачей', 'finished_at' => now()]);
            }

            return $task;
        });
    }

    /**
     * Дописать шаги в журнал задачи (только у задачи в статусе running, иначе 409).
     *
     * @param  array<int, array{type: string, text: string}>  $entries
     */
    public function appendLog(AgentTask $task, array $entries): AgentTask
    {
        if ($task->status !== AgentTask::RUNNING) {
            abort(409, 'Журнал можно пополнять только у выполняемой задачи');
        }

        $stamped = array_map(fn ($e) => [...$e, 'at' => now()->toIso8601String()], $entries);

        // Дописываем на стороне PostgreSQL оператором || для jsonb: параллельные записи не затирают друг друга.
        DB::update('update agent_tasks set log = log || ?::jsonb, updated_at = now() where id = ?', [
            json_encode($stamped, JSON_UNESCAPED_UNICODE), $task->id,
        ]);

        return $task->refresh();
    }

    /**
     * Один шаг «мышления» агента: приложение присылает историю с результатами инструментов,
     * сервер спрашивает модель агента (ключ остаётся на сервере) и списывает лимит агента.
     */
    public function step(User $user, array $messages, array $tools): array
    {
        // Сначала самая сильная модель (по sort); занятая бесплатная передаёт шаг следующей.
        $all = AiModel::where('type', AiModel::TYPE_AGENT)->available()->get();
        $models = $all->reject(fn (AiModel $m) => Providers::exhaustedUntil($m->provider))->values();
        if ($models->isEmpty()) {
            $models = $all; // все провайдеры исчерпали квоту — ошибка объяснит пользователю про дневной лимит
        }
        $model = $models->first() ?? abort(422, 'Модель агента недоступна');

        try {
            return DB::transaction(function () use ($user, $model, $models, $messages, $tools) {
                $counter = $this->usage->lockAndCheck($user, $model);
                $reply = null;
                foreach ($models as $i => $candidate) {
                    try {
                        $last = $i === $models->count() - 1;
                        // Написание целого файла на бесплатной модели может идти несколько минут — таймаут 240 с.
                        $reply = $this->gateway->chat($candidate, $messages, $tools, timeout: 240, maxWait: $last ? null : 4, retryTimeouts: $last);
                        break;
                    } catch (AiProviderException $e) {
                        if ($i === $models->count() - 1) {
                            throw $e;
                        }
                    }
                }
                $counter->increment('requests_count');

                $message = $reply['message'];
                if (is_string($message['content'] ?? null)) {
                    $message['content'] = $this->filter->censor($message['content']);
                }

                return [
                    'message' => $message,
                    'finish_reason' => $reply['finish_reason'] ?? null,
                    'remaining' => max(0, $model->daily_limit - $counter->requests_count),
                ];
            });
        } catch (AiProviderException $e) {
            abort(502, $e->getMessage());
        }
    }
}
