<?php

namespace App\Policies;

use App\Models\AgentTask;
use App\Models\User;

/** Политика доступа к задачам агента: чужую задачу нельзя ни открыть, ни отменить (403). */
class AgentTaskPolicy
{
    /** Смотреть задачу и её журнал. */
    public function view(User $user, AgentTask $task): bool
    {
        return $task->user_id === $user->id;
    }

    /** Менять задачу: отменить, запустить, записать журнал. */
    public function update(User $user, AgentTask $task): bool
    {
        return $task->user_id === $user->id;
    }
}
